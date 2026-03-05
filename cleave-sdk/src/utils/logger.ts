/**
 * Structured logging with colors and dual output (stdout + relay.log).
 */

import * as fs from 'fs';
import * as path from 'path';
import { VERSION } from '../config';

const COLORS = {
  red: '\x1b[0;31m',
  green: '\x1b[0;32m',
  yellow: '\x1b[1;33m',
  blue: '\x1b[0;34m',
  cyan: '\x1b[0;36m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  reset: '\x1b[0m',
} as const;

export class Logger {
  private logFile: string | null = null;
  private verbose: boolean = false;

  init(relayDir: string, verbose: boolean) {
    this.verbose = verbose;
    const logsDir = path.join(relayDir, 'logs');
    fs.mkdirSync(logsDir, { recursive: true });
    this.logFile = path.join(logsDir, 'relay.log');
  }

  private timestamp(): string {
    return new Date().toISOString().replace('T', ' ').replace(/\.\d+Z/, '');
  }

  private stripAnsi(str: string): string {
    return str.replace(/\x1b\[[0-9;]*m/g, '');
  }

  private write(msg: string) {
    const timestamped = `[${this.timestamp()}] ${msg}`;
    console.log(timestamped);
    if (this.logFile) {
      try {
        fs.appendFileSync(this.logFile, this.stripAnsi(timestamped) + '\n');
      } catch {
        // Log file or directory was deleted (e.g. by a Claude session with
        // --dangerously-skip-permissions). Recreate and retry once.
        try {
          fs.mkdirSync(path.dirname(this.logFile), { recursive: true });
          fs.appendFileSync(this.logFile, this.stripAnsi(timestamped) + '\n');
        } catch {
          // Truly broken — give up on file logging but don't crash the pipeline
        }
      }
    }
  }

  info(msg: string) {
    this.write(msg);
  }

  success(msg: string) {
    this.write(`${COLORS.green}${msg}${COLORS.reset}`);
  }

  warn(msg: string) {
    this.write(`${COLORS.yellow}${msg}${COLORS.reset}`);
  }

  error(msg: string) {
    this.write(`${COLORS.red}${msg}${COLORS.reset}`);
  }

  debug(msg: string) {
    if (this.verbose) {
      this.write(`${COLORS.dim}${msg}${COLORS.reset}`);
    }
  }

  session(num: number, max: number) {
    const bar = '━'.repeat(58);
    console.log('');
    console.log(`${COLORS.bold}${bar}${COLORS.reset}`);
    console.log(`${COLORS.bold}  SESSION #${num}${COLORS.reset} of ${max}`);
    console.log(`${COLORS.bold}${bar}${COLORS.reset}`);
    console.log('');
  }

  banner(config: { workDir: string; maxSessions: number; gitCommit: boolean; verifyCommand: string | null; resumeFrom: number; notify: boolean; sessionMode?: string; model?: string | null; sessionBudget?: number }) {
    const C = COLORS;
    const mode = config.sessionMode || 'print';
    const modeLabel = mode === 'print' ? 'print (auto-relay)' : mode === 'tui' ? 'TUI (interactive)' : 'headless (Agent SDK)';
    const W = 58;
    const hr = '═'.repeat(W);
    const line = (s: string) => {
      const visible = this.stripAnsi(s);
      const pad = Math.max(0, W - visible.length);
      return `${C.bold}║${C.reset}${s}${' '.repeat(pad)}${C.bold}║${C.reset}`;
    };
    console.log('');
    console.log(`${C.bold}╔${hr}╗${C.reset}`);
    console.log(line(`  ${C.cyan}cleave${C.reset} ${C.dim}v${VERSION}${C.reset}`));
    console.log(line(`  ${C.dim}Infinite context for Claude Code${C.reset}`));
    console.log(`${C.bold}╠${hr}╣${C.reset}`);
    console.log(line(`  Work dir:     ${C.blue}${path.basename(config.workDir)}${C.reset}`));
    console.log(line(`  Max sessions: ${C.blue}${config.maxSessions}${C.reset}`));
    console.log(line(`  Mode:         ${C.green}${modeLabel}${C.reset}`));
    if (config.model) console.log(line(`  Model:        ${C.blue}${config.model}${C.reset}`));
    if (config.sessionBudget) console.log(line(`  Budget/sess:  ${C.blue}$${config.sessionBudget.toFixed(2)}${C.reset}`));
    console.log(line(`  Git commit:   ${C.blue}${config.gitCommit}${C.reset}`));
    if (config.verifyCommand) console.log(line(`  Verify cmd:   ${C.blue}${config.verifyCommand}${C.reset}`));
    if (config.resumeFrom > 0) console.log(line(`  Resume from:  ${C.yellow}session #${config.resumeFrom}${C.reset}`));
    console.log(`${C.bold}╚${hr}╝${C.reset}`);
    console.log('');
  }
}

export const logger = new Logger();
