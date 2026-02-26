/**
 * Session runner — two modes:
 *
 * TUI mode (default): Spawns `claude` as a child process with stdio inherited,
 *   so the user sees the full Claude Code TUI.
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
 * Run a session in TUI mode — spawns `claude` with inherited stdio.
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
  if (result.exitCode !== 0) {
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
