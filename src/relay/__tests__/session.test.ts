import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { Readable, Writable } from 'node:stream';

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

  setTimeout(() => {
    for (const line of lines) {
      stdout.push(line + '\n');
    }
    stdout.push(null);
    proc.exitCode = 0;
    proc.emit('close', 0);
  }, 10);

  return proc;
}

describe('SessionRunner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('emits text and result events from assistant snapshots', async () => {
    const lines = [
      JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'Hello from Claude' }] }
      }),
      JSON.stringify({
        type: 'result',
        total_cost_usd: 1.0,
        duration_ms: 5000,
        num_turns: 2,
        session_id: 's1',
        usage: { input_tokens: 1000, output_tokens: 50 },
      }),
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

    const textEvents = events.filter((e: any) => e.kind === 'text');
    expect(textEvents.length).toBeGreaterThan(0);
    expect(textEvents[0].text).toContain('Hello from Claude');
    expect(result.totalCostUsd).toBe(1.0);
    expect(result.exitCode).toBe(0);
  });

  it('captures text output from content_block_delta', async () => {
    const lines = [
      JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Part 1 ' } }),
      JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Part 2' } }),
      JSON.stringify({ type: 'result', total_cost_usd: 0.5, num_turns: 1 }),
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

  it('deduplicates content between assistant snapshots and content_block_delta', async () => {
    const lines = [
      // Text arrives via content_block_delta
      JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hello' } }),
      // Then assistant snapshot includes the same text
      JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'Hello' }] }
      }),
      JSON.stringify({ type: 'result', total_cost_usd: 0.1, num_turns: 1 }),
    ];
    (spawn as any).mockReturnValue(createMockProcess(lines));

    const runner = new SessionRunner({
      projectDir: '/tmp/test',
      prompt: 'test',
      handoffInstructions: '',
      budget: 5,
    });

    const events: any[] = [];
    runner.on('event', (e: any) => events.push(e));

    await runner.run();

    // Should have exactly ONE text event (from content_block_delta), not two
    const textEvents = events.filter((e: any) => e.kind === 'text');
    expect(textEvents).toHaveLength(1);
    expect(textEvents[0].text).toBe('Hello');
  });

  it('tracks tool use from content_block_start', async () => {
    const lines = [
      JSON.stringify({
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'tool_use', name: 'Read', id: 't1' }
      }),
      JSON.stringify({
        type: 'content_block_start',
        index: 1,
        content_block: { type: 'tool_use', name: 'Edit', id: 't2' }
      }),
      JSON.stringify({ type: 'result', total_cost_usd: 2.0 }),
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

  it('extracts usage from assistant events', async () => {
    const lines = [
      JSON.stringify({
        type: 'assistant',
        message: {
          content: [{ type: 'text', text: 'Hi' }],
          usage: { input_tokens: 5000, output_tokens: 100, cache_creation_input_tokens: 20000 }
        }
      }),
      JSON.stringify({ type: 'result', total_cost_usd: 0.15, num_turns: 1 }),
    ];
    (spawn as any).mockReturnValue(createMockProcess(lines));

    const runner = new SessionRunner({
      projectDir: '/tmp/test',
      prompt: 'test',
      handoffInstructions: '',
      budget: 5,
    });

    const events: any[] = [];
    runner.on('event', (e: any) => events.push(e));

    await runner.run();

    const usageEvent = events.find((e: any) => e.kind === 'usage');
    expect(usageEvent).toBeDefined();
    expect(usageEvent.inputTokens).toBe(25000);
    expect(usageEvent.outputTokens).toBe(100);
  });

  it('includes remote control flag when remoteControl is true', () => {
    const runner = new SessionRunner({
      projectDir: '/tmp/test',
      prompt: 'test',
      handoffInstructions: '',
      budget: 5,
      remoteControl: true,
    });
    const args = (runner as any).buildArgs();
    expect(args).toContain('--remote-control');
  });

  it('excludes remote control flag when remoteControl is false', () => {
    const runner = new SessionRunner({
      projectDir: '/tmp/test',
      prompt: 'test',
      handoffInstructions: '',
      budget: 5,
      remoteControl: false,
    });
    const args = (runner as any).buildArgs();
    expect(args).not.toContain('--remote-control');
  });

  it('does not crash on stream error events', async () => {
    const lines = [
      JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'Working...' }] }
      }),
      JSON.stringify({ type: 'error', error: { message: 'image exceeds dimension limit' } }),
      JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'Working... Continuing...' }] }
      }),
      JSON.stringify({ type: 'result', total_cost_usd: 1.0, num_turns: 1 }),
    ];
    (spawn as any).mockReturnValue(createMockProcess(lines));

    const runner = new SessionRunner({
      projectDir: '/tmp/test',
      prompt: 'test',
      handoffInstructions: '',
      budget: 5,
    });

    const events: any[] = [];
    runner.on('event', (e: any) => events.push(e));

    const result = await runner.run();
    expect(result.exitCode).toBe(0);

    const errorEvent = events.find((e: any) => e.kind === 'error');
    expect(errorEvent).toBeDefined();
    expect(errorEvent.message).toBe('image exceeds dimension limit');
  });
});
