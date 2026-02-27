/**
 * CLI argument parsing and validation.
 * Supports three subcommands: run (default), continue, and pipeline.
 */

import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import { CleaveConfig, DEFAULT_CONFIG, VERSION, validateConfig } from './config';
import { loadPipelineConfig } from './pipeline-config';

/**
 * Add shared options to a command (used by run, continue, and pipeline).
 */
function addSharedOptions(cmd: Command): Command {
  return cmd
    .option('-m, --max-sessions <n>', 'Maximum sessions (1-10000)', String(DEFAULT_CONFIG.maxSessions))
    .option('-d, --work-dir <dir>', 'Working directory', DEFAULT_CONFIG.workDir)
    .option('-p, --pause <seconds>', 'Seconds between sessions', String(DEFAULT_CONFIG.pauseSeconds))
    .option('-c, --completion-marker <string>', 'Completion signal string', DEFAULT_CONFIG.completionMarker)
    .option('-g, --git-commit', 'Auto-commit after each session', DEFAULT_CONFIG.gitCommit)
    .option('--no-notify', 'Disable desktop notifications')
    .option('--verify <command>', 'Verification command (exit 0 = done)')
    .option('--verify-timeout <seconds>', 'Timeout for verification command', String(DEFAULT_CONFIG.verifyTimeout))
    .option('--safe-mode', 'Require permission prompts', DEFAULT_CONFIG.safeMode)
    .option('-v, --verbose', 'Detailed logging', DEFAULT_CONFIG.verbose)
    .option('--no-tui', 'Headless mode — use Agent SDK query() instead of TUI')
    .option('--session-timeout <seconds>', 'Max seconds per session, 0=unlimited (default: 1800)', String(DEFAULT_CONFIG.sessionTimeout));
}

/**
 * Validate shared options and build base config.
 */
function validateAndBuildConfig(opts: any, program: Command): Partial<CleaveConfig> {
  const maxSessions = parseInt(opts.maxSessions, 10);
  if (isNaN(maxSessions) || maxSessions < 1 || maxSessions > 10000) {
    program.error('Error: --max-sessions must be between 1 and 10,000');
  }

  const pauseSeconds = parseInt(opts.pause, 10);
  if (isNaN(pauseSeconds) || pauseSeconds < 0) {
    program.error('Error: --pause must be a non-negative integer');
  }

  const verifyTimeout = parseInt(opts.verifyTimeout || String(DEFAULT_CONFIG.verifyTimeout), 10);
  if (isNaN(verifyTimeout) || verifyTimeout < 1 || verifyTimeout > 600) {
    program.error('Error: --verify-timeout must be between 1 and 600');
  }

  const sessionTimeout = parseInt(opts.sessionTimeout || String(DEFAULT_CONFIG.sessionTimeout), 10);
  if (isNaN(sessionTimeout) || sessionTimeout < 0 || sessionTimeout > 86400) {
    program.error('Error: --session-timeout must be between 0 and 86400');
  }

  const workDir = path.resolve(opts.workDir);
  if (!fs.existsSync(workDir)) {
    program.error(`Error: work directory not found: ${workDir}`);
  }

  return {
    maxSessions: parseInt(process.env.CLEAVE_MAX_SESSIONS || '', 10) || maxSessions,
    workDir,
    pauseSeconds: parseInt(process.env.CLEAVE_PAUSE || '', 10) || pauseSeconds,
    completionMarker: process.env.CLEAVE_COMPLETION_MARKER || opts.completionMarker,
    gitCommit: opts.gitCommit ?? DEFAULT_CONFIG.gitCommit,
    notify: opts.notify ?? DEFAULT_CONFIG.notify,
    verifyCommand: opts.verify || null,
    verifyTimeout,
    safeMode: opts.safeMode ?? DEFAULT_CONFIG.safeMode,
    verbose: opts.verbose ?? DEFAULT_CONFIG.verbose,
    handoffThreshold: DEFAULT_CONFIG.handoffThreshold,
    handoffDeadline: DEFAULT_CONFIG.handoffDeadline,
    knowledgeKeepSessions: DEFAULT_CONFIG.knowledgeKeepSessions,
    rateLimitMaxWait: DEFAULT_CONFIG.rateLimitMaxWait,
    tui: opts.tui ?? DEFAULT_CONFIG.tui,
    sessionTimeout,
  };
}

export function parseArgs(argv: string[]): CleaveConfig {
  const program = new Command();
  let result: CleaveConfig | null = null;

  program
    .name('cleave')
    .version(VERSION, '-V, --version', 'Show version')
    .description('Infinite context for Claude Code — chain sessions together automatically');

  // ── "run" subcommand (default behavior) ──
  const runCmd = program
    .command('run <prompt-file>', { isDefault: true })
    .description('Start a new relay from a prompt file');

  addSharedOptions(runCmd)
    .option('-r, --resume-from <n>', 'Resume from session N', String(DEFAULT_CONFIG.resumeFrom))
    .action((_promptFile: string, _opts: any, cmd: Command) => {
      result = parseRunCommand(cmd, program);
    });

  // ── "continue" subcommand ──
  const continueCmd = program
    .command('continue [prompt]')
    .description('Continue a completed relay with a new prompt');

  addSharedOptions(continueCmd)
    .option('-f, --file <path>', 'Read continuation prompt from a file instead of inline')
    .action((_prompt: string, _opts: any, cmd: Command) => {
      result = parseContinueCommand(cmd, program);
    });

  // ── "pipeline" subcommand ──
  const pipelineCmd = program
    .command('pipeline <config-yaml>')
    .description('Run a multi-stage pipeline from a YAML config');

  addSharedOptions(pipelineCmd)
    .option('--resume-stage <name>', 'Resume pipeline from a specific stage')
    .option('--skip-stage <name>', 'Skip a specific stage in the pipeline')
    .action((_configYaml: string, _opts: any, cmd: Command) => {
      result = parsePipelineCommand(cmd, program);
    });

  // Parse
  program.parse(argv);

  if (!result) {
    program.error('Error: no command matched. Run "cleave --help" for usage.');
  }

  return result!;
}

function parseRunCommand(cmd: Command, program: Command): CleaveConfig {
  const opts = cmd.opts();
  const promptFile = cmd.args[0];

  if (!promptFile) {
    program.error('Error: no initial prompt file specified.');
  }

  const resolvedPromptFile = path.resolve(promptFile);
  if (!fs.existsSync(resolvedPromptFile)) {
    program.error(`Error: prompt file not found: ${resolvedPromptFile}`);
  }

  const resumeFrom = parseInt(opts.resumeFrom || '0', 10);
  if (isNaN(resumeFrom) || resumeFrom < 0) {
    program.error('Error: --resume-from must be a non-negative integer');
  }

  const base = validateAndBuildConfig(opts, program);

  const config = {
    ...DEFAULT_CONFIG,
    ...base,
    initialPromptFile: resolvedPromptFile,
    resumeFrom,
    isContinuation: false,
    continuePrompt: null,
    isPipeline: false,
    pipelineConfig: null,
    resumeStage: null,
    skipStage: null,
  } as CleaveConfig;

  validateConfig(config);
  return config;
}

function parseContinueCommand(cmd: Command, program: Command): CleaveConfig {
  const opts = cmd.opts();
  const inlinePrompt = cmd.args[0] || null;
  const promptFile = opts.file || null;

  // Must provide either inline prompt or --file, not both
  if (!inlinePrompt && !promptFile) {
    program.error('Error: provide a prompt string or --file <path>.\n  Usage: cleave continue "your prompt here"\n         cleave continue -f prompt.md');
  }
  if (inlinePrompt && promptFile) {
    program.error('Error: provide either an inline prompt or --file, not both.');
  }

  // Resolve continuation prompt
  let continuePrompt: string;
  if (promptFile) {
    const resolvedFile = path.resolve(promptFile);
    if (!fs.existsSync(resolvedFile)) {
      program.error(`Error: prompt file not found: ${resolvedFile}`);
    }
    continuePrompt = fs.readFileSync(resolvedFile, 'utf8');
  } else {
    continuePrompt = inlinePrompt!;
  }

  const base = validateAndBuildConfig(opts, program);

  // Check that .cleave/ exists in the work directory
  const relayDir = path.join(base.workDir!, '.cleave');
  if (!fs.existsSync(relayDir)) {
    program.error(`Error: no .cleave/ directory found in ${base.workDir}.\n  Run "cleave run <prompt>" first to initialize a relay.`);
  }

  // Use a dummy initial prompt file (continuation reads from NEXT_PROMPT.md)
  const tempPromptFile = path.join(relayDir, '.continuation_prompt.md');
  fs.writeFileSync(tempPromptFile, continuePrompt);

  const config = {
    ...DEFAULT_CONFIG,
    ...base,
    initialPromptFile: tempPromptFile,
    resumeFrom: 0,
    isContinuation: true,
    continuePrompt,
    isPipeline: false,
    pipelineConfig: null,
    resumeStage: null,
    skipStage: null,
  } as CleaveConfig;

  validateConfig(config);
  return config;
}

function parsePipelineCommand(cmd: Command, program: Command): CleaveConfig {
  const opts = cmd.opts();
  const configYaml = cmd.args[0];

  if (!configYaml) {
    program.error('Error: no pipeline config YAML file specified.');
  }

  const resolvedYaml = path.resolve(configYaml);
  if (!fs.existsSync(resolvedYaml)) {
    program.error(`Error: pipeline config not found: ${resolvedYaml}`);
  }

  const base = validateAndBuildConfig(opts, program);

  // Load and validate pipeline config
  let pipelineConfig;
  try {
    pipelineConfig = loadPipelineConfig(resolvedYaml, base.workDir);
  } catch (err: any) {
    program.error(`Pipeline config error: ${err.message}`);
  }

  const config = {
    ...DEFAULT_CONFIG,
    ...base,
    initialPromptFile: resolvedYaml,
    resumeFrom: 0,
    isContinuation: false,
    continuePrompt: null,
    isPipeline: true,
    pipelineConfig,
    resumeStage: opts.resumeStage || null,
    skipStage: opts.skipStage || null,
  } as CleaveConfig;

  // Don't validate resumeFrom < maxSessions for pipeline mode
  // (pipeline manages its own max sessions per stage)
  return config;
}
