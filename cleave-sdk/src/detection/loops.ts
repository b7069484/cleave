/**
 * Loop detection — compare consecutive NEXT_PROMPT.md files for >85% similarity.
 */

import * as fs from 'fs';
import * as path from 'path';

/**
 * Calculate line-level similarity between two texts.
 * Returns a percentage (0-100) of identical lines.
 */
function lineSimilarity(textA: string, textB: string): number {
  const linesA = textA.split('\n').sort();
  const linesB = textB.split('\n').sort();

  const setB = new Set(linesB);
  const totalLines = Math.max(linesA.length, linesB.length);

  if (totalLines === 0) return 100;

  let identicalCount = 0;
  for (const line of linesA) {
    if (setB.has(line)) {
      identicalCount++;
    }
  }

  return Math.round((identicalCount / totalLines) * 100);
}

/**
 * Detect if the current session's NEXT_PROMPT.md is a loop
 * (>85% similar to the previous session's archived prompt).
 */
export function detectLoop(
  logsDir: string,
  nextPromptPath: string,
  sessionNum: number,
  threshold: number = 85
): { isLoop: boolean; similarity: number } {
  if (sessionNum < 3) {
    return { isLoop: false, similarity: 0 };
  }

  const prevSessionNum = sessionNum - 1;
  const prevPromptPath = path.join(logsDir, `session_${prevSessionNum}_next_prompt.md`);

  if (!fs.existsSync(prevPromptPath) || !fs.existsSync(nextPromptPath)) {
    return { isLoop: false, similarity: 0 };
  }

  const prevContent = fs.readFileSync(prevPromptPath, 'utf8');
  const currContent = fs.readFileSync(nextPromptPath, 'utf8');

  // Quick size check — if sizes differ by more than 10%, not a loop
  const sizeDiff = Math.abs(prevContent.length - currContent.length);
  const sizeThreshold = prevContent.length * 0.1;
  if (sizeDiff > sizeThreshold) {
    return { isLoop: false, similarity: 0 };
  }

  // Deep comparison
  const similarity = lineSimilarity(prevContent, currContent);

  return {
    isLoop: similarity > threshold,
    similarity,
  };
}
