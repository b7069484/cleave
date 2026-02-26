/**
 * Core state file I/O for .cleave/ directory.
 */

import * as fs from 'fs';
import * as path from 'path';

export interface RelayPaths {
  relayDir: string;
  progressFile: string;
  nextPromptFile: string;
  knowledgeFile: string;
  statusFile: string;
  logsDir: string;
  sessionStartMarker: string;
  activeRelayMarker: string;
  sessionCountFile: string;
}

/**
 * Resolve all .cleave/ paths from the work directory.
 */
export function resolvePaths(workDir: string): RelayPaths {
  const relayDir = path.join(workDir, '.cleave');
  return {
    relayDir,
    progressFile: path.join(relayDir, 'PROGRESS.md'),
    nextPromptFile: path.join(relayDir, 'NEXT_PROMPT.md'),
    knowledgeFile: path.join(relayDir, 'KNOWLEDGE.md'),
    statusFile: path.join(relayDir, 'status.json'),
    logsDir: path.join(relayDir, 'logs'),
    sessionStartMarker: path.join(relayDir, '.session_start'),
    activeRelayMarker: path.join(relayDir, '.active_relay'),
    sessionCountFile: path.join(relayDir, '.session_count'),
  };
}

/**
 * Initialize the .cleave/ directory structure.
 */
export function initRelayDir(paths: RelayPaths): void {
  fs.mkdirSync(paths.logsDir, { recursive: true });

  try {
    fs.chmodSync(paths.relayDir, 0o700);
  } catch {
    // Best effort on permissions
  }

  // Initialize knowledge file if it doesn't exist
  if (!fs.existsSync(paths.knowledgeFile)) {
    fs.writeFileSync(paths.knowledgeFile, `# Accumulated Knowledge

## Core Knowledge
Persistent insights that matter for every session. Promote important
discoveries here — this section is never pruned.


## Session Log
Recent session notes (auto-pruned to last ${5} sessions by the relay script).

`);
  }

  // Mark as active relay
  fs.writeFileSync(paths.activeRelayMarker, '1');
  fs.writeFileSync(paths.sessionCountFile, '0');
}

/**
 * Touch the session start marker (for freshness checks).
 */
export function touchSessionStart(paths: RelayPaths, sessionNum: number): void {
  const now = new Date().toISOString();
  fs.writeFileSync(paths.sessionStartMarker, now);
  fs.writeFileSync(paths.sessionCountFile, String(sessionNum));
}

/**
 * Check if a file was modified after the session start marker.
 */
export function wasModifiedThisSession(filePath: string, sessionStartPath: string): boolean {
  if (!fs.existsSync(filePath) || !fs.existsSync(sessionStartPath)) {
    return false;
  }
  const fileStat = fs.statSync(filePath);
  const markerStat = fs.statSync(sessionStartPath);
  return fileStat.mtimeMs > markerStat.mtimeMs;
}

/**
 * Check which handoff files are missing or stale.
 */
export function checkHandoffFiles(paths: RelayPaths): { missing: string[]; stale: string[] } {
  const missing: string[] = [];
  const stale: string[] = [];

  const files = [
    { path: paths.progressFile, name: 'PROGRESS.md' },
    { path: paths.nextPromptFile, name: 'NEXT_PROMPT.md' },
    { path: paths.knowledgeFile, name: 'KNOWLEDGE.md' },
  ];

  for (const file of files) {
    if (!fs.existsSync(file.path)) {
      missing.push(file.name);
    } else if (!wasModifiedThisSession(file.path, paths.sessionStartMarker)) {
      stale.push(file.name);
    }
  }

  return { missing, stale };
}

/**
 * Reset state for a continuation relay.
 * Archives current progress, rewrites PROGRESS.md as IN_PROGRESS,
 * writes the continuation prompt to NEXT_PROMPT.md, preserves KNOWLEDGE.md.
 */
export function resetForContinuation(
  paths: RelayPaths,
  continuePrompt: string,
  currentSessionCount: number
): void {
  // Archive current PROGRESS.md before overwriting
  if (fs.existsSync(paths.progressFile)) {
    const archivePath = path.join(paths.logsDir, 'pre_continuation_PROGRESS.md');
    fs.copyFileSync(paths.progressFile, archivePath);
  }

  // Read existing progress for context
  let previousWork = '';
  if (fs.existsSync(paths.progressFile)) {
    previousWork = fs.readFileSync(paths.progressFile, 'utf8');
  }

  // Rewrite PROGRESS.md with continuation status
  const now = new Date().toISOString();
  fs.writeFileSync(paths.progressFile, `# Relay Progress

STATUS: IN_PROGRESS

## Continuation (started ${now})

### New Task
${continuePrompt}

### Previous Work Summary
${previousWork.replace(/^STATUS:.*$/m, 'STATUS: COMPLETED (prior relay)').trim()}
`);

  // Write NEXT_PROMPT.md so the next session picks up the continuation task
  let knowledgeRef = '';
  if (fs.existsSync(paths.knowledgeFile)) {
    const kLines = fs.readFileSync(paths.knowledgeFile, 'utf8').split('\n').length;
    if (kLines > 10) {
      knowledgeRef = `\n\nIMPORTANT: Read .cleave/KNOWLEDGE.md — it contains ${kLines} lines of accumulated knowledge from prior sessions.\n`;
    }
  }

  fs.writeFileSync(paths.nextPromptFile, `# Continuation Task

You are continuing a Cleave relay. The previous relay completed successfully.
Your job now is to execute the following new task, building on the prior work.
${knowledgeRef}
## New Task

${continuePrompt}

## Context

Read .cleave/PROGRESS.md for a summary of what was accomplished in the prior relay.
All prior files, spreadsheets, and outputs are still in the working directory.
Do NOT redo work that was already completed — build on it.

## When Done

Update .cleave/PROGRESS.md with your results. If the task is fully complete,
set STATUS: ALL_COMPLETE. If you're running low on context, perform the standard
Cleave handoff procedure (update PROGRESS.md, KNOWLEDGE.md, and NEXT_PROMPT.md).
`);

  // Update session counter to continue from where we left off
  fs.writeFileSync(paths.sessionCountFile, String(currentSessionCount));

  // Re-mark as active relay
  fs.writeFileSync(paths.activeRelayMarker, '1');
}

/**
 * Read the current session count from .cleave/.session_count.
 */
export function readSessionCount(paths: RelayPaths): number {
  if (!fs.existsSync(paths.sessionCountFile)) return 0;
  const val = parseInt(fs.readFileSync(paths.sessionCountFile, 'utf8').trim(), 10);
  return isNaN(val) ? 0 : val;
}

/**
 * Clean up relay markers on exit.
 */
export function cleanupRelay(paths: RelayPaths): void {
  const toRemove = [paths.activeRelayMarker, paths.sessionStartMarker];
  for (const f of toRemove) {
    try {
      if (fs.existsSync(f)) fs.unlinkSync(f);
    } catch {
      // Best effort
    }
  }
}
