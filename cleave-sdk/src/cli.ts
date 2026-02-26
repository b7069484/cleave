/**
 * CLI argument parsing and validation.
 */

import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import { CleaveConfig, DEFAULT_CONFIG, VERSION } from './config';

export function parseArgs(argv: string[]): CleaveConfig {
  const program = new Command();

  program
    .name('cleave')
    .version(VERSION, '-V, --version', 'Show version')
    .description('Infinite context for Claude Code — chain sessions together automatically')
    .argument('<prompt-file>', 'Path to the initial prompt file')
    .option('-m, --max-sessions <n>', 'Maximum sessions (1-1000)', String(DEFAULT_CONFIG.maxSessions))
    .option('-d, --work-dir <dir>', 'Working directory', DEFAULT_CONFIG.workDir)
    .option('-p, --pause <seconds>', 'Seconds between sessions', String(DEFAULT_CONFIG.pauseSeconds))
    .option('-c, --completion-marker <string>', 'Completion signal string', DEFAULT_CONFIG.completionMarker)
    .option('-g, --git-commit', 'Auto-commit after each session', DEFAULT_CONFIG.gitCommit)
    .option('--no-notify', 'Disable desktop notifications')
    .option('-r, --resume-from <n>', 'Resume from session N', String(DEFAULT_CONFIG.resumeFrom))
    .option('--verify <command>', 'Verification command (exit 0 = done)')
    .option('--safe-mode', 'Require permission prompts', DEFAULT_CONFIG.safeMode)
    .option('-v, --verbose', 'Detailed logging', DEFAULT_CONFIG.verbose)
    .option('--subagents', 'Hint Claude to spawn subagents', DEFAULT_CONFIG.enableSubagents)
    .option('--no-tui', 'Headless mode — use Agent SDK query() instead of TUI');

  program.parse(argv);
  const opts = program.opts();
  const promptFile = program.args[0];

  // Validate prompt file
  if (!promptFile) {
    program.error('Error: no initial prompt file specified.');
  }

  const resolvedPromptFile = path.resolve(promptFile);
  if (!fs.existsSync(resolvedPromptFile)) {
    program.error(`Error: prompt file not found: ${resolvedPromptFile}`);
  }

  // Validate max-sessions
  const maxSessions = parseInt(opts.maxSessions, 10);
  if (isNaN(maxSessions) || maxSessions < 1 || maxSessions > 1000) {
    program.error('Error: --max-sessions must be between 1 and 1000');
  }

  // Validate pause
  const pauseSeconds = parseInt(opts.pause, 10);
  if (isNaN(pauseSeconds) || pauseSeconds < 0) {
    program.error('Error: --pause must be a non-negative integer');
  }

  // Validate resume-from
  const resumeFrom = parseInt(opts.resumeFrom, 10);
  if (isNaN(resumeFrom) || resumeFrom < 0) {
    program.error('Error: --resume-from must be a non-negative integer');
  }

  // Resolve work directory
  const workDir = path.resolve(opts.workDir);
  if (!fs.existsSync(workDir)) {
    program.error(`Error: work directory not found: ${workDir}`);
  }

  // Apply environment variable overrides
  const config: CleaveConfig = {
    initialPromptFile: resolvedPromptFile,
    maxSessions: parseInt(process.env.CLEAVE_MAX_SESSIONS || '', 10) || maxSessions,
    workDir,
    pauseSeconds: parseInt(process.env.CLEAVE_PAUSE || '', 10) || pauseSeconds,
    completionMarker: process.env.CLEAVE_COMPLETION_MARKER || opts.completionMarker,
    gitCommit: opts.gitCommit ?? DEFAULT_CONFIG.gitCommit,
    notify: opts.notify ?? DEFAULT_CONFIG.notify,
    resumeFrom,
    verifyCommand: opts.verify || null,
    safeMode: opts.safeMode ?? DEFAULT_CONFIG.safeMode,
    verbose: opts.verbose ?? DEFAULT_CONFIG.verbose,
    enableSubagents: opts.subagents ?? DEFAULT_CONFIG.enableSubagents,
    handoffThreshold: DEFAULT_CONFIG.handoffThreshold,
    handoffDeadline: DEFAULT_CONFIG.handoffDeadline,
    knowledgeKeepSessions: DEFAULT_CONFIG.knowledgeKeepSessions,
    rateLimitMaxWait: DEFAULT_CONFIG.rateLimitMaxWait,
    tui: opts.tui ?? DEFAULT_CONFIG.tui,
  };

  return config;
}
