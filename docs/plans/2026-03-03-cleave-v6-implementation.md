# Cleave v6 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a relay-aware TUI that renders `claude -p --output-format stream-json` events in real-time, chaining sessions autonomously with handoff detection, rescue fallback, and context tracking.

**Architecture:** Three layers — Stream Parser (NDJSON → typed events), Relay Loop (session lifecycle + handoff), TUI (ink/React components rendering events). Claude Code does all real work via `claude -p`; we only parse, render, and orchestrate.

**Tech Stack:** TypeScript, ink (React for terminals), Commander.js, chokidar, chalk. No native modules. Node 18+.

---

## Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `src/index.ts`
- Create: `.gitignore`

**Step 1: Initialize package.json**

```json
{
  "name": "cleave",
  "version": "6.0.0",
  "description": "Infinite context for Claude Code — autonomous session relay with real-time TUI",
  "type": "module",
  "main": "dist/index.js",
  "bin": {
    "cleave": "dist/index.js"
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "test": "vitest run",
    "test:watch": "vitest",
    "start": "node dist/index.js"
  },
  "engines": {
    "node": ">=18"
  },
  "keywords": ["claude", "claude-code", "relay", "infinite-context", "tui"],
  "license": "MIT"
}
```

**Step 2: Install dependencies**

Run:
```bash
npm install ink react commander chalk chokidar
npm install -D typescript vitest @types/react @types/node ink-testing-library
```

**Step 3: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "jsx": "react-jsx",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "sourceMap": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "**/*.test.ts", "**/*.test.tsx"]
}
```

**Step 4: Create .gitignore**

```
node_modules/
dist/
.cleave/
*.tgz
```

**Step 5: Create minimal src/index.ts**

```typescript
#!/usr/bin/env node
console.log('cleave v6.0.0');
```

**Step 6: Verify build**

Run: `npx tsc && node dist/index.js`
Expected: `cleave v6.0.0`

**Step 7: Commit**

```bash
git add package.json tsconfig.json src/index.ts .gitignore package-lock.json
git commit -m "feat: scaffold cleave v6 project with dependencies"
```

---

## Task 2: Stream Event Types & Parser

**Files:**
- Create: `src/stream/types.ts`
- Create: `src/stream/parser.ts`
- Create: `src/stream/__tests__/parser.test.ts`

**Step 1: Define stream event types**

File: `src/stream/types.ts`

```typescript
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
```

**Step 2: Write failing tests for the parser**

File: `src/stream/__tests__/parser.test.ts`

```typescript
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
```

**Step 3: Run tests to verify they fail**

Run: `npx vitest run src/stream/__tests__/parser.test.ts`
Expected: FAIL — `parseStreamLine` does not exist

**Step 4: Implement the parser**

File: `src/stream/parser.ts`

```typescript
import type {
  StreamEvent,
  ParsedEvent,
  ParsedTextChunk,
  ParsedToolStart,
  ParsedResult,
  ParsedError,
  ParsedRateLimit,
  ParsedSystem,
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
```

**Step 5: Run tests to verify they pass**

Run: `npx vitest run src/stream/__tests__/parser.test.ts`
Expected: All 9 tests PASS

**Step 6: Commit**

```bash
git add src/stream/
git commit -m "feat: add stream-json event types and NDJSON parser with tests"
```

---

## Task 3: State File Management

**Files:**
- Create: `src/state/files.ts`
- Create: `src/state/__tests__/files.test.ts`

**Step 1: Write failing tests**

File: `src/state/__tests__/files.test.ts`

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CleaveState } from '../files.js';

describe('CleaveState', () => {
  let tmpDir: string;
  let state: CleaveState;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'cleave-test-'));
    state = new CleaveState(tmpDir);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('initializes .cleave directory', async () => {
    await state.init();
    const { existsSync } = await import('node:fs');
    expect(existsSync(join(tmpDir, '.cleave'))).toBe(true);
    expect(existsSync(join(tmpDir, '.cleave', 'logs'))).toBe(true);
  });

  it('reads and writes session count', async () => {
    await state.init();
    expect(await state.getSessionCount()).toBe(0);
    await state.setSessionCount(3);
    expect(await state.getSessionCount()).toBe(3);
  });

  it('reads and writes NEXT_PROMPT.md', async () => {
    await state.init();
    await state.writeNextPrompt('Continue the task');
    expect(await state.readNextPrompt()).toBe('Continue the task');
  });

  it('reads and writes PROGRESS.md', async () => {
    await state.init();
    await state.writeProgress('## STATUS: IN_PROGRESS\nDid things.');
    expect(await state.readProgress()).toBe('## STATUS: IN_PROGRESS\nDid things.');
  });

  it('reads and writes KNOWLEDGE.md', async () => {
    await state.init();
    await state.writeKnowledge('## Core Knowledge\n- Item 1');
    expect(await state.readKnowledge()).toBe('## Core Knowledge\n- Item 1');
  });

  it('detects handoff signal', async () => {
    await state.init();
    expect(await state.readHandoffSignal()).toBeNull();
    await state.writeHandoffSignal('HANDOFF_COMPLETE');
    expect(await state.readHandoffSignal()).toBe('HANDOFF_COMPLETE');
  });

  it('clears handoff signal for new session', async () => {
    await state.init();
    await state.writeHandoffSignal('HANDOFF_COMPLETE');
    await state.clearHandoffSignal();
    expect(await state.readHandoffSignal()).toBeNull();
  });

  it('archives session files', async () => {
    await state.init();
    await state.writeProgress('progress text');
    await state.writeNextPrompt('next prompt text');
    await state.writeKnowledge('knowledge text');
    await state.archiveSession(1);
    const { existsSync } = await import('node:fs');
    expect(existsSync(join(tmpDir, '.cleave', 'logs', 'session_1_progress.md'))).toBe(true);
    expect(existsSync(join(tmpDir, '.cleave', 'logs', 'session_1_next_prompt.md'))).toBe(true);
  });

  it('marks session start timestamp', async () => {
    await state.init();
    const before = Date.now();
    await state.markSessionStart();
    const ts = await state.getSessionStart();
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(Date.now());
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/state/__tests__/files.test.ts`
Expected: FAIL — `CleaveState` does not exist

**Step 3: Implement CleaveState**

File: `src/state/files.ts`

```typescript
import { mkdir, readFile, writeFile, copyFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export class CleaveState {
  private cleaveDir: string;
  private logsDir: string;

  constructor(private projectDir: string) {
    this.cleaveDir = join(projectDir, '.cleave');
    this.logsDir = join(this.cleaveDir, 'logs');
  }

  async init(): Promise<void> {
    await mkdir(this.cleaveDir, { recursive: true });
    await mkdir(this.logsDir, { recursive: true });
  }

  // Session count
  async getSessionCount(): Promise<number> {
    return this.readInt('.session_count', 0);
  }

  async setSessionCount(n: number): Promise<void> {
    await this.writeInternal('.session_count', String(n));
  }

  // Session start timestamp
  async markSessionStart(): Promise<void> {
    await this.writeInternal('.session_start', String(Date.now()));
  }

  async getSessionStart(): Promise<number> {
    return this.readInt('.session_start', 0);
  }

  // NEXT_PROMPT.md
  async readNextPrompt(): Promise<string> {
    return this.readInternal('NEXT_PROMPT.md');
  }

  async writeNextPrompt(content: string): Promise<void> {
    await this.writeInternal('NEXT_PROMPT.md', content);
  }

  // PROGRESS.md
  async readProgress(): Promise<string> {
    return this.readInternal('PROGRESS.md');
  }

  async writeProgress(content: string): Promise<void> {
    await this.writeInternal('PROGRESS.md', content);
  }

  // KNOWLEDGE.md
  async readKnowledge(): Promise<string> {
    return this.readInternal('KNOWLEDGE.md');
  }

  async writeKnowledge(content: string): Promise<void> {
    await this.writeInternal('KNOWLEDGE.md', content);
  }

  // Handoff signal
  async readHandoffSignal(): Promise<string | null> {
    const content = await this.readInternal('.handoff_signal');
    return content.trim() || null;
  }

  async writeHandoffSignal(signal: string): Promise<void> {
    await this.writeInternal('.handoff_signal', signal);
  }

  async clearHandoffSignal(): Promise<void> {
    const path = join(this.cleaveDir, '.handoff_signal');
    if (existsSync(path)) {
      await rm(path);
    }
  }

  // Archive session files to logs/
  async archiveSession(sessionNum: number): Promise<void> {
    const files = ['PROGRESS.md', 'NEXT_PROMPT.md', 'KNOWLEDGE.md'];
    const prefixes = ['progress', 'next_prompt', 'knowledge'];
    for (let i = 0; i < files.length; i++) {
      const src = join(this.cleaveDir, files[i]);
      if (existsSync(src)) {
        const dest = join(this.logsDir, `session_${sessionNum}_${prefixes[i]}.md`);
        await copyFile(src, dest);
      }
    }
  }

  get dir(): string {
    return this.cleaveDir;
  }

  get project(): string {
    return this.projectDir;
  }

  // Internal helpers
  private async readInternal(filename: string): Promise<string> {
    const path = join(this.cleaveDir, filename);
    if (!existsSync(path)) return '';
    return readFile(path, 'utf-8');
  }

  private async writeInternal(filename: string, content: string): Promise<void> {
    await writeFile(join(this.cleaveDir, filename), content, 'utf-8');
  }

  private async readInt(filename: string, defaultVal: number): Promise<number> {
    const content = await this.readInternal(filename);
    const parsed = parseInt(content.trim(), 10);
    return isNaN(parsed) ? defaultVal : parsed;
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/state/__tests__/files.test.ts`
Expected: All 9 tests PASS

**Step 5: Commit**

```bash
git add src/state/
git commit -m "feat: add .cleave/ state file management with tests"
```

---

## Task 4: Knowledge Compaction

**Files:**
- Create: `src/state/knowledge.ts`
- Create: `src/state/__tests__/knowledge.test.ts`

**Step 1: Write failing tests**

File: `src/state/__tests__/knowledge.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import { compactKnowledge } from '../knowledge.js';

describe('compactKnowledge', () => {
  it('preserves Core Knowledge section', () => {
    const input = `## Core Knowledge\n- Important fact\n- Another fact\n\n## Session Log\n### Session 1\n- Did thing`;
    const result = compactKnowledge(input, 5);
    expect(result).toContain('## Core Knowledge');
    expect(result).toContain('- Important fact');
  });

  it('prunes Session Log to last N sessions', () => {
    const sessions = Array.from({ length: 8 }, (_, i) =>
      `### Session ${i + 1}\n- Completed task ${i + 1}`
    ).join('\n\n');
    const input = `## Core Knowledge\n- Fact\n\n## Session Log\n${sessions}`;
    const result = compactKnowledge(input, 3);
    expect(result).not.toContain('Session 1');
    expect(result).not.toContain('Session 5');
    expect(result).toContain('Session 6');
    expect(result).toContain('Session 7');
    expect(result).toContain('Session 8');
  });

  it('handles empty knowledge', () => {
    const result = compactKnowledge('', 5);
    expect(result).toBe('## Core Knowledge\n\n## Session Log\n');
  });

  it('handles knowledge with no Session Log', () => {
    const input = '## Core Knowledge\n- Fact';
    const result = compactKnowledge(input, 5);
    expect(result).toContain('## Core Knowledge');
    expect(result).toContain('- Fact');
    expect(result).toContain('## Session Log');
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/state/__tests__/knowledge.test.ts`
Expected: FAIL

**Step 3: Implement knowledge compaction**

File: `src/state/knowledge.ts`

```typescript
export function compactKnowledge(content: string, maxSessions: number): string {
  if (!content.trim()) {
    return '## Core Knowledge\n\n## Session Log\n';
  }

  const sessionLogIndex = content.indexOf('## Session Log');

  let coreSection: string;
  let sessionSection: string;

  if (sessionLogIndex === -1) {
    coreSection = content.trim();
    sessionSection = '';
  } else {
    coreSection = content.slice(0, sessionLogIndex).trim();
    sessionSection = content.slice(sessionLogIndex + '## Session Log'.length).trim();
  }

  // Split session entries by ### headers
  const sessionEntries: string[] = [];
  const lines = sessionSection.split('\n');
  let currentEntry = '';

  for (const line of lines) {
    if (line.startsWith('### Session ')) {
      if (currentEntry.trim()) {
        sessionEntries.push(currentEntry.trim());
      }
      currentEntry = line + '\n';
    } else {
      currentEntry += line + '\n';
    }
  }
  if (currentEntry.trim()) {
    sessionEntries.push(currentEntry.trim());
  }

  // Keep only last N sessions
  const kept = sessionEntries.slice(-maxSessions);

  return `${coreSection}\n\n## Session Log\n${kept.length ? kept.join('\n\n') + '\n' : ''}`;
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/state/__tests__/knowledge.test.ts`
Expected: All 4 tests PASS

**Step 5: Commit**

```bash
git add src/state/knowledge.ts src/state/__tests__/knowledge.test.ts
git commit -m "feat: add knowledge compaction with rolling session log"
```

---

## Task 5: Prompt Builder

**Files:**
- Create: `src/relay/prompt-builder.ts`
- Create: `src/relay/__tests__/prompt-builder.test.ts`

**Step 1: Write failing tests**

File: `src/relay/__tests__/prompt-builder.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import { buildSessionPrompt, buildHandoffInstructions } from '../prompt-builder.js';

describe('buildHandoffInstructions', () => {
  it('includes handoff file paths', () => {
    const instructions = buildHandoffInstructions('/project');
    expect(instructions).toContain('PROGRESS.md');
    expect(instructions).toContain('KNOWLEDGE.md');
    expect(instructions).toContain('NEXT_PROMPT.md');
    expect(instructions).toContain('.handoff_signal');
  });

  it('includes HANDOFF_COMPLETE signal', () => {
    const instructions = buildHandoffInstructions('/project');
    expect(instructions).toContain('HANDOFF_COMPLETE');
    expect(instructions).toContain('TASK_FULLY_COMPLETE');
  });
});

describe('buildSessionPrompt', () => {
  it('uses initial task for session 1', () => {
    const prompt = buildSessionPrompt({
      sessionNum: 1,
      maxSessions: 10,
      initialTask: 'Fix the bugs',
      nextPrompt: '',
      knowledge: '',
      progress: '',
    });
    expect(prompt).toContain('Fix the bugs');
  });

  it('uses NEXT_PROMPT.md for subsequent sessions', () => {
    const prompt = buildSessionPrompt({
      sessionNum: 3,
      maxSessions: 10,
      initialTask: 'Fix the bugs',
      nextPrompt: 'Continue from where session 2 left off',
      knowledge: '## Core Knowledge\n- Found the root cause',
      progress: '## STATUS: IN_PROGRESS\nFixed 2 of 5 bugs',
    });
    expect(prompt).toContain('Continue from where session 2 left off');
    expect(prompt).toContain('Session 3 of 10');
    expect(prompt).toContain('Found the root cause');
  });

  it('includes knowledge context when available', () => {
    const prompt = buildSessionPrompt({
      sessionNum: 2,
      maxSessions: 5,
      initialTask: '',
      nextPrompt: 'Next task',
      knowledge: '## Core Knowledge\n- Key insight',
      progress: '',
    });
    expect(prompt).toContain('Key insight');
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/relay/__tests__/prompt-builder.test.ts`
Expected: FAIL

**Step 3: Implement prompt builder**

File: `src/relay/prompt-builder.ts`

```typescript
export function buildHandoffInstructions(projectDir: string): string {
  return `
## SESSION RELAY PROTOCOL

You are in an autonomous relay session managed by Cleave. You have a SESSION BUDGET that WILL cut you off when exhausted. Before that happens, you MUST write handoff files.

### When to hand off
- When you've completed a meaningful chunk of work
- When you sense you're running low on budget (after many tool calls)
- BEFORE the budget cuts you off — leave margin

### Handoff files (write ALL of these to .cleave/):

1. **PROGRESS.md** — Current status. Start with \`## STATUS: IN_PROGRESS\` or \`## STATUS: ALL_COMPLETE\`. List what's done, what's next, blockers.

2. **KNOWLEDGE.md** — Two sections:
   - \`## Core Knowledge\` — Permanent insights (architecture decisions, key patterns found, important file paths). Append new discoveries, never delete.
   - \`## Session Log\` — This session's work summary under \`### Session N\`.

3. **NEXT_PROMPT.md** — Complete prompt for the next session. Include: what to do next, relevant file paths, context needed. Write it as if briefing a skilled developer who has never seen this codebase.

4. **.handoff_signal** — Write exactly \`HANDOFF_COMPLETE\` when handoff files are ready. Write \`TASK_FULLY_COMPLETE\` ONLY when the entire original task is 100% done.

### Rules
- Write handoff files BEFORE you run out of budget
- NEXT_PROMPT.md must be self-contained — the next session has NO memory of this one
- Always update KNOWLEDGE.md — this is how wisdom persists across sessions
- Do NOT write TASK_FULLY_COMPLETE unless the original task is truly finished
`.trim();
}

export interface SessionPromptInput {
  sessionNum: number;
  maxSessions: number;
  initialTask: string;
  nextPrompt: string;
  knowledge: string;
  progress: string;
}

export function buildSessionPrompt(input: SessionPromptInput): string {
  const { sessionNum, maxSessions, initialTask, nextPrompt, knowledge, progress } = input;

  const parts: string[] = [];

  parts.push(`# Cleave Relay — Session ${sessionNum} of ${maxSessions}`);
  parts.push('');

  if (knowledge.trim()) {
    parts.push('## Accumulated Knowledge');
    parts.push(knowledge.trim());
    parts.push('');
  }

  if (progress.trim() && sessionNum > 1) {
    parts.push('## Previous Progress');
    parts.push(progress.trim());
    parts.push('');
  }

  parts.push('## Your Task');
  if (sessionNum === 1 || !nextPrompt.trim()) {
    parts.push(initialTask);
  } else {
    parts.push(nextPrompt.trim());
  }

  return parts.join('\n');
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/relay/__tests__/prompt-builder.test.ts`
Expected: All 5 tests PASS

**Step 5: Commit**

```bash
git add src/relay/
git commit -m "feat: add session prompt builder with handoff instructions"
```

---

## Task 6: Handoff Detection & Rescue

**Files:**
- Create: `src/relay/handoff.ts`
- Create: `src/relay/__tests__/handoff.test.ts`

**Step 1: Write failing tests**

File: `src/relay/__tests__/handoff.test.ts`

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CleaveState } from '../../state/files.js';
import { detectHandoff, generateRescueHandoff } from '../handoff.js';

describe('detectHandoff', () => {
  let tmpDir: string;
  let state: CleaveState;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'cleave-test-'));
    state = new CleaveState(tmpDir);
    await state.init();
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('returns null when no signal file', async () => {
    const result = await detectHandoff(state);
    expect(result).toBeNull();
  });

  it('returns handoff when signal is HANDOFF_COMPLETE', async () => {
    await state.writeHandoffSignal('HANDOFF_COMPLETE');
    const result = await detectHandoff(state);
    expect(result).toBe('handoff');
  });

  it('returns complete when signal is TASK_FULLY_COMPLETE', async () => {
    await state.writeHandoffSignal('TASK_FULLY_COMPLETE');
    const result = await detectHandoff(state);
    expect(result).toBe('complete');
  });
});

describe('generateRescueHandoff', () => {
  let tmpDir: string;
  let state: CleaveState;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'cleave-test-'));
    state = new CleaveState(tmpDir);
    await state.init();
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('generates rescue files with session context', async () => {
    await generateRescueHandoff(state, 3, 'Original task description');
    const nextPrompt = await state.readNextPrompt();
    const progress = await state.readProgress();
    expect(nextPrompt).toContain('Original task description');
    expect(nextPrompt).toContain('session 3');
    expect(progress).toContain('INTERRUPTED');
  });

  it('preserves existing knowledge', async () => {
    await state.writeKnowledge('## Core Knowledge\n- Important fact');
    await generateRescueHandoff(state, 2, 'Some task');
    const knowledge = await state.readKnowledge();
    expect(knowledge).toContain('Important fact');
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/relay/__tests__/handoff.test.ts`
Expected: FAIL

**Step 3: Implement handoff detection and rescue**

File: `src/relay/handoff.ts`

```typescript
import { CleaveState } from '../state/files.js';

export type HandoffResult = 'handoff' | 'complete' | null;

export async function detectHandoff(state: CleaveState): Promise<HandoffResult> {
  const signal = await state.readHandoffSignal();
  if (!signal) return null;

  const normalized = signal.trim().toUpperCase();
  if (normalized.includes('TASK_FULLY_COMPLETE')) return 'complete';
  if (normalized.includes('HANDOFF_COMPLETE')) return 'handoff';
  return null;
}

export async function generateRescueHandoff(
  state: CleaveState,
  sessionNum: number,
  originalTask: string,
): Promise<void> {
  // Preserve existing knowledge
  const existingKnowledge = await state.readKnowledge();

  // Generate rescue progress
  await state.writeProgress(
    `## STATUS: INTERRUPTED\n\nSession ${sessionNum} was interrupted before writing handoff files.\nThis is an auto-generated rescue handoff.\n`
  );

  // Generate rescue prompt
  await state.writeNextPrompt(
    `# Rescue Handoff — Continuing from session ${sessionNum}\n\n` +
    `The previous session was interrupted before completing its handoff.\n\n` +
    `## Original Task\n${originalTask}\n\n` +
    `## Instructions\n` +
    `1. Check .cleave/PROGRESS.md for any partial progress notes\n` +
    `2. Check git log and git diff for changes made by the previous session\n` +
    `3. Continue the original task from where it left off\n`
  );

  // Ensure knowledge file exists (don't overwrite if it has content)
  if (!existingKnowledge.trim()) {
    await state.writeKnowledge('## Core Knowledge\n\n## Session Log\n');
  }

  await state.writeHandoffSignal('HANDOFF_COMPLETE');
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/relay/__tests__/handoff.test.ts`
Expected: All 5 tests PASS

**Step 5: Commit**

```bash
git add src/relay/handoff.ts src/relay/__tests__/handoff.test.ts
git commit -m "feat: add handoff detection and rescue handoff generation"
```

---

## Task 7: Session Runner

**Files:**
- Create: `src/relay/session.ts`
- Create: `src/relay/__tests__/session.test.ts`

This is the core: spawns `claude -p --output-format stream-json`, reads the stream, emits parsed events, returns session result.

**Step 1: Write failing tests**

File: `src/relay/__tests__/session.test.ts`

```typescript
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
  const proc = Object.assign(new EventEmitter(), { stdout, stderr, stdin, pid: 1234, kill: vi.fn() });

  // Push lines async
  setTimeout(() => {
    for (const line of lines) {
      stdout.push(line + '\n');
    }
    stdout.push(null);
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
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/relay/__tests__/session.test.ts`
Expected: FAIL

**Step 3: Implement SessionRunner**

File: `src/relay/session.ts`

```typescript
import { spawn, ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import { EventEmitter } from 'node:events';
import { parseStreamLine } from '../stream/parser.js';
import type { ParsedEvent } from '../stream/types.js';

export interface SessionConfig {
  projectDir: string;
  prompt: string;
  handoffInstructions: string;
  budget: number;
  model?: string;
  verbose?: boolean;
  skipPermissions?: boolean;
  allowedTools?: string[];
}

export interface SessionResult {
  exitCode: number;
  costUsd: number;
  totalCostUsd: number;
  durationMs: number;
  numTurns: number;
  toolUseCount: number;
  fullText: string;
  rateLimited: boolean;
  rateLimitResetAt?: number;
  sessionId: string;
}

export class SessionRunner extends EventEmitter {
  private config: SessionConfig;
  private child: ChildProcess | null = null;

  constructor(config: SessionConfig) {
    super();
    this.config = config;
  }

  async run(): Promise<SessionResult> {
    const args = this.buildArgs();
    const env = { ...process.env };
    delete env.CLAUDECODE;  // Prevent nested session detection

    this.child = spawn('claude', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: this.config.projectDir,
      env,
    });

    // Send prompt via stdin
    this.child.stdin!.write(this.config.prompt);
    this.child.stdin!.end();

    const result: SessionResult = {
      exitCode: 0,
      costUsd: 0,
      totalCostUsd: 0,
      durationMs: 0,
      numTurns: 0,
      toolUseCount: 0,
      fullText: '',
      rateLimited: false,
      sessionId: '',
    };

    // Process stdout as NDJSON
    const rl = createInterface({ input: this.child.stdout! });

    for await (const line of rl) {
      if (!line.trim()) continue;

      const events = parseStreamLine(line);
      for (const event of events) {
        this.emit('event', event);

        switch (event.kind) {
          case 'text':
            result.fullText += event.text;
            break;
          case 'tool_start':
            result.toolUseCount++;
            break;
          case 'result':
            result.costUsd = event.costUsd;
            result.totalCostUsd = event.totalCostUsd;
            result.durationMs = event.durationMs;
            result.numTurns = event.numTurns;
            result.sessionId = event.sessionId;
            break;
          case 'rate_limit':
            if (event.blocked) {
              result.rateLimited = true;
              result.rateLimitResetAt = event.resetsAt;
            }
            break;
          case 'error':
            this.emit('error', new Error(event.message));
            break;
        }
      }
    }

    // Wait for process to close
    const exitCode = await new Promise<number>((resolve) => {
      if (this.child!.exitCode !== null) {
        resolve(this.child!.exitCode);
      } else {
        this.child!.on('close', (code) => resolve(code ?? 1));
      }
    });

    result.exitCode = exitCode;
    return result;
  }

  kill(): void {
    this.child?.kill('SIGTERM');
  }

  private buildArgs(): string[] {
    const args: string[] = [
      '-p',
      '--output-format', 'stream-json',
      '--verbose',
      '--include-partial-messages',
    ];

    if (this.config.handoffInstructions) {
      args.push('--append-system-prompt', this.config.handoffInstructions);
    }

    if (this.config.budget > 0) {
      args.push('--max-budget-usd', String(this.config.budget));
    }

    if (this.config.model) {
      args.push('--model', this.config.model);
    }

    if (this.config.skipPermissions) {
      args.push('--dangerously-skip-permissions');
    }

    if (this.config.allowedTools?.length) {
      for (const tool of this.config.allowedTools) {
        args.push('--allowedTools', tool);
      }
    }

    return args;
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/relay/__tests__/session.test.ts`
Expected: All 3 tests PASS

**Step 5: Commit**

```bash
git add src/relay/session.ts src/relay/__tests__/session.test.ts
git commit -m "feat: add session runner that spawns claude -p and parses stream events"
```

---

## Task 8: Relay Loop

**Files:**
- Create: `src/relay/loop.ts`
- Create: `src/relay/__tests__/loop.test.ts`
- Create: `src/relay/config.ts`

**Step 1: Create relay config**

File: `src/relay/config.ts`

```typescript
export interface RelayConfig {
  projectDir: string;
  initialTask: string;
  maxSessions: number;
  sessionBudget: number;
  model?: string;
  verbose?: boolean;
  skipPermissions?: boolean;
  allowedTools?: string[];
  maxSessionLogEntries: number;
}

export const DEFAULT_CONFIG: Partial<RelayConfig> = {
  maxSessions: 10,
  sessionBudget: 5,
  maxSessionLogEntries: 5,
};
```

**Step 2: Write failing tests for relay loop**

File: `src/relay/__tests__/loop.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock SessionRunner
vi.mock('../session.js', () => ({
  SessionRunner: vi.fn(),
}));

import { SessionRunner } from '../session.js';
import { CleaveState } from '../../state/files.js';
import { RelayLoop } from '../loop.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function mockSessionRunner(handoffType: 'handoff' | 'complete' | 'none', state: CleaveState) {
  return vi.fn().mockImplementation(() => ({
    on: vi.fn(),
    run: vi.fn(async () => {
      // Simulate Claude writing handoff files
      if (handoffType === 'handoff') {
        await state.writeHandoffSignal('HANDOFF_COMPLETE');
        await state.writeNextPrompt('Continue the work');
        await state.writeProgress('## STATUS: IN_PROGRESS\nDid some work');
        await state.writeKnowledge('## Core Knowledge\n- Learned something\n\n## Session Log\n### Session 1\n- Did work');
      } else if (handoffType === 'complete') {
        await state.writeHandoffSignal('TASK_FULLY_COMPLETE');
        await state.writeProgress('## STATUS: ALL_COMPLETE\nAll done');
      }
      return {
        exitCode: 0,
        costUsd: 2.0,
        totalCostUsd: 2.0,
        durationMs: 30000,
        numTurns: 5,
        toolUseCount: 10,
        fullText: 'output',
        rateLimited: false,
        sessionId: 'test',
      };
    }),
  }));
}

describe('RelayLoop', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'cleave-test-'));
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('runs a single session when task completes in session 1', async () => {
    const state = new CleaveState(tmpDir);
    await state.init();
    (SessionRunner as any).mockImplementation(mockSessionRunner('complete', state));

    const loop = new RelayLoop({
      projectDir: tmpDir,
      initialTask: 'Simple task',
      maxSessions: 10,
      sessionBudget: 5,
      maxSessionLogEntries: 5,
    });

    const result = await loop.run();
    expect(result.sessionsRun).toBe(1);
    expect(result.completed).toBe(true);
  });

  it('chains sessions on handoff', async () => {
    const state = new CleaveState(tmpDir);
    await state.init();
    let callCount = 0;

    (SessionRunner as any).mockImplementation(() => ({
      on: vi.fn(),
      run: vi.fn(async () => {
        callCount++;
        if (callCount < 3) {
          await state.writeHandoffSignal('HANDOFF_COMPLETE');
          await state.writeNextPrompt('Continue from here');
          await state.writeProgress('## STATUS: IN_PROGRESS');
          await state.writeKnowledge('## Core Knowledge\n\n## Session Log\n');
        } else {
          await state.writeHandoffSignal('TASK_FULLY_COMPLETE');
          await state.writeProgress('## STATUS: ALL_COMPLETE');
        }
        return {
          exitCode: 0, costUsd: 1.0, totalCostUsd: 1.0 * callCount,
          durationMs: 10000, numTurns: 3, toolUseCount: 5,
          fullText: '', rateLimited: false, sessionId: `s${callCount}`,
        };
      }),
    }));

    const loop = new RelayLoop({
      projectDir: tmpDir,
      initialTask: 'Big task',
      maxSessions: 10,
      sessionBudget: 5,
      maxSessionLogEntries: 5,
    });

    const result = await loop.run();
    expect(result.sessionsRun).toBe(3);
    expect(result.completed).toBe(true);
  });

  it('stops at max sessions limit', async () => {
    const state = new CleaveState(tmpDir);
    await state.init();

    (SessionRunner as any).mockImplementation(() => ({
      on: vi.fn(),
      run: vi.fn(async () => {
        await state.writeHandoffSignal('HANDOFF_COMPLETE');
        await state.writeNextPrompt('Continue');
        await state.writeProgress('## STATUS: IN_PROGRESS');
        await state.writeKnowledge('## Core Knowledge\n\n## Session Log\n');
        return {
          exitCode: 0, costUsd: 1.0, totalCostUsd: 1.0,
          durationMs: 10000, numTurns: 3, toolUseCount: 5,
          fullText: '', rateLimited: false, sessionId: 'test',
        };
      }),
    }));

    const loop = new RelayLoop({
      projectDir: tmpDir,
      initialTask: 'Endless task',
      maxSessions: 3,
      sessionBudget: 5,
      maxSessionLogEntries: 5,
    });

    const result = await loop.run();
    expect(result.sessionsRun).toBe(3);
    expect(result.completed).toBe(false);
    expect(result.reason).toBe('max_sessions');
  });
});
```

**Step 3: Run tests to verify they fail**

Run: `npx vitest run src/relay/__tests__/loop.test.ts`
Expected: FAIL

**Step 4: Implement RelayLoop**

File: `src/relay/loop.ts`

```typescript
import { EventEmitter } from 'node:events';
import { SessionRunner, type SessionResult } from './session.js';
import { CleaveState } from '../state/files.js';
import { detectHandoff, generateRescueHandoff } from './handoff.js';
import { buildSessionPrompt, buildHandoffInstructions } from './prompt-builder.js';
import { compactKnowledge } from '../state/knowledge.js';
import type { RelayConfig } from './config.js';
import type { ParsedEvent } from '../stream/types.js';

export interface RelayResult {
  sessionsRun: number;
  completed: boolean;
  reason: 'task_complete' | 'max_sessions' | 'error';
  totalCostUsd: number;
  totalDurationMs: number;
}

export class RelayLoop extends EventEmitter {
  private config: RelayConfig;
  private state: CleaveState;

  constructor(config: RelayConfig) {
    super();
    this.config = config;
    this.state = new CleaveState(config.projectDir);
  }

  async run(): Promise<RelayResult> {
    await this.state.init();

    let sessionsRun = 0;
    let totalCost = 0;
    let totalDuration = 0;

    for (let i = 1; i <= this.config.maxSessions; i++) {
      sessionsRun = i;
      await this.state.setSessionCount(i);
      await this.state.clearHandoffSignal();
      await this.state.markSessionStart();

      // Compact knowledge before each session
      const rawKnowledge = await this.state.readKnowledge();
      if (rawKnowledge.trim()) {
        const compacted = compactKnowledge(rawKnowledge, this.config.maxSessionLogEntries);
        await this.state.writeKnowledge(compacted);
      }

      // Build the prompt
      const prompt = buildSessionPrompt({
        sessionNum: i,
        maxSessions: this.config.maxSessions,
        initialTask: this.config.initialTask,
        nextPrompt: await this.state.readNextPrompt(),
        knowledge: await this.state.readKnowledge(),
        progress: await this.state.readProgress(),
      });

      this.emit('session_start', { sessionNum: i, maxSessions: this.config.maxSessions });

      // Run the session
      const runner = new SessionRunner({
        projectDir: this.config.projectDir,
        prompt,
        handoffInstructions: buildHandoffInstructions(this.config.projectDir),
        budget: this.config.sessionBudget,
        model: this.config.model,
        verbose: this.config.verbose,
        skipPermissions: this.config.skipPermissions,
        allowedTools: this.config.allowedTools,
      });

      // Forward events from session to relay
      runner.on('event', (event: ParsedEvent) => {
        this.emit('event', event);
      });

      let sessionResult: SessionResult;
      try {
        sessionResult = await runner.run();
      } catch (err) {
        this.emit('session_error', { sessionNum: i, error: err });
        await generateRescueHandoff(this.state, i, this.config.initialTask);
        continue;
      }

      totalCost += sessionResult.costUsd;
      totalDuration += sessionResult.durationMs;

      this.emit('session_end', {
        sessionNum: i,
        result: sessionResult,
        totalCost,
      });

      // Archive session files
      await this.state.archiveSession(i);

      // Check for handoff
      const handoff = await detectHandoff(this.state);

      if (handoff === 'complete') {
        return {
          sessionsRun,
          completed: true,
          reason: 'task_complete',
          totalCostUsd: totalCost,
          totalDurationMs: totalDuration,
        };
      }

      if (handoff === 'handoff') {
        // Chain to next session
        continue;
      }

      // No handoff signal — generate rescue
      this.emit('rescue', { sessionNum: i });
      await generateRescueHandoff(this.state, i, this.config.initialTask);
    }

    return {
      sessionsRun,
      completed: false,
      reason: 'max_sessions',
      totalCostUsd: totalCost,
      totalDurationMs: totalDuration,
    };
  }
}
```

**Step 5: Run tests to verify they pass**

Run: `npx vitest run src/relay/__tests__/loop.test.ts`
Expected: All 3 tests PASS

**Step 6: Commit**

```bash
git add src/relay/loop.ts src/relay/__tests__/loop.test.ts src/relay/config.ts
git commit -m "feat: add relay loop with session chaining, handoff detection, and rescue"
```

---

## Task 9: TUI — Header Component

**Files:**
- Create: `src/tui/Header.tsx`
- Create: `src/tui/__tests__/Header.test.tsx`

**Step 1: Write failing test**

File: `src/tui/__tests__/Header.test.tsx`

```typescript
import { describe, it, expect } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { Header } from '../Header.js';

describe('Header', () => {
  it('displays session info', () => {
    const { lastFrame } = render(
      <Header
        sessionNum={3}
        maxSessions={20}
        projectDir="/Users/test/myproject"
        elapsedMs={252000}
        costUsd={2.30}
        budgetUsd={5.00}
        contextPercent={62}
      />
    );
    const output = lastFrame()!;
    expect(output).toContain('Session 3/20');
    expect(output).toContain('myproject');
    expect(output).toContain('$2.30');
    expect(output).toContain('62%');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/tui/__tests__/Header.test.tsx`
Expected: FAIL

**Step 3: Implement Header**

File: `src/tui/Header.tsx`

```tsx
import React from 'react';
import { Box, Text } from 'ink';
import { basename } from 'node:path';

interface HeaderProps {
  sessionNum: number;
  maxSessions: number;
  projectDir: string;
  elapsedMs: number;
  costUsd: number;
  budgetUsd: number;
  contextPercent: number;
}

function formatDuration(ms: number): string {
  const totalSecs = Math.floor(ms / 1000);
  const mins = Math.floor(totalSecs / 60);
  const secs = totalSecs % 60;
  return `${mins}m ${secs.toString().padStart(2, '0')}s`;
}

function contextBar(percent: number, width: number = 20): string {
  const filled = Math.round((percent / 100) * width);
  const empty = width - filled;
  return '\u2588'.repeat(filled) + '\u2591'.repeat(empty);
}

export function Header({
  sessionNum,
  maxSessions,
  projectDir,
  elapsedMs,
  costUsd,
  budgetUsd,
  contextPercent,
}: HeaderProps) {
  const dir = basename(projectDir);
  const barColor = contextPercent > 80 ? 'red' : contextPercent > 60 ? 'yellow' : 'green';

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="cyan" paddingX={1}>
      <Box justifyContent="space-between">
        <Text bold color="cyan">CLEAVE</Text>
        <Text>Session <Text bold>{sessionNum}/{maxSessions}</Text></Text>
        <Text dimColor>~/{dir}</Text>
        <Text dimColor>{formatDuration(elapsedMs)}</Text>
      </Box>
      <Box justifyContent="space-between">
        <Text>
          Context: <Text color={barColor}>{contextBar(contextPercent)}</Text>{' '}
          <Text bold>{contextPercent}%</Text>
        </Text>
        <Text>
          Budget: <Text bold color={costUsd > budgetUsd * 0.8 ? 'yellow' : 'green'}>
            ${costUsd.toFixed(2)}
          </Text>/${budgetUsd.toFixed(2)}
        </Text>
      </Box>
    </Box>
  );
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/tui/__tests__/Header.test.tsx`
Expected: PASS

**Step 5: Commit**

```bash
git add src/tui/
git commit -m "feat: add TUI Header component with session info and context bar"
```

---

## Task 10: TUI — StreamView & ToolCard Components

**Files:**
- Create: `src/tui/ToolCard.tsx`
- Create: `src/tui/StreamView.tsx`
- Create: `src/tui/__tests__/StreamView.test.tsx`

**Step 1: Write failing tests**

File: `src/tui/__tests__/StreamView.test.tsx`

```typescript
import { describe, it, expect } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { StreamView } from '../StreamView.js';
import type { ParsedEvent } from '../../stream/types.js';

describe('StreamView', () => {
  it('renders text events', () => {
    const events: ParsedEvent[] = [
      { kind: 'text', text: 'Let me analyze the code.' },
    ];
    const { lastFrame } = render(<StreamView events={events} />);
    expect(lastFrame()).toContain('Let me analyze the code.');
  });

  it('renders tool_start events as cards', () => {
    const events: ParsedEvent[] = [
      { kind: 'tool_start', name: 'Read', id: 't1', input: { file_path: '/src/index.ts' } },
    ];
    const { lastFrame } = render(<StreamView events={events} />);
    expect(lastFrame()).toContain('Read');
    expect(lastFrame()).toContain('/src/index.ts');
  });

  it('renders agent tool_start events', () => {
    const events: ParsedEvent[] = [
      {
        kind: 'tool_start',
        name: 'Agent',
        id: 't2',
        input: { subagent_type: 'Explore', description: 'Find utils' }
      },
    ];
    const { lastFrame } = render(<StreamView events={events} />);
    expect(lastFrame()).toContain('Agent');
    expect(lastFrame()).toContain('Explore');
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/tui/__tests__/StreamView.test.tsx`
Expected: FAIL

**Step 3: Implement ToolCard**

File: `src/tui/ToolCard.tsx`

```tsx
import React from 'react';
import { Box, Text } from 'ink';
import type { ParsedToolStart } from '../stream/types.js';

interface ToolCardProps {
  tool: ParsedToolStart;
}

function summarizeInput(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case 'Read':
      return String(input.file_path ?? '');
    case 'Edit':
      return String(input.file_path ?? '');
    case 'Write':
      return String(input.file_path ?? '');
    case 'Bash':
      return String(input.command ?? '').slice(0, 80);
    case 'Glob':
      return String(input.pattern ?? '');
    case 'Grep':
      return String(input.pattern ?? '');
    case 'Agent': {
      const type = String(input.subagent_type ?? 'unknown');
      const desc = String(input.description ?? '');
      return `${type}: ${desc}`.slice(0, 80);
    }
    case 'TaskCreate':
      return String(input.subject ?? '');
    default:
      return Object.keys(input).join(', ');
  }
}

const TOOL_COLORS: Record<string, string> = {
  Read: 'blue',
  Edit: 'yellow',
  Write: 'green',
  Bash: 'magenta',
  Agent: 'cyan',
  Glob: 'blue',
  Grep: 'blue',
  TaskCreate: 'green',
  TaskUpdate: 'green',
};

export function ToolCard({ tool }: ToolCardProps) {
  const color = TOOL_COLORS[tool.name] ?? 'white';
  const summary = summarizeInput(tool.name, tool.input);

  return (
    <Box borderStyle="round" borderColor={color} paddingX={1} marginY={0}>
      <Text bold color={color}>{tool.name}</Text>
      <Text dimColor> {summary}</Text>
    </Box>
  );
}
```

**Step 4: Implement StreamView**

File: `src/tui/StreamView.tsx`

```tsx
import React from 'react';
import { Box, Text, Static } from 'ink';
import { ToolCard } from './ToolCard.js';
import type { ParsedEvent, ParsedToolStart } from '../stream/types.js';

interface StreamViewProps {
  events: ParsedEvent[];
}

export function StreamView({ events }: StreamViewProps) {
  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1}>
      <Static items={events.map((e, i) => ({ ...e, key: i }))}>
        {(event) => {
          switch (event.kind) {
            case 'text':
              return <Text key={event.key}>{event.text}</Text>;
            case 'tool_start':
              return <ToolCard key={event.key} tool={event as ParsedToolStart} />;
            case 'error':
              return (
                <Box key={event.key} borderStyle="round" borderColor="red" paddingX={1}>
                  <Text color="red" bold>Error: </Text>
                  <Text>{event.message}</Text>
                </Box>
              );
            case 'rate_limit':
              return (
                <Box key={event.key} borderStyle="round" borderColor="yellow" paddingX={1}>
                  <Text color="yellow" bold>Rate limited</Text>
                  <Text dimColor> — resets at {new Date(event.resetsAt).toLocaleTimeString()}</Text>
                </Box>
              );
            default:
              return null;
          }
        }}
      </Static>
    </Box>
  );
}
```

**Step 5: Run tests to verify they pass**

Run: `npx vitest run src/tui/__tests__/StreamView.test.tsx`
Expected: All 3 tests PASS

**Step 6: Commit**

```bash
git add src/tui/ToolCard.tsx src/tui/StreamView.tsx src/tui/__tests__/StreamView.test.tsx
git commit -m "feat: add StreamView and ToolCard TUI components"
```

---

## Task 11: TUI — Footer & Transition Components

**Files:**
- Create: `src/tui/Footer.tsx`
- Create: `src/tui/Transition.tsx`

**Step 1: Implement Footer**

File: `src/tui/Footer.tsx`

```tsx
import React from 'react';
import { Box, Text } from 'ink';

interface FooterProps {
  knowledgeSize: number;  // bytes
  tasksCompleted: number;
  tasksTotal: number;
  handoffStatus: 'waiting' | 'ready' | 'complete';
}

export function Footer({ knowledgeSize, tasksCompleted, tasksTotal, handoffStatus }: FooterProps) {
  const kbSize = (knowledgeSize / 1024).toFixed(1);

  const statusColor = {
    waiting: 'yellow',
    ready: 'green',
    complete: 'cyan',
  }[handoffStatus];

  return (
    <Box borderStyle="single" borderColor="gray" paddingX={1} justifyContent="space-between">
      <Text>Knowledge: <Text bold>{kbSize}KB</Text></Text>
      {tasksTotal > 0 && (
        <Text>Tasks: <Text bold>{tasksCompleted}/{tasksTotal}</Text></Text>
      )}
      <Text>Handoff: <Text bold color={statusColor}>{handoffStatus}</Text></Text>
    </Box>
  );
}
```

**Step 2: Implement Transition**

File: `src/tui/Transition.tsx`

```tsx
import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';

interface TransitionProps {
  sessionNum: number;
  maxSessions: number;
  contextPercent: number;
  costUsd: number;
  tasksCompleted: number;
  tasksTotal: number;
  knowledgePromoted: number;
  onComplete: () => void;
  delayMs?: number;
}

export function Transition({
  sessionNum,
  maxSessions,
  contextPercent,
  costUsd,
  tasksCompleted,
  tasksTotal,
  knowledgePromoted,
  onComplete,
  delayMs = 3000,
}: TransitionProps) {
  const [countdown, setCountdown] = useState(Math.ceil(delayMs / 1000));

  useEffect(() => {
    const timer = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          clearInterval(timer);
          onComplete();
          return 0;
        }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [delayMs, onComplete]);

  return (
    <Box flexDirection="column" alignItems="center" borderStyle="double" borderColor="cyan" padding={1}>
      <Text bold color="cyan">SESSION {sessionNum} COMPLETE</Text>
      <Text> </Text>
      <Text>Context used: <Text bold>{contextPercent}%</Text></Text>
      <Text>Cost: <Text bold>${costUsd.toFixed(2)}</Text></Text>
      {tasksTotal > 0 && (
        <Text>Tasks completed: <Text bold>{tasksCompleted}/{tasksTotal}</Text></Text>
      )}
      {knowledgePromoted > 0 && (
        <Text>Knowledge promoted: <Text bold>{knowledgePromoted} new entries</Text></Text>
      )}
      <Text> </Text>
      <Text dimColor>
        Starting Session {sessionNum + 1}/{maxSessions} in {countdown}s...
      </Text>
    </Box>
  );
}
```

**Step 3: Verify build**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 4: Commit**

```bash
git add src/tui/Footer.tsx src/tui/Transition.tsx
git commit -m "feat: add Footer and Transition TUI components"
```

---

## Task 12: TUI — App Root Component

**Files:**
- Create: `src/tui/App.tsx`
- Create: `src/tui/useRelay.ts`

This is the main component that wires the relay loop to the TUI.

**Step 1: Create the relay hook**

File: `src/tui/useRelay.ts`

```typescript
import { useState, useEffect, useCallback, useRef } from 'react';
import { RelayLoop } from '../relay/loop.js';
import type { RelayConfig } from '../relay/config.js';
import type { ParsedEvent } from '../stream/types.js';

export type RelayPhase = 'running' | 'transition' | 'complete' | 'error';

export interface RelayState {
  phase: RelayPhase;
  sessionNum: number;
  maxSessions: number;
  events: ParsedEvent[];
  costUsd: number;
  budgetUsd: number;
  contextPercent: number;
  elapsedMs: number;
  toolCount: number;
  error?: string;
  completed: boolean;
  totalSessions: number;
}

export function useRelay(config: RelayConfig) {
  const [state, setState] = useState<RelayState>({
    phase: 'running',
    sessionNum: 1,
    maxSessions: config.maxSessions,
    events: [],
    costUsd: 0,
    budgetUsd: config.sessionBudget,
    contextPercent: 0,
    elapsedMs: 0,
    toolCount: 0,
    completed: false,
    totalSessions: 0,
  });

  const startTimeRef = useRef(Date.now());
  const timerRef = useRef<ReturnType<typeof setInterval>>();

  useEffect(() => {
    // Elapsed time ticker
    timerRef.current = setInterval(() => {
      setState(s => ({ ...s, elapsedMs: Date.now() - startTimeRef.current }));
    }, 1000);

    const loop = new RelayLoop(config);

    loop.on('session_start', ({ sessionNum, maxSessions }: { sessionNum: number; maxSessions: number }) => {
      startTimeRef.current = Date.now();
      setState(s => ({
        ...s,
        phase: 'running',
        sessionNum,
        maxSessions,
        events: [],
        costUsd: 0,
        contextPercent: 0,
        toolCount: 0,
      }));
    });

    loop.on('event', (event: ParsedEvent) => {
      setState(s => {
        const newState = { ...s, events: [...s.events, event] };
        if (event.kind === 'tool_start') {
          newState.toolCount = s.toolCount + 1;
        }
        if (event.kind === 'result') {
          newState.costUsd = event.costUsd;
          // Estimate context from cost ratio (cost/budget ≈ context usage)
          newState.contextPercent = Math.min(99, Math.round((event.costUsd / config.sessionBudget) * 100));
        }
        return newState;
      });
    });

    loop.on('session_end', ({ sessionNum, totalCost }: { sessionNum: number; result: any; totalCost: number }) => {
      setState(s => ({
        ...s,
        phase: 'transition',
        totalSessions: sessionNum,
      }));
    });

    loop.on('rescue', () => {
      setState(s => ({ ...s, phase: 'transition' }));
    });

    loop.run().then(result => {
      setState(s => ({
        ...s,
        phase: 'complete',
        completed: result.completed,
        totalSessions: result.sessionsRun,
      }));
      clearInterval(timerRef.current);
    }).catch(err => {
      setState(s => ({ ...s, phase: 'error', error: String(err) }));
      clearInterval(timerRef.current);
    });

    return () => clearInterval(timerRef.current);
  }, []);

  const advanceFromTransition = useCallback(() => {
    setState(s => ({ ...s, phase: 'running' }));
  }, []);

  return { state, advanceFromTransition };
}
```

**Step 2: Create the App root**

File: `src/tui/App.tsx`

```tsx
import React from 'react';
import { Box, Text, useApp } from 'ink';
import { Header } from './Header.js';
import { StreamView } from './StreamView.js';
import { Footer } from './Footer.js';
import { Transition } from './Transition.js';
import { useRelay } from './useRelay.js';
import type { RelayConfig } from '../relay/config.js';

interface AppProps {
  config: RelayConfig;
}

export function App({ config }: AppProps) {
  const { exit } = useApp();
  const { state, advanceFromTransition } = useRelay(config);

  if (state.phase === 'complete') {
    return (
      <Box flexDirection="column" padding={1}>
        <Box borderStyle="double" borderColor={state.completed ? 'green' : 'yellow'} padding={1} flexDirection="column" alignItems="center">
          <Text bold color={state.completed ? 'green' : 'yellow'}>
            {state.completed ? 'TASK COMPLETE' : 'SESSION LIMIT REACHED'}
          </Text>
          <Text>Sessions run: {state.totalSessions}</Text>
          <Text>Total cost: ${state.costUsd.toFixed(2)}</Text>
        </Box>
      </Box>
    );
  }

  if (state.phase === 'error') {
    return (
      <Box flexDirection="column" padding={1}>
        <Box borderStyle="double" borderColor="red" padding={1}>
          <Text bold color="red">Error: </Text>
          <Text>{state.error}</Text>
        </Box>
      </Box>
    );
  }

  if (state.phase === 'transition') {
    return (
      <Transition
        sessionNum={state.sessionNum}
        maxSessions={state.maxSessions}
        contextPercent={state.contextPercent}
        costUsd={state.costUsd}
        tasksCompleted={0}
        tasksTotal={0}
        knowledgePromoted={0}
        onComplete={advanceFromTransition}
      />
    );
  }

  // Running phase
  return (
    <Box flexDirection="column" height="100%">
      <Header
        sessionNum={state.sessionNum}
        maxSessions={state.maxSessions}
        projectDir={config.projectDir}
        elapsedMs={state.elapsedMs}
        costUsd={state.costUsd}
        budgetUsd={state.budgetUsd}
        contextPercent={state.contextPercent}
      />
      <StreamView events={state.events} />
      <Footer
        knowledgeSize={0}
        tasksCompleted={0}
        tasksTotal={0}
        handoffStatus="waiting"
      />
    </Box>
  );
}
```

**Step 3: Verify build**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 4: Commit**

```bash
git add src/tui/App.tsx src/tui/useRelay.ts
git commit -m "feat: add App root component with relay hook wiring TUI to relay loop"
```

---

## Task 13: CLI Entry Point

**Files:**
- Modify: `src/index.ts`
- Create: `src/cli.ts`

**Step 1: Implement CLI**

File: `src/cli.ts`

```typescript
import { Command } from 'commander';
import { render } from 'ink';
import React from 'react';
import { resolve } from 'node:path';
import { App } from './tui/App.js';
import type { RelayConfig } from './relay/config.js';
import { DEFAULT_CONFIG } from './relay/config.js';

export function createCli() {
  const program = new Command()
    .name('cleave')
    .description('Infinite context for Claude Code — autonomous session relay with real-time TUI')
    .version('6.0.0');

  program
    .command('run')
    .description('Start a new relay task')
    .argument('<task>', 'The task description for Claude')
    .option('-s, --sessions <n>', 'Maximum number of sessions', String(DEFAULT_CONFIG.maxSessions))
    .option('-b, --budget <n>', 'Per-session budget in USD', String(DEFAULT_CONFIG.sessionBudget))
    .option('-d, --dir <path>', 'Project directory', process.cwd())
    .option('-m, --model <model>', 'Model to use (e.g., sonnet, opus)')
    .option('--skip-permissions', 'Skip permission prompts (use with caution)', false)
    .option('--allowed-tools <tools...>', 'Tools to allow without prompting')
    .action(async (task: string, opts: any) => {
      const config: RelayConfig = {
        projectDir: resolve(opts.dir),
        initialTask: task,
        maxSessions: parseInt(opts.sessions, 10),
        sessionBudget: parseFloat(opts.budget),
        model: opts.model,
        skipPermissions: opts.skipPermissions,
        allowedTools: opts.allowedTools,
        maxSessionLogEntries: DEFAULT_CONFIG.maxSessionLogEntries!,
      };

      const { waitUntilExit } = render(React.createElement(App, { config }));
      await waitUntilExit();
    });

  program
    .command('resume')
    .description('Resume the most recent relay in this directory')
    .option('-d, --dir <path>', 'Project directory', process.cwd())
    .option('-s, --sessions <n>', 'Additional sessions to run', '10')
    .option('-b, --budget <n>', 'Per-session budget in USD', '5')
    .option('-m, --model <model>', 'Model to use')
    .option('--skip-permissions', 'Skip permission prompts', false)
    .action(async (opts: any) => {
      const projectDir = resolve(opts.dir);
      const { CleaveState } = await import('./state/files.js');
      const state = new CleaveState(projectDir);

      const nextPrompt = await state.readNextPrompt();
      if (!nextPrompt.trim()) {
        console.error('No relay state found in', projectDir);
        process.exit(1);
      }

      const config: RelayConfig = {
        projectDir,
        initialTask: nextPrompt,  // Use NEXT_PROMPT.md as the task
        maxSessions: parseInt(opts.sessions, 10),
        sessionBudget: parseFloat(opts.budget),
        model: opts.model,
        skipPermissions: opts.skipPermissions,
        maxSessionLogEntries: 5,
      };

      const { waitUntilExit } = render(React.createElement(App, { config }));
      await waitUntilExit();
    });

  program
    .command('status')
    .description('Show relay status for this directory')
    .option('-d, --dir <path>', 'Project directory', process.cwd())
    .action(async (opts: any) => {
      const { CleaveState } = await import('./state/files.js');
      const state = new CleaveState(resolve(opts.dir));
      const count = await state.getSessionCount();
      const progress = await state.readProgress();
      const signal = await state.readHandoffSignal();

      console.log(`Sessions completed: ${count}`);
      console.log(`Handoff signal: ${signal ?? 'none'}`);
      if (progress.trim()) {
        console.log(`\nProgress:\n${progress}`);
      }
    });

  return program;
}
```

**Step 2: Update entry point**

File: `src/index.ts`

```typescript
#!/usr/bin/env node
import { createCli } from './cli.js';

createCli().parse();
```

**Step 3: Verify build**

Run: `npx tsc && node dist/index.js --help`
Expected: Shows help text with `run`, `resume`, `status` commands

**Step 4: Commit**

```bash
git add src/index.ts src/cli.ts
git commit -m "feat: add CLI with run, resume, and status commands"
```

---

## Task 14: Integration Smoke Test

**Files:**
- Create: `src/__tests__/integration.test.ts`

**Step 1: Write integration test with mocked claude**

File: `src/__tests__/integration.test.ts`

```typescript
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
    const proc = Object.assign(new EventEmitter(), { stdout, stderr, stdin, pid: 99, kill: vi.fn() });

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
```

**Step 2: Run integration test**

Run: `npx vitest run src/__tests__/integration.test.ts`
Expected: PASS

**Step 3: Run all tests**

Run: `npx vitest run`
Expected: All tests PASS

**Step 4: Commit**

```bash
git add src/__tests__/
git commit -m "test: add integration test for multi-session relay chaining"
```

---

## Task 15: Final Build & Link

**Step 1: Full build**

Run: `npx tsc`
Expected: No errors

**Step 2: Make bin executable**

Run: `chmod +x dist/index.js`

**Step 3: Link locally for testing**

Run: `npm link`
Expected: `cleave` command available globally

**Step 4: Verify CLI**

Run: `cleave --help`
Expected: Shows help with run, resume, status commands

Run: `cleave run --help`
Expected: Shows run options (sessions, budget, dir, model)

**Step 5: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass

**Step 6: Final commit**

```bash
git add -A
git commit -m "feat: cleave v6.0.0 — complete build with TUI, relay loop, and CLI"
```

---

## Execution Order & Dependencies

```
Task 1  (scaffolding) ─── no deps
Task 2  (stream parser) ─── depends on 1
Task 3  (state files) ─── depends on 1
Task 4  (knowledge) ─── depends on 1
Task 5  (prompt builder) ─── depends on 1
Task 6  (handoff) ─── depends on 3
Task 7  (session runner) ─── depends on 2
Task 8  (relay loop) ─── depends on 3, 4, 5, 6, 7
Task 9  (TUI header) ─── depends on 1
Task 10 (TUI stream/tools) ─── depends on 2
Task 11 (TUI footer/transition) ─── depends on 1
Task 12 (TUI app root) ─── depends on 8, 9, 10, 11
Task 13 (CLI) ─── depends on 12
Task 14 (integration test) ─── depends on 8
Task 15 (final build) ─── depends on all
```

**Parallelizable groups:**
- Tasks 2, 3, 4, 5 can run in parallel (all depend only on 1)
- Tasks 9, 10, 11 can run in parallel (TUI components)
- Tasks 6, 7 can run in parallel (both depend on earlier tasks but not each other)
