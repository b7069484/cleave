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
