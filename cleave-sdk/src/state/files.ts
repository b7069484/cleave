/**
 * Core state file I/O for .cleave/ directory.
 * Handles both standard relay state and pipeline stage state.
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
  handoffSignalFile: string;
}

export interface PipelineState {
  name: string;
  startedAt: string;
  currentStage: string | null;
  stages: Record<string, 'pending' | 'in_progress' | 'complete' | 'failed' | 'skipped'>;
}

// ── Path Resolution ──

/** Resolve all .cleave/ paths from the work directory. */
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
    handoffSignalFile: path.join(relayDir, '.handoff_signal'),
  };
}

/** Resolve paths for a specific pipeline stage (isolated under .cleave/stages/<name>/). */
export function resolveStagePaths(workDir: string, stageName: string): RelayPaths {
  const stageDir = path.join(workDir, '.cleave', 'stages', stageName);
  return {
    relayDir: stageDir,
    progressFile: path.join(stageDir, 'PROGRESS.md'),
    nextPromptFile: path.join(stageDir, 'NEXT_PROMPT.md'),
    knowledgeFile: path.join(stageDir, 'KNOWLEDGE.md'),
    statusFile: path.join(stageDir, 'status.json'),
    logsDir: path.join(stageDir, 'logs'),
    sessionStartMarker: path.join(stageDir, '.session_start'),
    activeRelayMarker: path.join(stageDir, '.active_relay'),
    sessionCountFile: path.join(stageDir, '.session_count'),
    handoffSignalFile: path.join(stageDir, '.handoff_signal'),
  };
}

/** Path to shared pipeline knowledge file. */
export function sharedKnowledgePath(workDir: string): string {
  return path.join(workDir, '.cleave', 'shared', 'KNOWLEDGE.md');
}

// ── Safe File Operations ──

/** Write a file, ensuring parent directory exists. */
function safeWrite(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

/** Verify a directory is writable by attempting a test write. */
function verifyWritable(dir: string): void {
  const testFile = path.join(dir, '.write_test');
  try {
    fs.writeFileSync(testFile, 'test');
    fs.unlinkSync(testFile);
  } catch (err: any) {
    throw new Error(`Directory is not writable: ${dir} — ${err.message}`);
  }
}

// ── Initialization ──

/** Initialize the .cleave/ directory structure. Verifies write permissions. */
export function initRelayDir(paths: RelayPaths): void {
  fs.mkdirSync(paths.logsDir, { recursive: true });

  try {
    fs.chmodSync(paths.relayDir, 0o700);
  } catch { /* best effort */ }

  // Verify we can actually write to this directory
  verifyWritable(paths.relayDir);

  // Initialize knowledge file if it doesn't exist
  if (!fs.existsSync(paths.knowledgeFile)) {
    safeWrite(paths.knowledgeFile, `# Accumulated Knowledge

## Core Knowledge
Persistent insights that matter for every session. Promote important
discoveries here — this section is never pruned.


## Session Log
Recent session notes (auto-pruned to last 5 sessions by the relay script).

`);
  }

  // Mark as active relay
  fs.writeFileSync(paths.activeRelayMarker, '1');
  if (!fs.existsSync(paths.sessionCountFile)) {
    fs.writeFileSync(paths.sessionCountFile, '0');
  }
}

/** Initialize pipeline directory with stage subdirectories. */
export function initPipelineDir(workDir: string, stageNames: string[]): PipelineState {
  const pipelineDir = path.join(workDir, '.cleave');
  const sharedDir = path.join(pipelineDir, 'shared');
  fs.mkdirSync(sharedDir, { recursive: true });

  // Create stage directories
  const stages: Record<string, 'pending'> = {};
  for (const name of stageNames) {
    fs.mkdirSync(path.join(pipelineDir, 'stages', name, 'logs'), { recursive: true });
    stages[name] = 'pending';
  }

  const state: PipelineState = {
    name: '',
    startedAt: new Date().toISOString(),
    currentStage: null,
    stages,
  };

  savePipelineState(workDir, state);
  return state;
}

// ── Session Markers ──

/** Touch the session start marker (for freshness checks). */
export function touchSessionStart(paths: RelayPaths, sessionNum: number): void {
  fs.writeFileSync(paths.sessionStartMarker, new Date().toISOString());
  fs.writeFileSync(paths.sessionCountFile, String(sessionNum));
  // Clear handoff signal from previous session so the poller starts fresh
  try { if (fs.existsSync(paths.handoffSignalFile)) fs.unlinkSync(paths.handoffSignalFile); } catch { /* best effort */ }
}

/** Check if a file was modified after the session start marker. */
export function wasModifiedThisSession(filePath: string, sessionStartPath: string): boolean {
  try {
    if (!fs.existsSync(filePath) || !fs.existsSync(sessionStartPath)) return false;
    return fs.statSync(filePath).mtimeMs > fs.statSync(sessionStartPath).mtimeMs;
  } catch {
    return false;
  }
}

/** Check which handoff files are missing or stale. */
export function checkHandoffFiles(paths: RelayPaths): { missing: string[]; stale: string[] } {
  const missing: string[] = [];
  const stale: string[] = [];

  for (const [fpath, name] of [
    [paths.progressFile, 'PROGRESS.md'],
    [paths.nextPromptFile, 'NEXT_PROMPT.md'],
    [paths.knowledgeFile, 'KNOWLEDGE.md'],
  ] as const) {
    if (!fs.existsSync(fpath)) {
      missing.push(name);
    } else if (!wasModifiedThisSession(fpath, paths.sessionStartMarker)) {
      stale.push(name);
    }
  }

  return { missing, stale };
}

// ── Continuation Mode ──

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
    fs.mkdirSync(path.dirname(archivePath), { recursive: true });
    fs.copyFileSync(paths.progressFile, archivePath);
  }

  const previousWork = fs.existsSync(paths.progressFile)
    ? fs.readFileSync(paths.progressFile, 'utf8') : '';

  const now = new Date().toISOString();
  safeWrite(paths.progressFile, `# Relay Progress

STATUS: IN_PROGRESS

## Continuation (started ${now})

### New Task
${continuePrompt}

### Previous Work Summary
${previousWork.replace(/^STATUS:.*$/m, 'STATUS: COMPLETED (prior relay)').trim()}
`);

  // Build NEXT_PROMPT.md
  let knowledgeRef = '';
  if (fs.existsSync(paths.knowledgeFile)) {
    const kLines = fs.readFileSync(paths.knowledgeFile, 'utf8').split('\n').length;
    if (kLines > 10) {
      knowledgeRef = `\n\nIMPORTANT: Read .cleave/KNOWLEDGE.md — it contains ${kLines} lines of accumulated knowledge from prior sessions.\n`;
    }
  }

  safeWrite(paths.nextPromptFile, `# Continuation Task

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

  fs.writeFileSync(paths.sessionCountFile, String(currentSessionCount));
  fs.writeFileSync(paths.activeRelayMarker, '1');
}

export function readSessionCount(paths: RelayPaths): number {
  try {
    if (!fs.existsSync(paths.sessionCountFile)) return 0;
    const val = parseInt(fs.readFileSync(paths.sessionCountFile, 'utf8').trim(), 10);
    return isNaN(val) ? 0 : val;
  } catch {
    return 0;
  }
}

// ── Pipeline State ──

export function savePipelineState(workDir: string, state: PipelineState): void {
  const statePath = path.join(workDir, '.cleave', 'pipeline_state.json');
  safeWrite(statePath, JSON.stringify(state, null, 2));
}

export function loadPipelineState(workDir: string): PipelineState | null {
  const statePath = path.join(workDir, '.cleave', 'pipeline_state.json');
  try {
    if (!fs.existsSync(statePath)) return null;
    return JSON.parse(fs.readFileSync(statePath, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Promote stage knowledge entries to shared pipeline knowledge.
 * Appends stage's Core Knowledge section to .cleave/shared/KNOWLEDGE.md.
 */
export function promoteToSharedKnowledge(stageKnowledgePath: string, workDir: string, stageName: string): void {
  if (!fs.existsSync(stageKnowledgePath)) return;

  const content = fs.readFileSync(stageKnowledgePath, 'utf8');

  // Extract Core Knowledge section
  const coreMatch = content.match(/## Core Knowledge\s*\n([\s\S]*?)(?=\n## |\n$)/);
  if (!coreMatch || !coreMatch[1].trim()) return;

  const sharedPath = sharedKnowledgePath(workDir);
  const header = `\n### From stage: ${stageName}\n`;
  const entry = header + coreMatch[1].trim() + '\n\n';

  if (fs.existsSync(sharedPath)) {
    fs.appendFileSync(sharedPath, entry);
  } else {
    safeWrite(sharedPath, `# Shared Pipeline Knowledge\n\nCross-stage insights promoted by completed stages.\n${entry}`);
  }
}

/** Reset a stage for retry — clear progress but preserve knowledge. */
export function resetStageForRetry(stagePaths: RelayPaths): void {
  const toRemove = [stagePaths.progressFile, stagePaths.nextPromptFile, stagePaths.sessionStartMarker];
  for (const f of toRemove) {
    try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch { /* best effort */ }
  }
  try { fs.writeFileSync(stagePaths.sessionCountFile, '0'); } catch { /* best effort */ }
}

// ── Cleanup ──

/** Clean up relay markers on exit. */
export function cleanupRelay(paths: RelayPaths): void {
  for (const f of [paths.activeRelayMarker, paths.sessionStartMarker, paths.handoffSignalFile]) {
    try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch { /* best effort */ }
  }
}
