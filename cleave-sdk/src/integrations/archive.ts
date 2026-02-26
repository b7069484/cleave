/**
 * Session archiving — copy state files to logs/ after each session.
 */

import * as fs from 'fs';
import * as path from 'path';
import { RelayPaths } from '../state/files';
import { logger } from '../utils/logger';

/**
 * Archive the current session's state files to the logs directory.
 */
export function archiveSession(paths: RelayPaths, sessionNum: number, promptUsed: string): void {
  const logsDir = paths.logsDir;

  // Ensure logs directory exists
  fs.mkdirSync(logsDir, { recursive: true });

  // Archive each state file
  const filesToArchive = [
    { src: paths.progressFile, suffix: 'progress' },
    { src: paths.nextPromptFile, suffix: 'next_prompt' },
    { src: paths.knowledgeFile, suffix: 'knowledge' },
  ];

  for (const { src, suffix } of filesToArchive) {
    if (fs.existsSync(src)) {
      const dst = path.join(logsDir, `session_${sessionNum}_${suffix}.md`);
      try {
        fs.copyFileSync(src, dst);
      } catch (err: any) {
        logger.warn(`Archive: failed to copy ${path.basename(src)}: ${err.message}`);
      }
    }
  }

  // Archive the prompt that was used
  const promptDst = path.join(logsDir, `session_${sessionNum}_prompt.md`);
  try {
    fs.writeFileSync(promptDst, promptUsed);
  } catch (err: any) {
    logger.warn(`Archive: failed to write prompt: ${err.message}`);
  }
}
