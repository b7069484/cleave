/**
 * Detection module — completion checking, loop detection, and verification.
 * Merged from detection/completion.ts, detection/loops.ts, detection/verify.ts.
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { logger } from './utils/logger';

// ── Completion Detection ──

/**
 * Check if the task is complete by looking for the marker in PROGRESS.md.
 * Searches the first 10 lines, case-insensitive.
 */
export function isComplete(progressPath: string, marker: string): boolean {
  try {
    if (!fs.existsSync(progressPath)) return false;
    const content = fs.readFileSync(progressPath, 'utf8');
    const firstLines = content.split('\n').slice(0, 10).join('\n');
    return firstLines.toLowerCase().includes(marker.toLowerCase());
  } catch {
    return false; // Can't read → not complete
  }
}

/**
 * Check if Claude's output stream contains a completion signal.
 */
export function hasCompletionSignal(output: string): 'handoff' | 'complete' | null {
  if (output.includes('TASK_FULLY_COMPLETE')) return 'complete';
  if (output.includes('RELAY_HANDOFF_COMPLETE')) return 'handoff';
  return null;
}

// ── Loop Detection ──

/**
 * Calculate line-level similarity WITHOUT sorting (preserves structural order).
 * Uses bigram overlap for fuzzy comparison — more robust than exact line matching.
 */
function textSimilarity(textA: string, textB: string): number {
  if (!textA && !textB) return 100;
  if (!textA || !textB) return 0;

  // Bigram-based similarity (pairs of consecutive lines)
  const linesA = textA.split('\n').filter(l => l.trim());
  const linesB = textB.split('\n').filter(l => l.trim());

  if (linesA.length === 0 && linesB.length === 0) return 100;
  if (linesA.length === 0 || linesB.length === 0) return 0;

  // Use line-level set intersection (without sorting — compare exact lines)
  const setB = new Set(linesB);
  let matches = 0;
  for (const line of linesA) {
    if (setB.has(line)) matches++;
  }

  const maxLines = Math.max(linesA.length, linesB.length);
  return Math.round((matches / maxLines) * 100);
}

/**
 * Detect if the current session's NEXT_PROMPT.md is a loop
 * (>85% similar to the previous session's archived prompt).
 * Checks from session 2 onward (not just 3+).
 */
export function detectLoop(
  logsDir: string,
  nextPromptPath: string,
  sessionNum: number,
  threshold: number = 85
): { isLoop: boolean; similarity: number } {
  if (sessionNum < 2) return { isLoop: false, similarity: 0 };

  const prevPromptPath = path.join(logsDir, `session_${sessionNum - 1}_next_prompt.md`);

  if (!fs.existsSync(prevPromptPath) || !fs.existsSync(nextPromptPath)) {
    return { isLoop: false, similarity: 0 };
  }

  try {
    const prevContent = fs.readFileSync(prevPromptPath, 'utf8');
    const currContent = fs.readFileSync(nextPromptPath, 'utf8');

    // Quick size check — if sizes differ by more than 20%, not a loop
    const sizeDiff = Math.abs(prevContent.length - currContent.length);
    if (sizeDiff > prevContent.length * 0.2) {
      return { isLoop: false, similarity: 0 };
    }

    const similarity = textSimilarity(prevContent, currContent);
    return { isLoop: similarity > threshold, similarity };
  } catch {
    return { isLoop: false, similarity: 0 };
  }
}

// ── Verification ──

export interface VerifyResult {
  passed: boolean;
  exitCode: number;
  output: string;
}

/**
 * Run the verification command. Exit code 0 = task is done.
 * Timeout is now configurable (passed from CleaveConfig.verifyTimeout).
 */
export function runVerification(
  command: string,
  workDir: string,
  timeoutSec: number = 120
): VerifyResult {
  logger.info(`🔍 Running verification: ${command}`);

  try {
    const output = execSync(command, {
      cwd: workDir,
      encoding: 'utf8',
      timeout: timeoutSec * 1000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    logger.success('✅ Verification PASSED');
    return { passed: true, exitCode: 0, output };
  } catch (err: any) {
    const exitCode = err.status ?? 1;
    const stdout = err.stdout || '';
    const stderr = err.stderr || '';
    const output = stdout + stderr;

    if (err.killed) {
      logger.warn(`Verification timed out after ${timeoutSec}s`);
    } else {
      logger.debug(`Verification exit code ${exitCode}`);
      if (stderr) logger.debug(`Verification stderr: ${stderr.slice(0, 200)}`);
    }

    return { passed: false, exitCode, output };
  }
}
