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
      fs.appendFileSync(this.logFile, this.stripAnsi(timestamped) + '\n');
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
    this.write(`${COLORS.bold}SESSION #${num}${COLORS.reset} of ${max}`);
    console.log(`${COLORS.bold}${bar}${COLORS.reset}`);
    console.log('');
  }

  banner(config: { workDir: string; maxSessions: number; gitCommit: boolean; verifyCommand: string | null; resumeFrom: number; notify: boolean }) {
    const C = COLORS;
    console.log('');
    console.log(`${C.bold}╔══════════════════════════════════════════════════════════╗${C.reset}`);
    console.log(`${C.bold}║  ${C.cyan}cleave${C.reset} ${C.dim}v${VERSION} (Agent SDK edition)${C.reset}${C.bold}                 ║${C.reset}`);
    console.log(`${C.bold}║  ${C.dim}Infinite context for Claude Code${C.reset}${C.bold}                        ║${C.reset}`);
    console.log(`${C.bold}╠══════════════════════════════════════════════════════════╣${C.reset}`);
    console.log(`${C.bold}║${C.reset}  Work dir:    ${C.blue}${path.basename(config.workDir)}${C.reset}`);
    console.log(`${C.bold}║${C.reset}  Max sessions:${C.blue} ${config.maxSessions}${C.reset}`);
    console.log(`${C.bold}║${C.reset}  Git commit:  ${C.blue} ${config.gitCommit}${C.reset}`);
    if (config.verifyCommand) {
      console.log(`${C.bold}║${C.reset}  Verify cmd:  ${C.blue} ${config.verifyCommand}${C.reset}`);
    }
    if (config.resumeFrom > 0) {
      console.log(`${C.bold}║${C.reset}  Resume from: ${C.yellow} session #${config.resumeFrom}${C.reset}`);
    }
    console.log(`${C.bold}║${C.reset}  Engine:      ${C.green} Agent SDK ✓${C.reset}`);
    console.log(`${C.bold}╚══════════════════════════════════════════════════════════╝${C.reset}`);
    console.log('');
  }
}

export const logger = new Logger();
