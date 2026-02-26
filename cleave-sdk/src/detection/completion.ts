/**
 * Completion detection — check PROGRESS.md for the completion marker.
 */

import * as fs from 'fs';

/**
 * Check if the task is complete by looking for the marker in PROGRESS.md.
 * Searches the first 10 lines, case-insensitive.
 */
export function isComplete(progressPath: string, marker: string): boolean {
  if (!fs.existsSync(progressPath)) {
    return false;
  }

  const content = fs.readFileSync(progressPath, 'utf8');
  const firstLines = content.split('\n').slice(0, 10).join('\n');
  return firstLines.toLowerCase().includes(marker.toLowerCase());
}

/**
 * Check if Claude's output stream contains a completion signal.
 */
export function hasCompletionSignal(output: string): 'handoff' | 'complete' | null {
  if (output.includes('TASK_FULLY_COMPLETE')) {
    return 'complete';
  }
  if (output.includes('RELAY_HANDOFF_COMPLETE')) {
    return 'handoff';
  }
  return null;
}
