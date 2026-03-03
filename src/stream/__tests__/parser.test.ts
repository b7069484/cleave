import { describe, it, expect } from 'vitest';
import { parseStreamLine } from '../parser.js';

describe('parseStreamLine', () => {
  it('parses assistant text events', () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'Hello world' }] }
    });
    const events = parseStreamLine(line);
    expect(events).toEqual([{ kind: 'text', text: 'Hello world' }]);
  });

  it('parses assistant tool_use events', () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: {
        content: [{
          type: 'tool_use',
          id: 'tool_1',
          name: 'Read',
          input: { file_path: '/src/index.ts' }
        }]
      }
    });
    const events = parseStreamLine(line);
    expect(events).toEqual([{
      kind: 'tool_start',
      name: 'Read',
      id: 'tool_1',
      input: { file_path: '/src/index.ts' }
    }]);
  });

  it('parses content_block_delta text events', () => {
    const line = JSON.stringify({
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text: 'chunk' }
    });
    const events = parseStreamLine(line);
    expect(events).toEqual([{ kind: 'text', text: 'chunk' }]);
  });

  it('parses result events with cost data', () => {
    const line = JSON.stringify({
      type: 'result',
      cost_usd: 1.50,
      total_cost_usd: 3.00,
      duration_ms: 45000,
      num_turns: 8,
      session_id: 'sess_123'
    });
    const events = parseStreamLine(line);
    expect(events).toEqual([{
      kind: 'result',
      costUsd: 1.50,
      totalCostUsd: 3.00,
      durationMs: 45000,
      numTurns: 8,
      sessionId: 'sess_123'
    }]);
  });

  it('parses rate_limit_event when blocked', () => {
    const line = JSON.stringify({
      type: 'rate_limit_event',
      rate_limit_info: { status: 'blocked', resetsAt: 1709500000 }
    });
    const events = parseStreamLine(line);
    expect(events).toEqual([{
      kind: 'rate_limit',
      blocked: true,
      resetsAt: 1709500000000
    }]);
  });

  it('parses error events', () => {
    const line = JSON.stringify({
      type: 'error',
      error: { message: 'Something went wrong' }
    });
    const events = parseStreamLine(line);
    expect(events).toEqual([{
      kind: 'error',
      message: 'Something went wrong'
    }]);
  });

  it('returns empty array for non-JSON lines', () => {
    const events = parseStreamLine('not json');
    expect(events).toEqual([]);
  });

  it('returns empty array for unknown event types', () => {
    const line = JSON.stringify({ type: 'ping' });
    const events = parseStreamLine(line);
    expect(events).toEqual([]);
  });

  it('parses multiple content blocks in one assistant event', () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'Let me read that file.' },
          { type: 'tool_use', id: 'tool_2', name: 'Read', input: { file_path: '/a.ts' } }
        ]
      }
    });
    const events = parseStreamLine(line);
    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({ kind: 'text', text: 'Let me read that file.' });
    expect(events[1]).toEqual({
      kind: 'tool_start',
      name: 'Read',
      id: 'tool_2',
      input: { file_path: '/a.ts' }
    });
  });
});
