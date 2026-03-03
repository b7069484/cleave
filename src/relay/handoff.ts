import { CleaveState } from '../state/files.js';

export type HandoffResult = 'handoff' | 'complete' | null;

export async function detectHandoff(state: CleaveState): Promise<HandoffResult> {
  const signal = await state.readHandoffSignal();
  if (!signal) return null;

  const normalized = signal.trim().toUpperCase();
  if (normalized.includes('TASK_FULLY_COMPLETE')) return 'complete';
  if (normalized.includes('HANDOFF_COMPLETE')) return 'handoff';
  return null;
}

export async function generateRescueHandoff(
  state: CleaveState,
  sessionNum: number,
  originalTask: string,
): Promise<void> {
  // Preserve existing knowledge
  const existingKnowledge = await state.readKnowledge();

  // Generate rescue progress
  await state.writeProgress(
    `## STATUS: INTERRUPTED\n\nSession ${sessionNum} was interrupted before writing handoff files.\nThis is an auto-generated rescue handoff.\n`
  );

  // Generate rescue prompt
  await state.writeNextPrompt(
    `# Rescue Handoff — Continuing from session ${sessionNum}\n\n` +
    `The previous session was interrupted before completing its handoff.\n\n` +
    `## Original Task\n${originalTask}\n\n` +
    `## Instructions\n` +
    `1. Check .cleave/PROGRESS.md for any partial progress notes\n` +
    `2. Check git log and git diff for changes made by the previous session\n` +
    `3. Continue the original task from where it left off\n`
  );

  // Ensure knowledge file exists (don't overwrite if it has content)
  if (!existingKnowledge.trim()) {
    await state.writeKnowledge('## Core Knowledge\n\n## Session Log\n');
  }

  await state.writeHandoffSignal('HANDOFF_COMPLETE');
}
