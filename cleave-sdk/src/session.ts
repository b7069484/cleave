/**
 * Session runner — two modes:
 *
 * TUI mode (default): Spawns `claude` as a child process with stdio inherited,
 *   so the user sees the full Claude Code TUI. Hooks are enforced via a
 *   generated settings JSON file passed to `--settings`.
 *
 * Headless mode (--no-tui): Uses the Agent SDK query() function for
 *   programmatic control. No TUI — text streams to stdout.
 */

import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { CleaveConfig } from './config';
import { RelayPaths } from './state/files';
import { buildHooks, generateSettingsFile } from './hooks';
import { buildHandoffInstructions } from './utils/prompt-builder';
import { logger } from './utils/logger';

export interface SessionResult {
  /** Process exit code (TUI mode) or synthetic code (headless) */
  exitCode: number;

  /** Whether a rate limit was hit during this session */
  rateLimited: boolean;

  /** Rate limit reset time (ms since epoch), if detected */
  rateLimitResetAt: number | null;

  /** Full text output from Claude (headless mode only, empty in TUI mode) */
  resultText: string;
}

/**
 * Write the prompt to a file and return a short instruction to read it.
 * This avoids command-line arg length limits for long prompts.
 */
function writePromptFile(relayDir: string, prompt: string): string {
  const promptPath = path.join(relayDir, '.session_prompt.md');
  fs.writeFileSync(promptPath, prompt, 'utf8');
  return promptPath;
}

/**
 * Run a session in TUI mode — spawns `claude` with inherited stdio.
 * The user sees the full Claude Code interactive interface.
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

  // Generate the settings file with Stop + SessionStart hooks
  const settingsPath = generateSettingsFile(paths.relayDir);

  // Write the task prompt to a file (avoids arg length issues)
  const promptFilePath = writePromptFile(paths.relayDir, taskPrompt);

  // Build the handoff instructions for --append-system-prompt
  const handoffInstructions = buildHandoffInstructions(config);

  // Build claude CLI arguments
  const args: string[] = [];

  // The task prompt: tell Claude to read the prompt file
  args.push(
    `You are session #${sessionNum} of an automated Cleave relay. ` +
    `Read the file "${promptFilePath}" for your full task instructions. ` +
    `Execute those instructions immediately. Do NOT ask for confirmation.`
  );

  // Inject handoff instructions as system prompt
  args.push('--append-system-prompt', handoffInstructions);

  // Load hooks via settings
  args.push('--settings', settingsPath);

  // Permission mode
  if (!config.safeMode) {
    args.push('--dangerously-skip-permissions');
  }

  logger.debug(`Launching TUI session #${sessionNum}`);
  logger.debug(`  Prompt file: ${promptFilePath}`);
  logger.debug(`  Settings: ${settingsPath}`);

  try {
    const child = spawn('claude', args, {
      stdio: 'inherit',
      cwd: config.workDir,
      env: {
        ...process.env,
        CLEAVE_SESSION: String(sessionNum),
        CLEAVE_WORK_DIR: config.workDir,
      },
    });

    result.exitCode = await new Promise<number>((resolve, reject) => {
      child.on('exit', (code) => resolve(code ?? 1));
      child.on('error', (err) => {
        logger.error(`Failed to spawn claude: ${err.message}`);
        reject(err);
      });
    });
  } catch (err: any) {
    result.exitCode = 1;
    logger.error(`TUI session error: ${err.message}`);
  }

  // Detect rate limiting from exit patterns
  // If Claude exited abnormally and handoff files weren't written, it might be rate limited
  if (result.exitCode !== 0) {
    const progressFresh = fs.existsSync(paths.progressFile) &&
      fs.existsSync(paths.sessionStartMarker) &&
      fs.statSync(paths.progressFile).mtimeMs > fs.statSync(paths.sessionStartMarker).mtimeMs;

    if (!progressFresh) {
      // Session ended without writing handoff — could be rate limit or crash
      // Check if the completion marker is set (task done)
      const progressContent = fs.existsSync(paths.progressFile)
        ? fs.readFileSync(paths.progressFile, 'utf8')
        : '';
      if (/rate.?limit|usage.?limit|too many/i.test(progressContent)) {
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
 * No TUI — text streams to stdout in verbose mode.
 */
async function runHeadlessSession(
  prompt: string,
  config: CleaveConfig,
  paths: RelayPaths,
  sessionNum: number
): Promise<SessionResult> {
  // Dynamic import — the SDK may not be installed at lint time
  let query: any;
  try {
    const sdk = await import('@anthropic-ai/claude-agent-sdk');
    query = sdk.query;
  } catch (err) {
    logger.error('Failed to import @anthropic-ai/claude-agent-sdk');
    logger.error('Install it with: npm install @anthropic-ai/claude-agent-sdk');
    throw new Error('Agent SDK not available');
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
            if (config.verbose) {
              process.stdout.write(block.text);
            }
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
    if (/rate.?limit|too many requests|usage.?limit/i.test(errMsg)) {
      result.rateLimited = true;
      result.rateLimitResetAt = Date.now() + 300_000;
      logger.warn(`Rate limit detected in error: ${errMsg}`);
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
  if (config.tui) {
    return runTuiSession(prompt, config, paths, sessionNum);
  } else {
    return runHeadlessSession(prompt, config, paths, sessionNum);
  }
}
