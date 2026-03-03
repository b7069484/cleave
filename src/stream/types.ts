// Content blocks inside assistant messages
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

// Stream events (NDJSON lines from claude -p --output-format stream-json)
export interface AssistantEvent {
  type: 'assistant';
  message: {
    content: ContentBlock[];
  };
}

export interface ContentBlockStartEvent {
  type: 'content_block_start';
  index: number;
  content_block: {
    type: 'text' | 'tool_use';
    name?: string;  // tool name for tool_use
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
}

export interface RateLimitEvent {
  type: 'rate_limit_event';
  rate_limit_info: {
    status: string;
    overageStatus?: string;
    resetsAt?: number;  // Unix timestamp in seconds
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

export type StreamEvent =
  | AssistantEvent
  | ContentBlockStartEvent
  | ContentBlockDeltaEvent
  | ContentBlockStopEvent
  | ResultEvent
  | RateLimitEvent
  | ErrorEvent
  | SystemEvent;

// Parsed high-level events for the TUI
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

export interface ParsedResult {
  kind: 'result';
  costUsd: number;
  totalCostUsd: number;
  durationMs: number;
  numTurns: number;
  sessionId: string;
}

export interface ParsedError {
  kind: 'error';
  message: string;
}

export interface ParsedRateLimit {
  kind: 'rate_limit';
  blocked: boolean;
  resetsAt: number;  // ms epoch
}

export interface ParsedSystem {
  kind: 'system';
  subtype: string;
  hookName?: string;
  exitCode?: number;
}

export type ParsedEvent =
  | ParsedTextChunk
  | ParsedToolStart
  | ParsedToolEnd
  | ParsedResult
  | ParsedError
  | ParsedRateLimit
  | ParsedSystem;
