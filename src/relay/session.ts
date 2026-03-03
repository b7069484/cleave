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
