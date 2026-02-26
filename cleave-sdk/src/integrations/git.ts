/**
 * Git integration — auto-commit after each session.
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger';

/**
 * Check if the work directory is a git repository.
 */
export function isGitRepo(workDir: string): boolean {
  return fs.existsSync(path.join(workDir, '.git'));
}

/**
 * Stage all changes and commit with a session checkpoint message.
 */
export function commitSession(workDir: string, sessionNum: number): boolean {
  if (!isGitRepo(workDir)) {
    logger.warn(`Git: --git-commit enabled but ${workDir} is not a git repo`);
    return false;
  }

  try {
    // Stage all changes
    execSync('git add -A', { cwd: workDir, stdio: 'pipe' });

    // Check if there are staged changes
    const diff = execSync('git diff --cached --stat', {
      cwd: workDir,
      encoding: 'utf8',
      stdio: 'pipe',
    }).trim();

    if (!diff) {
      logger.debug(`Git: no changes to commit for session #${sessionNum}`);
      return false;
    }

    // Commit
    execSync(`git commit -m "cleave: session #${sessionNum} checkpoint" --no-verify`, {
      cwd: workDir,
      stdio: 'pipe',
    });

    logger.debug(`  Git: committed session #${sessionNum} changes`);
    return true;
  } catch (err: any) {
    logger.warn(`Git: commit failed for session #${sessionNum}: ${err.message}`);
    return false;
  }
}
