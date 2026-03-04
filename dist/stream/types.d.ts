export interface TextBlock {
    type: 'text';
    text: string;
}
export interface ToolUseBlock {
    type: 'tool_use';
    id: string;
    name: string;
    input: Record<string, unknown>;
}
export type ContentBlock = TextBlock | ToolUseBlock;
export interface AssistantEvent {
    type: 'assistant';
    message: {
        content: ContentBlock[];
        usage?: {
            input_tokens?: number;
            output_tokens?: number;
            cache_creation_input_tokens?: number;
            cache_read_input_tokens?: number;
        };
    };
}
export interface ContentBlockStartEvent {
    type: 'content_block_start';
    index: number;
    content_block: {
        type: 'text' | 'tool_use';
        name?: string;
        id?: string;
    };
}
export interface ContentBlockDeltaEvent {
    type: 'content_block_delta';
    index: number;
    delta: {
        type: 'text_delta' | 'input_json_delta';
        text?: string;
        partial_json?: string;
    };
}
export interface ContentBlockStopEvent {
    type: 'content_block_stop';
    index: number;
}
export interface ResultEvent {
    type: 'result';
    result?: string | Record<string, unknown>;
    cost_usd?: number;
    total_cost_usd?: number;
    duration_ms?: number;
    session_id?: string;
    num_turns?: number;
    usage?: {
        input_tokens?: number;
        output_tokens?: number;
        cache_creation_input_tokens?: number;
        cache_read_input_tokens?: number;
    };
    modelUsage?: Record<string, {
        inputTokens?: number;
        outputTokens?: number;
        cacheReadInputTokens?: number;
        cacheCreationInputTokens?: number;
        costUSD?: number;
        contextWindow?: number;
    }>;
}
export interface RateLimitEvent {
    type: 'rate_limit_event';
    rate_limit_info: {
        status: string;
        overageStatus?: string;
        resetsAt?: number;
    };
}
export interface ErrorEvent {
    type: 'error';
    error: {
        message?: string;
        type?: string;
    };
}
export interface SystemEvent {
    type: 'system';
    subtype?: string;
    exit_code?: number;
    hook_name?: string;
    session_id?: string;
}
export interface StreamEventWrapper {
    type: 'stream_event';
    event: {
        type: string;
        [key: string]: unknown;
    };
    session_id?: string;
    parent_tool_use_id?: string | null;
    uuid?: string;
}
export type StreamEvent = AssistantEvent | ContentBlockStartEvent | ContentBlockDeltaEvent | ContentBlockStopEvent | ResultEvent | RateLimitEvent | ErrorEvent | SystemEvent | StreamEventWrapper;
export interface ParsedTextChunk {
    kind: 'text';
    text: string;
}
export interface ParsedToolStart {
    kind: 'tool_start';
    name: string;
    id: string;
    input: Record<string, unknown>;
}
export interface ParsedToolEnd {
    kind: 'tool_end';
    id: string;
}
export interface ParsedToolInput {
    kind: 'tool_input';
    id: string;
    input: Record<string, unknown>;
}
export interface ParsedResult {
    kind: 'result';
    costUsd: number;
    totalCostUsd: number;
    durationMs: number;
    numTurns: number;
    sessionId: string;
    inputTokens: number;
    outputTokens: number;
    contextWindow: number;
}
export interface ParsedError {
    kind: 'error';
    message: string;
}
export interface ParsedRateLimit {
    kind: 'rate_limit';
    blocked: boolean;
    resetsAt: number;
}
export interface ParsedSystem {
    kind: 'system';
    subtype: string;
    hookName?: string;
    exitCode?: number;
}
export interface ParsedUsage {
    kind: 'usage';
    inputTokens: number;
    outputTokens: number;
}
export type ParsedEvent = ParsedTextChunk | ParsedToolStart | ParsedToolEnd | ParsedToolInput | ParsedResult | ParsedError | ParsedRateLimit | ParsedSystem | ParsedUsage;
