import type {
  StreamEvent,
  ParsedEvent,
  ContentBlock,
} from './types.js';

export function parseStreamLine(line: string): ParsedEvent[] {
  const trimmed = line.trim();
  if (!trimmed) return [];

  let event: StreamEvent;
  try {
    event = JSON.parse(trimmed);
  } catch {
    return [];
  }

  switch (event.type) {
    case 'assistant':
      return parseAssistant(event.message?.content ?? []);

    case 'content_block_start':
      if (event.content_block?.type === 'tool_use' && event.content_block.name) {
        return [{
          kind: 'tool_start',
          name: event.content_block.name,
          id: event.content_block.id ?? `block_${event.index}`,
          input: {},
        }];
      }
      return [];

    case 'content_block_delta':
      if (event.delta?.type === 'text_delta' && event.delta.text) {
        return [{ kind: 'text', text: event.delta.text }];
      }
      return [];

    case 'content_block_stop':
      return [{ kind: 'tool_end', id: `block_${event.index}` }];

    case 'result':
      return [{
        kind: 'result',
        costUsd: event.cost_usd ?? 0,
        totalCostUsd: event.total_cost_usd ?? 0,
        durationMs: event.duration_ms ?? 0,
        numTurns: event.num_turns ?? 0,
        sessionId: event.session_id ?? '',
      }];

    case 'rate_limit_event': {
      const info = event.rate_limit_info;
      const blocked = info?.status === 'blocked' || info?.overageStatus === 'blocked';
      return [{
        kind: 'rate_limit',
        blocked,
        resetsAt: info?.resetsAt ? info.resetsAt * 1000 : Date.now() + 300_000,
      }];
    }

    case 'error':
      return [{
        kind: 'error',
        message: event.error?.message ?? JSON.stringify(event.error) ?? 'Unknown error',
      }];

    case 'system':
      return [{
        kind: 'system',
        subtype: event.subtype ?? '',
        hookName: event.hook_name,
        exitCode: event.exit_code,
      }];

    default:
      return [];
  }
}

function parseAssistant(content: ContentBlock[]): ParsedEvent[] {
  const events: ParsedEvent[] = [];
  for (const block of content) {
    if (block.type === 'text') {
      events.push({ kind: 'text', text: block.text });
    } else if (block.type === 'tool_use') {
      events.push({
        kind: 'tool_start',
        name: block.name,
        id: block.id,
        input: block.input,
      });
    }
  }
  return events;
}
