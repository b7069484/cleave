import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CleaveState } from '../files.js';

describe('CleaveState', () => {
  let tmpDir: string;
  let state: CleaveState;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'cleave-test-'));
    state = new CleaveState(tmpDir);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('initializes .cleave directory', async () => {
    await state.init();
    const { existsSync } = await import('node:fs');
    expect(existsSync(join(tmpDir, '.cleave'))).toBe(true);
    expect(existsSync(join(tmpDir, '.cleave', 'logs'))).toBe(true);
  });

  it('reads and writes session count', async () => {
    await state.init();
    expect(await state.getSessionCount()).toBe(0);
    await state.setSessionCount(3);
    expect(await state.getSessionCount()).toBe(3);
  });

  it('reads and writes NEXT_PROMPT.md', async () => {
    await state.init();
    await state.writeNextPrompt('Continue the task');
    expect(await state.readNextPrompt()).toBe('Continue the task');
  });

  it('reads and writes PROGRESS.md', async () => {
    await state.init();
    await state.writeProgress('## STATUS: IN_PROGRESS\nDid things.');
    expect(await state.readProgress()).toBe('## STATUS: IN_PROGRESS\nDid things.');
  });

  it('reads and writes KNOWLEDGE.md', async () => {
    await state.init();
    await state.writeKnowledge('## Core Knowledge\n- Item 1');
    expect(await state.readKnowledge()).toBe('## Core Knowledge\n- Item 1');
  });

  it('detects handoff signal', async () => {
    await state.init();
    expect(await state.readHandoffSignal()).toBeNull();
    await state.writeHandoffSignal('HANDOFF_COMPLETE');
    expect(await state.readHandoffSignal()).toBe('HANDOFF_COMPLETE');
  });

  it('clears handoff signal for new session', async () => {
    await state.init();
    await state.writeHandoffSignal('HANDOFF_COMPLETE');
    await state.clearHandoffSignal();
    expect(await state.readHandoffSignal()).toBeNull();
  });

  it('archives session files', async () => {
    await state.init();
    await state.writeProgress('progress text');
    await state.writeNextPrompt('next prompt text');
    await state.writeKnowledge('knowledge text');
    await state.archiveSession(1);
    const { existsSync } = await import('node:fs');
    expect(existsSync(join(tmpDir, '.cleave', 'logs', 'session_1_progress.md'))).toBe(true);
    expect(existsSync(join(tmpDir, '.cleave', 'logs', 'session_1_next_prompt.md'))).toBe(true);
  });

  it('marks session start timestamp', async () => {
    await state.init();
    const before = Date.now();
    await state.markSessionStart();
    const ts = await state.getSessionStart();
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(Date.now());
  });
});
