import type {
  StreamEvent,
  ParsedEvent,
  ContentBlock,
} from './types.js';

/**
 * Stateful stream parser that handles deduplication of assistant message snapshots.
 *
 * Claude CLI with --include-partial-messages sends periodic `assistant` events
 * containing the FULL message content up to that point (not deltas). Each snapshot
 * includes all previous text. We track what we've already emitted and only output
 * the new portion.
 *
 * Content can arrive via two paths:
 *   1. `assistant` events (full snapshots with --include-partial-messages)
 *   2. `content_block_delta` events (incremental streaming)
 *
 * We handle both and avoid duplicates.
 */
export class StreamParser {
  private emittedTextLength = 0;
  private seenToolIds = new Set<string>();
  private toolInputPopulated = new Set<string>();
  // Track block index → tool ID for content_block_stop
  private blockIndexToToolId = new Map<number, string>();
  // Accumulate input_json_delta fragments per block index
  private inputFragments = new Map<number, string>();

  parseLine(line: string): ParsedEvent[] {
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
        return this.parseAssistantSnapshot(event);

      case 'content_block_start':
        if (event.content_block?.type === 'tool_use' && event.content_block.name) {
          const id = event.content_block.id ?? `block_${event.index}`;
          this.blockIndexToToolId.set(event.index, id);
          if (!this.seenToolIds.has(id)) {
            this.seenToolIds.add(id);
            return [{
              kind: 'tool_start',
              name: event.content_block.name,
              id,
              input: {},
            }];
          }
        }
        return [];

      case 'content_block_delta':
        if (event.delta?.type === 'text_delta' && event.delta.text) {
          this.emittedTextLength += event.delta.text.length;
          return [{ kind: 'text', text: event.delta.text }];
        }
        if (event.delta?.type === 'input_json_delta' && event.delta.partial_json) {
          const existing = this.inputFragments.get(event.index) ?? '';
          this.inputFragments.set(event.index, existing + event.delta.partial_json);
        }
        return [];

      case 'content_block_stop': {
        const results: ParsedEvent[] = [];
        // Emit tool_input from accumulated JSON fragments (backup to assistant snapshot path)
        const toolId = this.blockIndexToToolId.get(event.index);
        const fragments = this.inputFragments.get(event.index);
        if (toolId && fragments && !this.toolInputPopulated.has(toolId)) {
          try {
            const input = JSON.parse(fragments);
            this.toolInputPopulated.add(toolId);
            results.push({ kind: 'tool_input', id: toolId, input });
          } catch { /* incomplete JSON */ }
        }
        this.inputFragments.delete(event.index);
        this.blockIndexToToolId.delete(event.index);
        results.push({ kind: 'tool_end', id: toolId ?? `block_${event.index}` });
        return results;
      }

      case 'result':
        return this.parseResult(event);

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

      case 'stream_event': {
        // Claude CLI v2.1.66+ wraps streaming events in {"type":"stream_event","event":{...}}
        const inner = (event as any).event;
        if (inner && typeof inner === 'object' && inner.type) {
          // Re-parse the inner event by treating it as a top-level event
          const innerLine = JSON.stringify(inner);
          return this.parseLine(innerLine);
        }
        return [];
      }

      default:
        return [];
    }
  }

  /**
   * Reset state between sessions (new conversation = new content tracking)
   */
  reset(): void {
    this.emittedTextLength = 0;
    this.seenToolIds.clear();
    this.toolInputPopulated.clear();
    this.blockIndexToToolId.clear();
    this.inputFragments.clear();
  }

  private parseAssistantSnapshot(event: StreamEvent & { type: 'assistant' }): ParsedEvent[] {
    const results: ParsedEvent[] = [];
    const content = event.message?.content ?? [];

    // Build the full text from this snapshot
    let fullText = '';
    for (const block of content) {
      if (block.type === 'text') {
        fullText += block.text;
      }
    }

    // Emit only the NEW text (delta from what we've already emitted)
    if (fullText.length > this.emittedTextLength) {
      const newText = fullText.slice(this.emittedTextLength);
      this.emittedTextLength = fullText.length;
      if (newText.trim()) {
        results.push({ kind: 'text', text: newText });
      }
    }

    // Emit tool_use blocks we haven't seen before
    for (const block of content) {
      if (block.type === 'tool_use') {
        if (!this.seenToolIds.has(block.id)) {
          this.seenToolIds.add(block.id);
          const hasInput = block.input && Object.keys(block.input).length > 0;
          if (hasInput) this.toolInputPopulated.add(block.id);
          results.push({
            kind: 'tool_start',
            name: block.name,
            id: block.id,
            input: block.input,
          });
        } else if (!this.toolInputPopulated.has(block.id) && block.input && Object.keys(block.input).length > 0) {
          // Tool was emitted earlier with empty input; now we have the real input
          this.toolInputPopulated.add(block.id);
          results.push({
            kind: 'tool_input',
            id: block.id,
            input: block.input,
          });
        }
      }
    }

    // Always extract usage
    const usage = event.message?.usage;
    if (usage) {
      const inputTokens = (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0);
      const outputTokens = usage.output_tokens ?? 0;
      results.push({ kind: 'usage', inputTokens, outputTokens });
    }

    return results;
  }

  private parseResult(event: StreamEvent & { type: 'result' }): ParsedEvent[] {
    let totalCost = event.total_cost_usd ?? 0;
    let contextWindow = 200_000;
    let inputTokens = 0;
    let outputTokens = 0;

    if (event.modelUsage) {
      for (const model of Object.values(event.modelUsage)) {
        if (model.costUSD) totalCost = model.costUSD;
        if (model.contextWindow) contextWindow = model.contextWindow;
        inputTokens += (model.inputTokens ?? 0) + (model.cacheReadInputTokens ?? 0) + (model.cacheCreationInputTokens ?? 0);
        outputTokens += model.outputTokens ?? 0;
      }
    } else if (event.usage) {
      inputTokens = (event.usage.input_tokens ?? 0) + (event.usage.cache_creation_input_tokens ?? 0) + (event.usage.cache_read_input_tokens ?? 0);
      outputTokens = event.usage.output_tokens ?? 0;
    }

    return [{
      kind: 'result',
      costUsd: event.cost_usd ?? 0,
      totalCostUsd: totalCost,
      durationMs: event.duration_ms ?? 0,
      numTurns: event.num_turns ?? 0,
      sessionId: event.session_id ?? '',
      inputTokens,
      outputTokens,
      contextWindow,
    }];
  }
}

/**
 * Stateless convenience wrapper for backward compatibility with tests.
 * For production use, prefer StreamParser class for proper deduplication.
 */
export function parseStreamLine(line: string): ParsedEvent[] {
  const parser = new StreamParser();
  return parser.parseLine(line);
}
