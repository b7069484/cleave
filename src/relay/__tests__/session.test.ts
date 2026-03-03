import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { Readable, Writable } from 'node:stream';

// We test SessionRunner's event processing by mocking child_process.spawn
// and feeding it fake NDJSON lines

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

import { spawn } from 'node:child_process';
import { SessionRunner } from '../session.js';

function createMockProcess(lines: string[]): any {
  const stdout = new Readable({ read() {} });
  const stderr = new Readable({ read() {} });
  const stdin = new Writable({ write(_chunk, _enc, cb) { cb(); } });
  const proc = Object.assign(new EventEmitter(), { stdout, stderr, stdin, pid: 1234, kill: vi.fn(), exitCode: null as number | null });

  // Push lines async
  setTimeout(() => {
    for (const line of lines) {
      stdout.push(line + '\n');
    }
    stdout.push(null);
    // Real ChildProcess sets exitCode before emitting close
    proc.exitCode = 0;
    proc.emit('close', 0);
  }, 10);

  return proc;
}

describe('SessionRunner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('emits parsed events from stream', async () => {
    const lines = [
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Hello' }] } }),
      JSON.stringify({ type: 'result', cost_usd: 1.0, total_cost_usd: 1.0, duration_ms: 5000, num_turns: 2, session_id: 's1' }),
    ];
    (spawn as any).mockReturnValue(createMockProcess(lines));

    const runner = new SessionRunner({
      projectDir: '/tmp/test',
      prompt: 'test prompt',
      handoffInstructions: 'handoff',
      budget: 5,
    });

    const events: any[] = [];
    runner.on('event', (e: any) => events.push(e));

    const result = await runner.run();

    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({ kind: 'text', text: 'Hello' });
    expect(events[1].kind).toBe('result');
    expect(result.costUsd).toBe(1.0);
    expect(result.exitCode).toBe(0);
  });

  it('captures total text output', async () => {
    const lines = [
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Part 1 ' }] } }),
      JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Part 2' } }),
      JSON.stringify({ type: 'result', cost_usd: 0.5 }),
    ];
    (spawn as any).mockReturnValue(createMockProcess(lines));

    const runner = new SessionRunner({
      projectDir: '/tmp/test',
      prompt: 'test',
      handoffInstructions: '',
      budget: 5,
    });

    const result = await runner.run();
    expect(result.fullText).toContain('Part 1');
    expect(result.fullText).toContain('Part 2');
  });

  it('tracks tool use count', async () => {
    const lines = [
      JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'tool_use', id: 't1', name: 'Read', input: {} }] }
      }),
      JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'tool_use', id: 't2', name: 'Edit', input: {} }] }
      }),
      JSON.stringify({ type: 'result', cost_usd: 2.0 }),
    ];
    (spawn as any).mockReturnValue(createMockProcess(lines));

    const runner = new SessionRunner({
      projectDir: '/tmp/test',
      prompt: 'test',
      handoffInstructions: '',
      budget: 5,
    });

    const result = await runner.run();
    expect(result.toolUseCount).toBe(2);
  });
});
