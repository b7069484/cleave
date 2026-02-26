/**
 * Programmatic hook definitions for the Agent SDK.
 *
 * The Stop hook is the key enforcement mechanism — it blocks Claude from
 * exiting until the handoff files (PROGRESS.md, KNOWLEDGE.md, NEXT_PROMPT.md)
 * have been written this session.
 *
 * This is the single biggest improvement over v2/v3: no shell scripts,
 * no exit code 2 bugs, no JSON parsing issues. Just async functions.
 */

import { RelayPaths, checkHandoffFiles } from './state/files';
import { isComplete } from './detection/completion';
import { logger } from './utils/logger';

/**
 * Build the hooks configuration for the SDK query() options.
 *
 * The SDK hooks format uses event names as keys, each mapping to an array
 * of hook group objects. Each group has a `hooks` array with the actual
 * hook implementations.
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
              // All handoff files present and fresh — allow exit
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
            errorMsg += '\nIf the task is fully done, set STATUS: ALL_COMPLETE in PROGRESS.md.';

            logger.debug('Stop hook: blocking exit — handoff incomplete');

            // Return decision to block the exit and feed error message back to Claude
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
