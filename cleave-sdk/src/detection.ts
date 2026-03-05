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
 * Only matches STATUS at the start of a line (with optional markdown formatting
 * like ## or **), avoiding false positives from the marker appearing in
 * descriptions (e.g., "3. Mark STATUS: ALL_COMPLETE").
 */
export function isComplete(progressPath: string, marker: string): boolean {
  try {
    if (!fs.existsSync(progressPath)) return false;
    const content = fs.readFileSync(progressPath, 'utf8');
    const markerEsc = marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // ^ anchors to line start (multiline). Allow optional markdown: ##, **, whitespace
    // Must NOT have letters/digits before STATUS (rejects "3. Mark STATUS:")
    const statusPattern = new RegExp(
      `^[\\s#*]*STATUS[:\\s*]+\\s*(?:${markerEsc}|TASK_FULLY_COMPLETE)`,
      'im'
    );
    return statusPattern.test(content);
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
 * Calculate order-aware similarity using bigram (consecutive line pair) comparison.
 * More robust than exact line matching — catches reworded but structurally identical prompts.
 */
function textSimilarity(textA: string, textB: string): number {
  if (!textA && !textB) return 100;
  if (!textA || !textB) return 0;

  const linesA = textA.split('\n').filter(l => l.trim());
  const linesB = textB.split('\n').filter(l => l.trim());

  if (linesA.length === 0 && linesB.length === 0) return 100;
  if (linesA.length === 0 || linesB.length === 0) return 0;

  // Build bigrams (consecutive line pairs) for order-awareness
  const bigramsA = new Set<string>();
  for (let i = 0; i < linesA.length - 1; i++) {
    bigramsA.add(linesA[i] + '\n' + linesA[i + 1]);
  }
  const bigramsB = new Set<string>();
  for (let i = 0; i < linesB.length - 1; i++) {
    bigramsB.add(linesB[i] + '\n' + linesB[i + 1]);
  }

  let matches = 0;
  for (const bg of bigramsA) {
    if (bigramsB.has(bg)) matches++;
  }

  const maxBigrams = Math.max(bigramsA.size, bigramsB.size);
  if (maxBigrams === 0) return 100;
  return Math.round((matches / maxBigrams) * 100);
}

/**
 * Detect if the current session's NEXT_PROMPT.md is a loop.
 * Compares against last 3 sessions (catches both direct repetition and A-B-A oscillation).
 */
export function detectLoop(
  logsDir: string,
  nextPromptPath: string,
  sessionNum: number,
  threshold: number = 85
): { isLoop: boolean; similarity: number } {
  if (sessionNum < 2) return { isLoop: false, similarity: 0 };
  if (!fs.existsSync(nextPromptPath)) return { isLoop: false, similarity: 0 };

  const currContent = fs.readFileSync(nextPromptPath, 'utf8');

  // Compare against last 3 sessions (catches both direct repetition and oscillation)
  const lookback = Math.min(3, sessionNum - 1);
  let maxSimilarity = 0;

  for (let i = 1; i <= lookback; i++) {
    const prevPromptPath = path.join(logsDir, `session_${sessionNum - i}_next_prompt.md`);
    if (!fs.existsSync(prevPromptPath)) continue;

    try {
      const prevContent = fs.readFileSync(prevPromptPath, 'utf8');
      const similarity = textSimilarity(prevContent, currContent);
      if (similarity > maxSimilarity) maxSimilarity = similarity;
    } catch { continue; }
  }

  return { isLoop: maxSimilarity > threshold, similarity: maxSimilarity };
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
 *
 * TRUST MODEL: The --verify command is provided by the user and executed as a
 * shell command. This is intentional — it's the user's own verification script.
 */
export function runVerification(
  command: string,
  workDir: string,
  timeoutSec: number = 120
): VerifyResult {
  logger.info(`Running verification: ${command}`);

  try {
    const output = execSync(command, {
      cwd: workDir,
      encoding: 'utf8',
      timeout: timeoutSec * 1000,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: '/bin/bash',
    });

    logger.success('Verification PASSED');
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
