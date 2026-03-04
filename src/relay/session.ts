import { spawn, ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import { EventEmitter } from 'node:events';
import { StreamParser } from '../stream/parser.js';
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
  remoteControl?: boolean;
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
  stderr: string;
}

export class SessionRunner extends EventEmitter {
  private config: SessionConfig;
  private child: ChildProcess | null = null;

  constructor(config: SessionConfig) {
    super();
    this.config = config;
  }

  async run(): Promise<SessionResult> {
    const startTime = Date.now();
    const args = this.buildArgs();
    const env = { ...process.env };
    delete env.CLAUDECODE;  // Prevent nested session detection

    this.child = spawn('claude', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: this.config.projectDir,
      env,
    });

    // Always capture stderr
    let stderrOutput = '';
    const stderrRl = createInterface({ input: this.child.stderr! });
    stderrRl.on('line', (line: string) => {
      stderrOutput += line + '\n';
      // Capture remote control URL if enabled
      if (this.config.remoteControl) {
        const urlMatch = line.match(/https?:\/\/\S+/);
        if (urlMatch) {
          this.emit('remote_url', urlMatch[0]);
        }
      }
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
      stderr: '',
    };

    // Process stdout as NDJSON with stateful parser for deduplication
    const parser = new StreamParser();
    const rl = createInterface({ input: this.child.stdout! });

    for await (const line of rl) {
      if (!line.trim()) continue;

      const events = parser.parseLine(line);
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
            // Don't emit EventEmitter 'error' — that throws if unhandled
            // and kills the session on non-fatal stream errors.
            // The error ParsedEvent is already forwarded via 'event' emission above.
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
    result.stderr = stderrOutput.trim();

    // Detect empty sessions — if Claude exited instantly with no work done, throw with stderr
    const wallTimeMs = Date.now() - startTime;
    if (result.numTurns === 0 && result.toolUseCount === 0 && wallTimeMs < 10_000) {
      const errorMsg = result.stderr || `Session exited in ${wallTimeMs}ms with no output (exit code ${exitCode})`;
      throw new Error(`Claude session failed to start: ${errorMsg}`);
    }

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

    if (this.config.remoteControl) {
      args.push('--remote-control');
    }

    return args;
  }
}
