import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CleaveState } from '../../state/files.js';
import { detectHandoff, generateRescueHandoff } from '../handoff.js';

describe('detectHandoff', () => {
  let tmpDir: string;
  let state: CleaveState;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'cleave-test-'));
    state = new CleaveState(tmpDir);
    await state.init();
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('returns null when no signal file', async () => {
    const result = await detectHandoff(state);
    expect(result).toBeNull();
  });

  it('returns handoff when signal is HANDOFF_COMPLETE', async () => {
    await state.writeHandoffSignal('HANDOFF_COMPLETE');
    const result = await detectHandoff(state);
    expect(result).toBe('handoff');
  });

  it('returns complete when signal is TASK_FULLY_COMPLETE', async () => {
    await state.writeHandoffSignal('TASK_FULLY_COMPLETE');
    const result = await detectHandoff(state);
    expect(result).toBe('complete');
  });
});

describe('generateRescueHandoff', () => {
  let tmpDir: string;
  let state: CleaveState;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'cleave-test-'));
    state = new CleaveState(tmpDir);
    await state.init();
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('generates rescue files with session context', async () => {
    await generateRescueHandoff(state, 3, 'Original task description');
    const nextPrompt = await state.readNextPrompt();
    const progress = await state.readProgress();
    expect(nextPrompt).toContain('Original task description');
    expect(nextPrompt).toContain('session 3');
    expect(progress).toContain('INTERRUPTED');
  });

  it('preserves existing knowledge', async () => {
    await state.writeKnowledge('## Core Knowledge\n- Important fact');
    await generateRescueHandoff(state, 2, 'Some task');
    const knowledge = await state.readKnowledge();
    expect(knowledge).toContain('Important fact');
  });
});
