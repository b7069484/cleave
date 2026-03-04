import type { ParsedEvent } from './types.js';
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
export declare class StreamParser {
    private emittedTextLength;
    private seenToolIds;
    parseLine(line: string): ParsedEvent[];
    /**
     * Reset state between sessions (new conversation = new content tracking)
     */
    reset(): void;
    private parseAssistantSnapshot;
    private parseResult;
}
/**
 * Stateless convenience wrapper for backward compatibility with tests.
 * For production use, prefer StreamParser class for proper deduplication.
 */
export declare function parseStreamLine(line: string): ParsedEvent[];
