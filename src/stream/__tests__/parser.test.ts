import { describe, it, expect } from 'vitest';
import { parseStreamLine, StreamParser } from '../parser.js';

describe('parseStreamLine (stateless)', () => {
  it('extracts usage from assistant events', () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: {
        content: [{ type: 'text', text: 'Hello world' }],
        usage: {
          input_tokens: 5000,
          output_tokens: 100,
          cache_creation_input_tokens: 20000,
          cache_read_input_tokens: 0,
        }
      }
    });
    const events = parseStreamLine(line);
    const usage = events.find(e => e.kind === 'usage');
    expect(usage).toEqual({
      kind: 'usage',
      inputTokens: 25000,
      outputTokens: 100,
    });
  });

  it('extracts text content from assistant events', () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'Hello world' }] }
    });
    const events = parseStreamLine(line);
    const text = events.find(e => e.kind === 'text');
    expect(text).toEqual({ kind: 'text', text: 'Hello world' });
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

  it('parses content_block_start tool_use events', () => {
    const line = JSON.stringify({
      type: 'content_block_start',
      index: 1,
      content_block: { type: 'tool_use', name: 'Read', id: 'tool_1' }
    });
    const events = parseStreamLine(line);
    expect(events).toEqual([{
      kind: 'tool_start',
      name: 'Read',
      id: 'tool_1',
      input: {},
    }]);
  });

  it('parses result events with cost and usage', () => {
    const line = JSON.stringify({
      type: 'result',
      total_cost_usd: 0.14896,
      duration_ms: 2602,
      num_turns: 1,
      session_id: 'sess_123',
      modelUsage: {
        'claude-opus-4-6': {
          inputTokens: 2,
          outputTokens: 13,
          cacheCreationInputTokens: 23780,
          costUSD: 0.14896,
          contextWindow: 200000,
        }
      }
    });
    const events = parseStreamLine(line);
    expect(events).toHaveLength(1);
    const result = events[0] as any;
    expect(result.kind).toBe('result');
    expect(result.totalCostUsd).toBe(0.14896);
    expect(result.contextWindow).toBe(200000);
    expect(result.inputTokens).toBe(2 + 23780);
    expect(result.outputTokens).toBe(13);
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
    expect(parseStreamLine('not json')).toEqual([]);
  });

  it('returns empty array for unknown event types', () => {
    expect(parseStreamLine(JSON.stringify({ type: 'ping' }))).toEqual([]);
  });

  it('parses system events', () => {
    const line = JSON.stringify({
      type: 'system',
      subtype: 'init',
    });
    const events = parseStreamLine(line);
    expect(events).toEqual([{
      kind: 'system',
      subtype: 'init',
      hookName: undefined,
      exitCode: undefined,
    }]);
  });
});

describe('StreamParser (stateful deduplication)', () => {
  it('deduplicates text across assistant snapshots', () => {
    const parser = new StreamParser();

    // First snapshot: "Hello"
    const events1 = parser.parseLine(JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'Hello' }] }
    }));
    expect(events1.find(e => e.kind === 'text')).toEqual({ kind: 'text', text: 'Hello' });

    // Second snapshot: "Hello world" — should only emit " world"
    const events2 = parser.parseLine(JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'Hello world' }] }
    }));
    expect(events2.find(e => e.kind === 'text')).toEqual({ kind: 'text', text: ' world' });
  });

  it('deduplicates tool_use blocks across snapshots', () => {
    const parser = new StreamParser();

    // First snapshot with a tool
    const events1 = parser.parseLine(JSON.stringify({
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'Let me read that.' },
          { type: 'tool_use', id: 'tool_1', name: 'Read', input: { file_path: '/a.ts' } }
        ]
      }
    }));
    expect(events1.filter(e => e.kind === 'tool_start')).toHaveLength(1);

    // Second snapshot includes the same tool — should NOT re-emit it
    const events2 = parser.parseLine(JSON.stringify({
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'Let me read that.' },
          { type: 'tool_use', id: 'tool_1', name: 'Read', input: { file_path: '/a.ts' } }
        ]
      }
    }));
    expect(events2.filter(e => e.kind === 'tool_start')).toHaveLength(0);
  });

  it('does not duplicate between content_block_delta and assistant events', () => {
    const parser = new StreamParser();

    // Text arrives via content_block_delta first
    parser.parseLine(JSON.stringify({
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text: 'Hello' }
    }));

    // Then assistant snapshot includes the same text — should not re-emit
    const events = parser.parseLine(JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'Hello' }] }
    }));
    expect(events.filter(e => e.kind === 'text')).toHaveLength(0);
  });

  it('resets state between sessions', () => {
    const parser = new StreamParser();

    parser.parseLine(JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'Session 1 text' }] }
    }));

    parser.reset();

    const events = parser.parseLine(JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'Session 2 text' }] }
    }));
    expect(events.find(e => e.kind === 'text')).toEqual({ kind: 'text', text: 'Session 2 text' });
  });
});
