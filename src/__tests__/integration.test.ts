import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { Readable, Writable } from 'node:stream';

// Mock child_process to simulate claude -p
vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

import { spawn } from 'node:child_process';
import { RelayLoop } from '../relay/loop.js';
import { CleaveState } from '../state/files.js';

function createFakeClaudeSession(
  lines: string[],
  state: CleaveState,
  signalType: 'handoff' | 'complete',
) {
  return () => {
    const stdout = new Readable({ read() {} });
    const stderr = new Readable({ read() {} });
    const stdin = new Writable({ write(_c, _e, cb) { cb(); } });
    const proc = Object.assign(new EventEmitter(), { stdout, stderr, stdin, pid: 99, kill: vi.fn(), exitCode: null as number | null });

    setTimeout(async () => {
      for (const line of lines) {
        stdout.push(line + '\n');
      }

      // Simulate Claude writing handoff files
      if (signalType === 'handoff') {
        await state.writeProgress('## STATUS: IN_PROGRESS\nWorking on it');
        await state.writeKnowledge('## Core Knowledge\n- Found something\n\n## Session Log\n### Session\n- Did work');
        await state.writeNextPrompt('Continue the task from here');
        await state.writeHandoffSignal('HANDOFF_COMPLETE');
      } else {
        await state.writeProgress('## STATUS: ALL_COMPLETE\nDone!');
        await state.writeHandoffSignal('TASK_FULLY_COMPLETE');
      }

      stdout.push(null);
      proc.exitCode = 0;
      proc.emit('close', 0);
    }, 50);

    return proc;
  };
}

describe('Integration: Relay chains sessions correctly', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'cleave-integ-'));
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('chains 2 sessions then completes', async () => {
    const state = new CleaveState(tmpDir);
    await state.init();

    let callCount = 0;
    (spawn as any).mockImplementation(() => {
      callCount++;
      const lines = [
        JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: `Session ${callCount} output` }] } }),
        JSON.stringify({ type: 'result', cost_usd: 1.5, total_cost_usd: 1.5 * callCount, duration_ms: 20000, num_turns: 4, session_id: `s${callCount}` }),
      ];
      const signal = callCount >= 2 ? 'complete' : 'handoff';
      return createFakeClaudeSession(lines, state, signal)();
    });

    const loop = new RelayLoop({
      projectDir: tmpDir,
      initialTask: 'Build the feature',
      maxSessions: 5,
      sessionBudget: 5,
      maxSessionLogEntries: 5,
    });

    const result = await loop.run();

    expect(result.sessionsRun).toBe(2);
    expect(result.completed).toBe(true);
    expect(result.reason).toBe('task_complete');

    // Verify archives exist
    const log1 = await readFile(join(tmpDir, '.cleave', 'logs', 'session_1_progress.md'), 'utf-8');
    expect(log1).toContain('IN_PROGRESS');
  });
});
