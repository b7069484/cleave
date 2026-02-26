/**
 * Hook management for Cleave SDK.
 *
 * In TUI mode: generates a temporary settings JSON file with shell-based hooks
 * that enforce handoff behavior. Passed to `claude --settings <file>`.
 *
 * In headless mode (--no-tui): builds programmatic hooks for the SDK query() API.
 */

import * as fs from 'fs';
import * as path from 'path';
import { RelayPaths, checkHandoffFiles } from './state/files';
import { isComplete } from './detection/completion';
import { logger } from './utils/logger';

/**
 * Resolve the absolute path to the scripts directory.
 * Works whether running from src/ (ts-node) or dist/ (compiled).
 */
function scriptsDir(): string {
  // __dirname is either src/ or dist/src/ — scripts are at project root/scripts/
  let dir = __dirname;
  // Walk up until we find scripts/
  for (let i = 0; i < 5; i++) {
    const candidate = path.join(dir, 'scripts');
    if (fs.existsSync(candidate)) return candidate;
    dir = path.dirname(dir);
  }
  // Fallback: assume scripts/ is sibling to dist/
  return path.join(path.dirname(path.dirname(__dirname)), 'scripts');
}

/**
 * Generate a settings JSON file for the `claude --settings` flag.
 * Contains Stop and SessionStart hooks that enforce the handoff protocol.
 *
 * Returns the path to the generated settings file.
 */
export function generateSettingsFile(relayDir: string): string {
  const stopScript = path.join(scriptsDir(), 'stop-check.sh');
  const startScript = path.join(scriptsDir(), 'session-start.sh');

  // Verify scripts exist
  if (!fs.existsSync(stopScript)) {
    logger.warn(`Stop hook script not found: ${stopScript}`);
  }
  if (!fs.existsSync(startScript)) {
    logger.warn(`SessionStart hook script not found: ${startScript}`);
  }

  // Quote paths to handle spaces in directory names (e.g., "Cleave Code")
  const quotedStopScript = `"${stopScript}"`;
  const quotedStartScript = `"${startScript}"`;

  const settings = {
    hooks: {
      Stop: [
        {
          hooks: [
            {
              type: 'command',
              command: quotedStopScript,
              timeout: 10,
            },
          ],
        },
      ],
      SessionStart: [
        {
          hooks: [
            {
              type: 'command',
              command: quotedStartScript,
              timeout: 5,
            },
          ],
        },
      ],
    },
  };

  const settingsPath = path.join(relayDir, '.cleave-settings.json');
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  logger.debug(`Generated settings file: ${settingsPath}`);
  return settingsPath;
}

/**
 * Build programmatic hooks for the SDK query() API (headless/--no-tui mode).
 * Same enforcement logic as the shell scripts, but as async JS functions.
 */
export function buildHooks(paths: RelayPaths, completionMarker: string) {
  return {
    Stop: [
      {
        hooks: [
          async (_input: any) => {
            // If task is fully complete, allow exit
            if (isComplete(paths.progressFile, completionMarker)) {
              logger.debug('Stop hook: task complete, allowing exit');
              return {};
            }

            // Check if handoff files were written this session
            const { missing, stale } = checkHandoffFiles(paths);

            if (missing.length === 0 && stale.length === 0) {
              logger.debug('Stop hook: handoff files verified, allowing exit');
              return {};
            }

            // Handoff incomplete — block exit
            let errorMsg = 'CLEAVE HANDOFF INCOMPLETE — You cannot exit yet.\n\n';

            if (missing.length > 0) {
              errorMsg += `Missing files: ${missing.join(', ')}\n`;
            }
            if (stale.length > 0) {
              errorMsg += `Not updated this session: ${stale.join(', ')}\n`;
            }

            errorMsg += '\nYou MUST complete the handoff procedure before exiting:\n';
            errorMsg += '1. Update .cleave/PROGRESS.md with current status and exact stop point\n';
            errorMsg += '2. Update .cleave/KNOWLEDGE.md — promote insights to Core, append session notes\n';
            errorMsg += '3. Write .cleave/NEXT_PROMPT.md — complete prompt for next session\n';
            errorMsg += '4. Print RELAY_HANDOFF_COMPLETE or TASK_FULLY_COMPLETE\n';
            errorMsg += `\nIf ALL work is done, set STATUS: ${completionMarker} in PROGRESS.md.`;

            logger.debug('Stop hook: blocking exit — handoff incomplete');

            return {
              decision: 'block',
              reason: errorMsg,
            };
          },
        ],
      },
    ],
  };
}
