import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock SessionRunner
vi.mock('../session.js', () => ({
  SessionRunner: vi.fn(),
}));

import { SessionRunner } from '../session.js';
import { CleaveState } from '../../state/files.js';
import { RelayLoop } from '../loop.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('RelayLoop', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'cleave-test-'));
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('runs a single session when task completes in session 1', async () => {
    const state = new CleaveState(tmpDir);
    await state.init();
    (SessionRunner as any).mockImplementation(function (this: any) {
      this.on = vi.fn();
      this.run = vi.fn(async () => {
        await state.writeHandoffSignal('TASK_FULLY_COMPLETE');
        await state.writeProgress('## STATUS: ALL_COMPLETE\nAll done');
        return {
          exitCode: 0,
          costUsd: 2.0,
          totalCostUsd: 2.0,
          durationMs: 30000,
          numTurns: 5,
          toolUseCount: 10,
          fullText: 'output',
          rateLimited: false,
          sessionId: 'test',
        };
      });
    });

    const loop = new RelayLoop({
      projectDir: tmpDir,
      initialTask: 'Simple task',
      maxSessions: 10,
      sessionBudget: 5,
      mode: 'auto',
      maxSessionLogEntries: 5,
    });

    const result = await loop.run();
    expect(result.sessionsRun).toBe(1);
    expect(result.completed).toBe(true);
  });

  it('chains sessions on handoff', async () => {
    const state = new CleaveState(tmpDir);
    await state.init();
    let callCount = 0;

    (SessionRunner as any).mockImplementation(function (this: any) {
      this.on = vi.fn();
      this.run = vi.fn(async () => {
        callCount++;
        if (callCount < 3) {
          await state.writeHandoffSignal('HANDOFF_COMPLETE');
          await state.writeNextPrompt('Continue from here');
          await state.writeProgress('## STATUS: IN_PROGRESS');
          await state.writeKnowledge('## Core Knowledge\n\n## Session Log\n');
        } else {
          await state.writeHandoffSignal('TASK_FULLY_COMPLETE');
          await state.writeProgress('## STATUS: ALL_COMPLETE');
        }
        return {
          exitCode: 0, costUsd: 1.0, totalCostUsd: 1.0 * callCount,
          durationMs: 10000, numTurns: 3, toolUseCount: 5,
          fullText: '', rateLimited: false, sessionId: `s${callCount}`,
        };
      });
    });

    const loop = new RelayLoop({
      projectDir: tmpDir,
      initialTask: 'Big task',
      maxSessions: 10,
      sessionBudget: 5,
      mode: 'auto',
      maxSessionLogEntries: 5,
    });

    const result = await loop.run();
    expect(result.sessionsRun).toBe(3);
    expect(result.completed).toBe(true);
  });

  it('stops at max sessions limit', async () => {
    const state = new CleaveState(tmpDir);
    await state.init();

    (SessionRunner as any).mockImplementation(function (this: any) {
      this.on = vi.fn();
      this.run = vi.fn(async () => {
        await state.writeHandoffSignal('HANDOFF_COMPLETE');
        await state.writeNextPrompt('Continue');
        await state.writeProgress('## STATUS: IN_PROGRESS');
        await state.writeKnowledge('## Core Knowledge\n\n## Session Log\n');
        return {
          exitCode: 0, costUsd: 1.0, totalCostUsd: 1.0,
          durationMs: 10000, numTurns: 3, toolUseCount: 5,
          fullText: '', rateLimited: false, sessionId: 'test',
        };
      });
    });

    const loop = new RelayLoop({
      projectDir: tmpDir,
      initialTask: 'Endless task',
      maxSessions: 3,
      sessionBudget: 5,
      mode: 'auto',
      maxSessionLogEntries: 5,
    });

    const result = await loop.run();
    expect(result.sessionsRun).toBe(3);
    expect(result.completed).toBe(false);
    expect(result.reason).toBe('max_sessions');
  });

  it('extends session limit when updateMaxSessions is called mid-run', async () => {
    const state = new CleaveState(tmpDir);
    await state.init();
    let callCount = 0;

    (SessionRunner as any).mockImplementation(function (this: any) {
      this.on = vi.fn();
      this.run = vi.fn(async () => {
        callCount++;
        await state.writeHandoffSignal('HANDOFF_COMPLETE');
        await state.writeNextPrompt('Continue');
        await state.writeProgress('## STATUS: IN_PROGRESS');
        await state.writeKnowledge('## Core Knowledge\n\n## Session Log\n');
        return {
          exitCode: 0, costUsd: 1.0, totalCostUsd: 1.0,
          durationMs: 10000, numTurns: 3, toolUseCount: 5,
          fullText: '', rateLimited: false, sessionId: `s${callCount}`,
        };
      });
    });

    const loop = new RelayLoop({
      projectDir: tmpDir,
      initialTask: 'Expandable task',
      maxSessions: 2,
      sessionBudget: 5,
      mode: 'auto',
      maxSessionLogEntries: 5,
    });

    // After session 1 starts, increase the limit to 4
    loop.on('session_start', ({ sessionNum }: { sessionNum: number }) => {
      if (sessionNum === 1) {
        loop.updateMaxSessions(4);
      }
    });

    const result = await loop.run();
    // Should run all 4 sessions, not stop at 2
    expect(result.sessionsRun).toBe(4);
    expect(result.completed).toBe(false);
    expect(result.reason).toBe('max_sessions');
  });

  it('updates session budget for next session', async () => {
    const state = new CleaveState(tmpDir);
    await state.init();
    const budgets: number[] = [];

    (SessionRunner as any).mockImplementation(function (this: any, config: any) {
      budgets.push(config.budget);
      this.on = vi.fn();
      this.run = vi.fn(async () => {
        await state.writeHandoffSignal('HANDOFF_COMPLETE');
        await state.writeNextPrompt('Continue');
        await state.writeProgress('## STATUS: IN_PROGRESS');
        await state.writeKnowledge('## Core Knowledge\n\n## Session Log\n');
        return {
          exitCode: 0, costUsd: 1.0, totalCostUsd: 1.0,
          durationMs: 10000, numTurns: 3, toolUseCount: 5,
          fullText: '', rateLimited: false, sessionId: 'test',
        };
      });
    });

    const loop = new RelayLoop({
      projectDir: tmpDir,
      initialTask: 'Budget test',
      maxSessions: 3,
      sessionBudget: 5,
      mode: 'auto',
      maxSessionLogEntries: 5,
    });

    loop.on('session_start', ({ sessionNum }: { sessionNum: number }) => {
      if (sessionNum === 1) {
        loop.updateSessionBudget(10);
      }
    });

    await loop.run();
    // Session 1 used original $5, sessions 2-3 should use $10
    expect(budgets[0]).toBe(5);
    expect(budgets[1]).toBe(10);
    expect(budgets[2]).toBe(10);
  });
});
