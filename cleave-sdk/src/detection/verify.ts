/**
 * External verification command execution.
 * Runs a user-provided command to objectively verify task completion.
 */

import { execSync } from 'child_process';
import { logger } from '../utils/logger';

export interface VerifyResult {
  passed: boolean;
  exitCode: number;
  output: string;
}

/**
 * Run the verification command. Exit code 0 = task is done.
 */
export function runVerification(command: string, workDir: string): VerifyResult {
  logger.info(`🔍 Running verification: ${command}`);

  try {
    const output = execSync(command, {
      cwd: workDir,
      encoding: 'utf8',
      timeout: 60_000, // 60 second timeout
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    logger.success('✅ Verification PASSED — task is objectively complete');
    return { passed: true, exitCode: 0, output };
  } catch (err: any) {
    const exitCode = err.status ?? 1;
    const output = (err.stdout || '') + (err.stderr || '');
    logger.debug(`  Verification returned exit code ${exitCode} — task not yet complete`);
    return { passed: false, exitCode, output };
  }
}
