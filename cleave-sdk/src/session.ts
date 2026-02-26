/**
 * Session runner — wraps the Agent SDK query() function with cleave-specific
 * options, message handling, and result capture.
 */

import { CleaveConfig } from './config';
import { RelayPaths } from './state/files';
import { buildHooks } from './hooks';
import { logger } from './utils/logger';

export interface SessionResult {
  /** The full text output from Claude */
  resultText: string;

  /** Whether a rate limit was hit during this session */
  rateLimited: boolean;

  /** Rate limit reset time (ms since epoch), if detected */
  rateLimitResetAt: number | null;

  /** Exit code or reason */
  exitReason: string;
}

/**
 * Run a single Claude session via the Agent SDK.
 */
export async function runSession(
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
    resultText: '',
    rateLimited: false,
    rateLimitResetAt: null,
    exitReason: 'normal',
  };

  // Build allowed tools
  const allowedTools = [
    'Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep',
    'WebSearch', 'WebFetch', 'Task',
  ];

  // Build permission mode
  const permissionMode = config.safeMode ? 'default' : 'bypassPermissions';

  // Build hooks
  const hooks = buildHooks(paths, config.completionMarker);

  try {
    logger.debug(`Launching SDK session #${sessionNum} (permission: ${permissionMode})`);

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
      // Handle different message types
      if (message.type === 'assistant') {
        // Claude is responding — extract text content
        for (const block of (message.message?.content || [])) {
          if (block.type === 'text') {
            result.resultText += block.text;
            // Stream to stdout in verbose mode
            if (config.verbose) {
              process.stdout.write(block.text);
            }
          }
        }
      } else if (message.type === 'result') {
        // Session completed
        result.resultText += message.result || '';
        result.exitReason = 'complete';
      } else if (message.type === 'rate_limit') {
        // Rate limit event
        result.rateLimited = true;
        result.rateLimitResetAt = message.resets_at
          ? new Date(message.resets_at).getTime()
          : Date.now() + 300_000; // Default 5 min
        result.exitReason = 'rate_limited';
        logger.warn(`Rate limit hit. Resets at: ${message.resets_at || 'unknown'}`);
        break;
      }
    }
  } catch (err: any) {
    // Check if the error message indicates rate limiting
    const errMsg = String(err.message || err);
    if (/rate.?limit|too many requests|usage.?limit/i.test(errMsg)) {
      result.rateLimited = true;
      result.rateLimitResetAt = Date.now() + 300_000;
      result.exitReason = 'rate_limited';
      logger.warn(`Rate limit detected in error: ${errMsg}`);
    } else {
      result.exitReason = `error: ${errMsg}`;
      logger.error(`Session error: ${errMsg}`);
    }
  }

  return result;
}
