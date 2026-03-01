/**
 * Session runner — three modes:
 *
 * Print mode (default, v5.4+): Spawns `claude -p --output-format stream-json`.
 *   Most reliable for auto-relay: Claude processes the prompt, uses tools,
 *   writes handoff files, and exits naturally. No file polling needed.
 *   Stream-json output gives real-time visibility into Claude's work.
 *
 * TUI mode: Spawns `claude` as a child process with full TUI.
 *   A background file poller watches for handoff completion and sends
 *   SIGTERM to the TUI when done, so the relay loop can start the next
 *   session. Without this, the TUI idles at `❯` forever and blocks chaining.
 *
 * Headless mode: Uses the Agent SDK query() function for
 *   programmatic control. No TUI — text streams to stdout.
 */

import * as fs from 'fs';
import * as path from 'path';
import { spawn, ChildProcess } from 'child_process';
import { CleaveConfig } from './config';
import { RelayPaths } from './state/files';
import { buildHooks, generateSettingsFile } from './hooks';
import { buildHandoffInstructions } from './utils/prompt-builder';
import { logger } from './utils/logger';
import { createInterface } from 'readline';

export interface SessionResult {
  exitCode: number;
  rateLimited: boolean;
  rateLimitResetAt: number | null;
  resultText: string;
  /** Rough estimate of output tokens (character count / 4) */
  estimatedOutputTokens: number;
}

/** Rate limit detection patterns — comprehensive list. */
const RATE_LIMIT_PATTERNS = /rate.?limit|too many requests|usage.?limit|quota.?exceeded|limit.?reached|429|capacity|throttl/i;

/**
 * Write the prompt to a file and return the path.
 * Avoids command-line arg length limits for long prompts.
 */
function writePromptFile(relayDir: string, prompt: string): string {
  const promptPath = path.join(relayDir, '.session_prompt.md');
  fs.mkdirSync(path.dirname(promptPath), { recursive: true });
  fs.writeFileSync(promptPath, prompt, 'utf8');
  return promptPath;
}

/**
 * Check if handoff files are complete and ready for relay.
 *
 * Detection strategy (in order):
 * 1. Completion marker in PROGRESS.md — task is fully done
 * 2. .handoff_signal file exists and is fresh — Claude wrote it as Step 4
 *
 * IMPORTANT: We do NOT infer handoff from file presence alone.
 * KNOWLEDGE.md is initialized with boilerplate (always non-empty), so
 * checking "all files present + fresh + non-empty" would SIGTERM Claude
 * mid-session the moment it touches PROGRESS.md + NEXT_PROMPT.md.
 * An explicit signal is required.
 */
function isHandoffReady(paths: RelayPaths, completionMarker: string): boolean {
  try {
    // 1. Check for completion marker on a STATUS line at start of line
    // (avoids false positives like "3. Mark STATUS: ALL_COMPLETE" in descriptions)
    if (fs.existsSync(paths.progressFile)) {
      const content = fs.readFileSync(paths.progressFile, 'utf8');
      const markerEscaped = completionMarker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const statusPattern = new RegExp(
        `^[\\s#*]*STATUS[:\\s*]+\\s*(?:${markerEscaped}|TASK_FULLY_COMPLETE)`,
        'im'
      );
      if (statusPattern.test(content)) {
        return true;
      }
    }

    // 2. Check for explicit handoff signal file
    if (fs.existsSync(paths.handoffSignalFile)) {
      // Verify it was written during THIS session (not leftover from a previous one)
      if (fs.existsSync(paths.sessionStartMarker)) {
        const startTime = fs.statSync(paths.sessionStartMarker).mtimeMs;
        const signalTime = fs.statSync(paths.handoffSignalFile).mtimeMs;
        if (signalTime > startTime) {
          return true;
        }
        // Signal file is stale (from a prior session) — ignore it
        return false;
      }
      // No session start marker — trust the signal file
      return true;
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * Run a session in TUI mode — spawns `claude` with full interactive TUI.
 *
 * CRITICAL: Claude Code's TUI never auto-exits after processing a prompt.
 * It returns to the idle `❯` prompt and waits for more input. To make the
 * relay chain work, we poll the filesystem every 5 seconds for handoff
 * completion. Once all handoff files are written, we SIGTERM the TUI
 * process so the relay loop can start the next session.
 */
async function runTuiSession(
  taskPrompt: string,
  config: CleaveConfig,
  paths: RelayPaths,
  sessionNum: number
): Promise<SessionResult> {
  const result: SessionResult = {
    exitCode: 0,
    rateLimited: false,
    rateLimitResetAt: null,
    resultText: '',
    estimatedOutputTokens: 0,
  };

  const settingsPath = generateSettingsFile(paths.relayDir);
  const promptFilePath = writePromptFile(paths.relayDir, taskPrompt);
  const handoffInstructions = buildHandoffInstructions(config);

  const args: string[] = [
    `You are session #${sessionNum} of an automated Cleave relay. ` +
    `Read the file "${promptFilePath}" for your full task instructions. ` +
    `Execute those instructions immediately. Do NOT ask for confirmation.`,
    '--append-system-prompt', handoffInstructions,
    '--settings', settingsPath,
  ];

  if (!config.safeMode) {
    args.push('--dangerously-skip-permissions');
  }

  logger.debug(`Launching TUI session #${sessionNum}`);
  logger.debug(`  Prompt file: ${promptFilePath}`);

  // Track whether we intentionally killed the TUI
  let killedByRelay = false;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let timeoutTimer: ReturnType<typeof setTimeout> | null = null;

  try {
    // Strip CLAUDECODE env var so the child claude process doesn't
    // think it's nested inside another session and refuse to start.
    const childEnv = { ...process.env };
    delete childEnv.CLAUDECODE;

    const child = spawn('claude', args, {
      stdio: 'inherit',
      cwd: config.workDir,
      env: {
        ...childEnv,
        CLEAVE_SESSION: String(sessionNum),
        CLEAVE_WORK_DIR: config.workDir,
        ...(config.activeStage ? { CLEAVE_ACTIVE_STAGE: config.activeStage } : {}),
      },
    });

    // ── Handoff file poller ──
    // Wait 30 seconds before starting to poll (give Claude time to begin work).
    // Then check every 5 seconds if handoff files are complete.
    // When they are, SIGTERM the TUI so the relay loop can continue.
    const POLL_DELAY_MS = 30_000;    // Wait 30s before first check
    const POLL_INTERVAL_MS = 5_000;  // Then check every 5s

    let lastNextPromptSize = -1;  // Track NEXT_PROMPT.md size for stability check

    const startPolling = () => {
      pollTimer = setInterval(() => {
        if (isHandoffReady(paths, config.completionMarker)) {
          // Stability check: NEXT_PROMPT.md must exist, be non-empty, and
          // have a stable size across 2 consecutive polls.
          // Without this, a non-existent file (size 0) would appear "stable"
          // and trigger premature SIGTERM before Claude writes it.
          const nextPromptExists = fs.existsSync(paths.nextPromptFile);
          const currentSize = nextPromptExists ? fs.statSync(paths.nextPromptFile).size : 0;

          // For completion (ALL_COMPLETE), NEXT_PROMPT.md isn't needed
          // Require STATUS at start of line to avoid false positives
          const markerEsc = config.completionMarker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const completionRe = new RegExp(
            `^[\\s#*]*STATUS[:\\s*]+\\s*(?:${markerEsc}|TASK_FULLY_COMPLETE)`,
            'im'
          );
          const isCompletion = fs.existsSync(paths.progressFile) &&
            completionRe.test(fs.readFileSync(paths.progressFile, 'utf8'));

          if (!nextPromptExists && !isCompletion) {
            // Signal file written but NEXT_PROMPT.md not yet — keep waiting
            logger.debug(`Handoff signal detected but NEXT_PROMPT.md missing — waiting for Claude to write it`);
            lastNextPromptSize = -1;
          } else if (currentSize > 0 && currentSize === lastNextPromptSize && lastNextPromptSize > 0) {
            // Files stable for 2 consecutive polls — safe to kill
            logger.debug(`Handoff detected + files stable (${currentSize} bytes) — terminating TUI session #${sessionNum}`);
            killedByRelay = true;
            if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }

            // Grace period: 2 seconds for any final I/O
            setTimeout(() => {
              try { child.kill('SIGTERM'); } catch { /* already exited */ }
            }, 2_000);
          } else if (isCompletion && lastNextPromptSize === currentSize) {
            // Task complete (ALL_COMPLETE) — don't need NEXT_PROMPT.md
            logger.debug(`Task completion detected — terminating TUI session #${sessionNum}`);
            killedByRelay = true;
            if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
            setTimeout(() => {
              try { child.kill('SIGTERM'); } catch { /* already exited */ }
            }, 2_000);
          } else {
            // First detection or files still changing — wait for next poll
            lastNextPromptSize = currentSize;
            logger.debug(`Handoff detected but files may still be writing (${currentSize} bytes) — waiting for stability`);
          }
        } else {
          lastNextPromptSize = -1;  // Reset if handoff not ready
        }
      }, POLL_INTERVAL_MS);
    };

    // Delay the start of polling
    const delayTimer = setTimeout(startPolling, POLL_DELAY_MS);

    // ── Session timeout ──
    // If the session runs longer than sessionTimeout, force-kill it.
    // Prevents infinite hangs if Claude never triggers a handoff.
    if (config.sessionTimeout > 0) {
      timeoutTimer = setTimeout(() => {
        if (!killedByRelay) {
          logger.warn(`Session #${sessionNum} exceeded timeout (${config.sessionTimeout}s) — forcing SIGTERM`);
          killedByRelay = true;
          if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
          try { child.kill('SIGTERM'); } catch { /* already exited */ }
        }
      }, config.sessionTimeout * 1000);
    }

    result.exitCode = await new Promise<number>((resolve, reject) => {
      child.on('exit', (code) => {
        clearTimeout(delayTimer);
        if (pollTimer) clearInterval(pollTimer);
        if (timeoutTimer) clearTimeout(timeoutTimer);
        // If we killed it intentionally, treat as success (exit 0)
        resolve(killedByRelay ? 0 : (code ?? 1));
      });
      child.on('error', (err) => {
        clearTimeout(delayTimer);
        if (pollTimer) clearInterval(pollTimer);
        if (timeoutTimer) clearTimeout(timeoutTimer);
        logger.error(`Failed to spawn claude: ${err.message}`);
        reject(err);
      });
    });
  } catch (err: any) {
    result.exitCode = 1;
    logger.error(`TUI session error: ${err.message}`);
  } finally {
    if (pollTimer) clearInterval(pollTimer);
    if (timeoutTimer) clearTimeout(timeoutTimer);
  }

  // Detect rate limiting from exit patterns
  if (result.exitCode !== 0 && !killedByRelay) {
    const progressFresh = fs.existsSync(paths.progressFile) &&
      fs.existsSync(paths.sessionStartMarker) &&
      fs.statSync(paths.progressFile).mtimeMs > fs.statSync(paths.sessionStartMarker).mtimeMs;

    if (!progressFresh) {
      // Check progress file content for rate limit signals
      const progressContent = fs.existsSync(paths.progressFile)
        ? fs.readFileSync(paths.progressFile, 'utf8') : '';
      if (RATE_LIMIT_PATTERNS.test(progressContent)) {
        result.rateLimited = true;
        result.rateLimitResetAt = Date.now() + 300_000;
        logger.warn('Rate limit detected from session output');
      }
    }
  }

  return result;
}

/**
 * Run a session in headless mode — uses Agent SDK query().
 */
async function runHeadlessSession(
  prompt: string,
  config: CleaveConfig,
  paths: RelayPaths,
  sessionNum: number
): Promise<SessionResult> {
  let query: any;
  try {
    const sdk = await import('@anthropic-ai/claude-agent-sdk');
    query = sdk.query;
  } catch (err: any) {
    logger.error('Error: Claude Code Agent SDK not found.');
    logger.error('  Headless mode (--no-tui) requires: npm install @anthropic-ai/claude-agent-sdk');
    logger.error('  Or remove --no-tui to use interactive TUI mode instead.');
    throw new Error(`Agent SDK not available: ${err.message}`);
  }

  const result: SessionResult = {
    exitCode: 0,
    rateLimited: false,
    rateLimitResetAt: null,
    resultText: '',
    estimatedOutputTokens: 0,
  };

  const allowedTools = [
    'Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep',
    'WebSearch', 'WebFetch', 'Task',
  ];
  const permissionMode = config.safeMode ? 'default' : 'bypassPermissions';
  const hooks = buildHooks(paths, config.completionMarker);

  try {
    logger.debug(`Launching headless session #${sessionNum} (permission: ${permissionMode})`);

    const messages = query({
      prompt,
      options: {
        cwd: config.workDir,
        allowedTools,
        permissionMode,
        hooks,
      },
    });

    for await (const message of messages) {
      if (message.type === 'assistant') {
        for (const block of (message.message?.content || [])) {
          if (block.type === 'text') {
            result.resultText += block.text;
            if (config.verbose) process.stdout.write(block.text);
          }
        }
      } else if (message.type === 'result') {
        result.resultText += message.result || '';
      } else if (message.type === 'rate_limit') {
        result.rateLimited = true;
        result.rateLimitResetAt = message.resets_at
          ? new Date(message.resets_at).getTime()
          : Date.now() + 300_000;
        logger.warn(`Rate limit hit. Resets at: ${message.resets_at || 'unknown'}`);
        break;
      }
    }
  } catch (err: any) {
    const errMsg = String(err.message || err);
    if (RATE_LIMIT_PATTERNS.test(errMsg)) {
      result.rateLimited = true;
      result.rateLimitResetAt = Date.now() + 300_000;
      logger.warn(`Rate limit detected: ${errMsg.slice(0, 100)}`);
    } else {
      result.exitCode = 1;
      logger.error(`Session error: ${errMsg}`);
    }
  }

  return result;
}

/**
 * Check if handoff files were written during this session (fresh, not stale).
 */
function hasValidHandoff(paths: RelayPaths): { complete: boolean; handedOff: boolean } {
  const sessionStart = fs.existsSync(paths.sessionStartMarker)
    ? fs.statSync(paths.sessionStartMarker).mtimeMs : 0;

  const progressExists = fs.existsSync(paths.progressFile);
  const progressFresh = progressExists &&
    fs.statSync(paths.progressFile).mtimeMs > sessionStart;

  // Check for ALL_COMPLETE or TASK_FULLY_COMPLETE
  if (progressFresh) {
    const content = fs.readFileSync(paths.progressFile, 'utf8');
    if (/^[\s#*]*STATUS[\s:*]+\s*(?:ALL_COMPLETE|TASK_FULLY_COMPLETE)/im.test(content)) {
      return { complete: true, handedOff: true };
    }
  }

  // Check for handoff signal
  if (fs.existsSync(paths.handoffSignalFile)) {
    const signalFresh = fs.statSync(paths.handoffSignalFile).mtimeMs > sessionStart;
    if (signalFresh) return { complete: false, handedOff: true };
  }

  // Check for NEXT_PROMPT.md (even without signal, if progress was updated)
  const nextExists = fs.existsSync(paths.nextPromptFile) &&
    fs.statSync(paths.nextPromptFile).mtimeMs > sessionStart &&
    fs.statSync(paths.nextPromptFile).size > 50;

  if (progressFresh && nextExists) return { complete: false, handedOff: true };

  return { complete: false, handedOff: false };
}

/**
 * Write rescue handoff files when a session exits without writing them.
 * This is the critical safety net that makes auto-relay actually work.
 * Without this, a session that runs out of context silently drops the relay chain.
 */
function writeRescueHandoff(
  paths: RelayPaths,
  config: CleaveConfig,
  sessionNum: number,
  exitCode: number,
  toolUseCount: number,
  lastToolName: string,
): void {
  logger.warn(`Session #${sessionNum} exited without handoff files — writing rescue handoff`);

  // Rescue PROGRESS.md — preserve any partial content, add rescue note
  const existingProgress = fs.existsSync(paths.progressFile)
    ? fs.readFileSync(paths.progressFile, 'utf8') : '';

  const rescueProgress = `## STATUS: IN_PROGRESS

## Rescue Handoff (auto-generated by Cleave SDK)
Session #${sessionNum} exited (code ${exitCode}) without completing handoff.
The session made progress (${toolUseCount} tool calls, last: ${lastToolName}) but
ran out of context or hit an error before writing handoff files.

${existingProgress ? `## Previous Progress\n${existingProgress}` : ''}

## What Happened
- Session ${sessionNum} started and did work (${toolUseCount} tool calls)
- Last tool used: ${lastToolName || 'unknown'}
- Session exited with code ${exitCode} without writing PROGRESS.md or NEXT_PROMPT.md
- This rescue handoff was auto-generated to keep the relay chain alive

## Action for Next Session
- Read the original task file to understand the full scope
- Check git log and git diff to see what was actually accomplished
- Check .cleave/KNOWLEDGE.md for any accumulated notes
- Continue from where session ${sessionNum} left off
`;

  fs.writeFileSync(paths.progressFile, rescueProgress, 'utf8');

  // Rescue NEXT_PROMPT.md — tell the next session to pick up the pieces
  const initialPrompt = fs.existsSync(config.initialPromptFile)
    ? fs.readFileSync(config.initialPromptFile, 'utf8') : '';

  const rescueNext = `# Continue from Session ${sessionNum} (Rescue Handoff)

The previous session (#${sessionNum}) did work but exited without writing handoff files.
This is a rescue prompt auto-generated by the Cleave relay system.

## Your First Steps
1. Run \`git log --oneline -10\` and \`git diff --stat\` to see what session ${sessionNum} actually did
2. Read \`.cleave/PROGRESS.md\` for any partial progress notes
3. Read \`.cleave/KNOWLEDGE.md\` for accumulated knowledge
4. Continue the work from where session ${sessionNum} left off

## Original Task
${initialPrompt.slice(0, 3000)}${initialPrompt.length > 3000 ? '\n\n[... truncated — read the original task file for full details]' : ''}

## Important
- Do NOT redo work that's already committed
- Check git status/diff FIRST before making any changes
- When at ~${config.handoffThreshold}% context, STOP and do the handoff procedure.
`;

  fs.writeFileSync(paths.nextPromptFile, rescueNext, 'utf8');

  // Write handoff signal so the relay loop picks it up
  fs.writeFileSync(paths.handoffSignalFile, 'RESCUE_HANDOFF', 'utf8');

  logger.success(`Rescue handoff written — relay chain will continue with session #${sessionNum + 1}`);
}

/**
 * Run a session in print mode — spawns `claude -p --output-format stream-json`.
 *
 * This is the most reliable mode for automated relay:
 * - Claude processes the prompt, uses tools, writes handoff files
 * - Claude exits naturally when done (no SIGTERM needed)
 * - Stream-json output gives real-time monitoring
 * - No Agent SDK dependency required
 * - Permission bypass works without interactive approval
 * - RESCUE HANDOFF: If Claude exits without handoff files, the SDK writes them
 *   automatically so the relay chain never breaks.
 */
async function runPrintSession(
  taskPrompt: string,
  config: CleaveConfig,
  paths: RelayPaths,
  sessionNum: number
): Promise<SessionResult> {
  const result: SessionResult = {
    exitCode: 0,
    rateLimited: false,
    rateLimitResetAt: null,
    resultText: '',
    estimatedOutputTokens: 0,
  };

  const handoffInstructions = buildHandoffInstructions(config);

  const args: string[] = [
    '-p',
    '--output-format', 'stream-json',
    '--verbose',   // required for stream-json output
    '--append-system-prompt', handoffInstructions,
  ];

  // Permission mode
  if (!config.safeMode) {
    args.push('--dangerously-skip-permissions');
  } else {
    args.push('--permission-mode', 'acceptEdits');
  }

  // Model selection
  if (config.model) {
    args.push('--model', config.model);
  }

  logger.debug(`Launching print session #${sessionNum}`);
  logger.debug(`  Mode: print (claude -p --output-format stream-json)`);

  let timeoutTimer: ReturnType<typeof setTimeout> | null = null;
  let killed = false;

  // Track session activity for rescue handoff
  let toolUseCount = 0;
  let lastToolName = '';
  let totalOutputChars = 0;
  let lastAssistantText = '';
  let stderrOutput = '';
  let handoffDetectedInStream = false;
  let completionDetectedInStream = false;

  try {
    // Strip CLAUDECODE env var so the child doesn't think it's nested
    const childEnv = { ...process.env };
    delete childEnv.CLAUDECODE;

    const child = spawn('claude', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: config.workDir,
      env: {
        ...childEnv,
        CLEAVE_SESSION: String(sessionNum),
        CLEAVE_WORK_DIR: config.workDir,
        ...(config.activeStage ? { CLEAVE_ACTIVE_STAGE: config.activeStage } : {}),
      },
    });

    // Pipe the full task prompt via stdin
    child.stdin.write(taskPrompt);
    child.stdin.end();

    // Session timeout — force-kill if it runs too long
    if (config.sessionTimeout > 0) {
      timeoutTimer = setTimeout(() => {
        if (!killed) {
          logger.warn(`Session #${sessionNum} exceeded timeout (${config.sessionTimeout}s) — forcing exit`);
          killed = true;
          try { child.kill('SIGTERM'); } catch { /* already exited */ }
        }
      }, config.sessionTimeout * 1000);
    }

    // Read stderr for error messages
    if (child.stderr) {
      child.stderr.on('data', (chunk: Buffer) => {
        stderrOutput += chunk.toString();
      });
    }

    // Parse stdout line by line (stream-json is newline-delimited JSON)
    const rl = createInterface({ input: child.stdout });

    for await (const line of rl) {
      if (!line.trim()) continue;

      let event: any;
      try {
        event = JSON.parse(line);
      } catch {
        // Not JSON — raw text output, append to result
        result.resultText += line + '\n';
        totalOutputChars += line.length;
        continue;
      }

      // Process different event types
      if (event.type === 'assistant') {
        // Assistant message with content blocks
        const content = event.message?.content || [];
        for (const block of content) {
          if (block.type === 'text') {
            result.resultText += block.text;
            totalOutputChars += block.text.length;
            lastAssistantText = block.text;

            // Log interesting output (handoff signals, completion, errors)
            if (block.text.includes('RELAY_HANDOFF_COMPLETE')) {
              handoffDetectedInStream = true;
              logger.success(`Session #${sessionNum}: handoff signal detected in output`);
            }
            if (block.text.includes('TASK_FULLY_COMPLETE')) {
              completionDetectedInStream = true;
              logger.success(`Session #${sessionNum}: task completion signal detected`);
            }
          } else if (block.type === 'tool_use') {
            toolUseCount++;
            lastToolName = block.name || 'unknown';
            if (config.verbose) {
              logger.debug(`  Tool: ${lastToolName}`);
            }
          }
        }
      } else if (event.type === 'content_block_start') {
        // Streaming content block start
        if (event.content_block?.type === 'tool_use') {
          toolUseCount++;
          lastToolName = event.content_block.name || 'unknown';
          if (config.verbose) {
            logger.debug(`  Tool: ${lastToolName}`);
          }
        }
      } else if (event.type === 'content_block_delta') {
        // Streaming text delta
        if (event.delta?.type === 'text_delta' && event.delta?.text) {
          result.resultText += event.delta.text;
          totalOutputChars += event.delta.text.length;
        }
      } else if (event.type === 'result') {
        // Final result
        if (event.result) {
          result.resultText += typeof event.result === 'string' ? event.result : JSON.stringify(event.result);
        }
        // Check for cost/usage info
        if (event.cost_usd !== undefined) {
          logger.debug(`  Session cost: $${event.cost_usd.toFixed(4)}`);
        }
        if (event.total_cost_usd !== undefined) {
          logger.debug(`  Total cost: $${event.total_cost_usd.toFixed(4)}`);
        }
      } else if (event.type === 'rate_limit_event') {
        // Rate limit status from Claude Code (may include overageStatus)
        const info = event.rate_limit_info;
        if (info?.status === 'blocked' || info?.overageStatus === 'blocked') {
          result.rateLimited = true;
          result.rateLimitResetAt = info?.resetsAt
            ? info.resetsAt * 1000
            : Date.now() + 300_000;
          logger.warn(`Rate limit blocked. Resets at: ${new Date(result.rateLimitResetAt).toISOString()}`);
        } else if (config.verbose && info) {
          logger.debug(`  Rate limit: ${info.status} (resets: ${new Date((info.resetsAt || 0) * 1000).toLocaleTimeString()})`);
        }
      } else if (event.type === 'error') {
        const errMsg = event.error?.message || JSON.stringify(event.error) || 'Unknown error';
        logger.error(`Session #${sessionNum} stream error: ${errMsg}`);
        if (RATE_LIMIT_PATTERNS.test(errMsg)) {
          result.rateLimited = true;
          result.rateLimitResetAt = Date.now() + 300_000;
        }
      } else if (event.type === 'system') {
        // System messages (hooks, tool execution, etc.)
        if (config.verbose) {
          const subtype = event.subtype || '';
          if (subtype === 'hook_response' && event.exit_code !== 0) {
            logger.debug(`  Hook error (${event.hook_name}): exit ${event.exit_code}`);
          }
        }
      }
    }

    // Wait for process exit
    result.exitCode = await new Promise<number>((resolve) => {
      child.on('exit', (code) => {
        if (timeoutTimer) clearTimeout(timeoutTimer);
        resolve(killed ? 0 : (code ?? 1));
      });
      child.on('error', (err) => {
        if (timeoutTimer) clearTimeout(timeoutTimer);
        logger.error(`Failed to spawn claude: ${err.message}`);
        resolve(1);
      });
    });

    result.estimatedOutputTokens = Math.round(totalOutputChars / 4);

    // Log session summary
    logger.debug(`Session #${sessionNum} print mode summary:`);
    logger.debug(`  Tool calls: ${toolUseCount}`);
    logger.debug(`  Output chars: ${totalOutputChars}`);
    logger.debug(`  Est. output tokens: ${result.estimatedOutputTokens}`);
    if (lastToolName) logger.debug(`  Last tool: ${lastToolName}`);

    // Check stderr for rate limit signals
    if (stderrOutput && RATE_LIMIT_PATTERNS.test(stderrOutput)) {
      result.rateLimited = true;
      result.rateLimitResetAt = Date.now() + 300_000;
      logger.warn('Rate limit detected from stderr output');
    }

  } catch (err: any) {
    result.exitCode = 1;
    logger.error(`Print session error: ${err.message}`);
  } finally {
    if (timeoutTimer) clearTimeout(timeoutTimer);
  }

  // Detect rate limiting from exit code + no handoff
  if (result.exitCode !== 0 && !killed && !result.rateLimited) {
    if (RATE_LIMIT_PATTERNS.test(result.resultText) || RATE_LIMIT_PATTERNS.test(stderrOutput)) {
      result.rateLimited = true;
      result.rateLimitResetAt = Date.now() + 300_000;
      logger.warn('Rate limit detected from session output');
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  // RESCUE HANDOFF — the critical safety net
  // If the session did real work (tool calls > 0) but exited without
  // writing valid handoff files, we write rescue files so the relay
  // chain continues instead of dying silently.
  // ══════════════════════════════════════════════════════════════════════
  if (!result.rateLimited && toolUseCount > 0) {
    const handoff = hasValidHandoff(paths);
    if (!handoff.complete && !handoff.handedOff) {
      writeRescueHandoff(paths, config, sessionNum, result.exitCode, toolUseCount, lastToolName);
      // Treat as successful exit so relay continues
      result.exitCode = 0;
    }
  }

  return result;
}

/**
 * Run a single Claude session. Dispatches based on sessionMode.
 */
export async function runSession(
  prompt: string,
  config: CleaveConfig,
  paths: RelayPaths,
  sessionNum: number
): Promise<SessionResult> {
  switch (config.sessionMode) {
    case 'print':
      return runPrintSession(prompt, config, paths, sessionNum);
    case 'tui':
      return runTuiSession(prompt, config, paths, sessionNum);
    case 'headless':
      return runHeadlessSession(prompt, config, paths, sessionNum);
    default:
      // Backward compat: fall back to tui boolean
      return config.tui
        ? runTuiSession(prompt, config, paths, sessionNum)
        : runHeadlessSession(prompt, config, paths, sessionNum);
  }
}
