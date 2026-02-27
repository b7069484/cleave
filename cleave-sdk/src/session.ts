/**
 * Session runner — two modes:
 *
 * TUI mode (default): Spawns `claude` as a child process with full TUI.
 *   A background file poller watches for handoff completion and sends
 *   SIGTERM to the TUI when done, so the relay loop can start the next
 *   session. Without this, the TUI idles at `❯` forever and blocks chaining.
 *
 * Headless mode (--no-tui): Uses the Agent SDK query() function for
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

export interface SessionResult {
  exitCode: number;
  rateLimited: boolean;
  rateLimitResetAt: number | null;
  resultText: string;
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
    // 1. Check for completion marker (task fully done)
    if (fs.existsSync(paths.progressFile)) {
      const content = fs.readFileSync(paths.progressFile, 'utf8').toLowerCase();
      const marker = completionMarker.toLowerCase();
      if (content.includes(marker) || content.includes('task_fully_complete')) {
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
          // Stability check: ensure NEXT_PROMPT.md size is stable between polls
          // (protects against SIGTERMing while Claude is mid-write)
          const currentSize = fs.existsSync(paths.nextPromptFile)
            ? fs.statSync(paths.nextPromptFile).size : 0;

          if (currentSize === lastNextPromptSize && lastNextPromptSize >= 0) {
            // Files stable for 2 consecutive polls — safe to kill
            logger.debug(`Handoff detected + files stable — terminating TUI session #${sessionNum}`);
            killedByRelay = true;
            if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }

            // Grace period: 2 seconds for any final I/O
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
    logger.error(`Failed to import @anthropic-ai/claude-agent-sdk: ${err.message}`);
    logger.error('Install it with: npm install @anthropic-ai/claude-agent-sdk');
    throw new Error(`Agent SDK not available: ${err.message}`);
  }

  const result: SessionResult = {
    exitCode: 0,
    rateLimited: false,
    rateLimitResetAt: null,
    resultText: '',
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
 * Run a single Claude session. Dispatches to TUI or headless based on config.
 */
export async function runSession(
  prompt: string,
  config: CleaveConfig,
  paths: RelayPaths,
  sessionNum: number
): Promise<SessionResult> {
  return config.tui
    ? runTuiSession(prompt, config, paths, sessionNum)
    : runHeadlessSession(prompt, config, paths, sessionNum);
}
