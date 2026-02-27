/**
 * Cleave configuration types, defaults, and validation.
 */

// ── Pipeline types ──

export interface StageConfig {
  name: string;
  prompt: string;
  maxSessions: number;
  completion: string;
  requires?: string[];
  verify?: string;
  onFail?: 'stop' | 'retry' | 'skip';
  retryMax?: number;
  shareKnowledge?: boolean;
}

export interface PipelineConfig {
  name: string;
  workDir?: string;
  stages: StageConfig[];
}

// ── Main config ──

export interface CleaveConfig {
  /** Path to the initial prompt file (or YAML for pipeline mode) */
  initialPromptFile: string;

  /** Maximum number of sessions before stopping */
  maxSessions: number;

  /** Working directory for Claude Code */
  workDir: string;

  /** Seconds to pause between sessions */
  pauseSeconds: number;

  /** String in PROGRESS.md that signals task completion */
  completionMarker: string;

  /** Auto-commit to git after each session */
  gitCommit: boolean;

  /** Send desktop notifications */
  notify: boolean;

  /** Resume from a specific session number */
  resumeFrom: number;

  /** External verification command (exit 0 = done) */
  verifyCommand: string | null;

  /** Timeout in seconds for verification command */
  verifyTimeout: number;

  /** Require permission prompts (no bypass) */
  safeMode: boolean;

  /** Detailed logging */
  verbose: boolean;

  /** Context % threshold to begin handoff */
  handoffThreshold: number;

  /** Context % hard deadline for handoff */
  handoffDeadline: number;

  /** Rolling window: keep last N session entries in knowledge log */
  knowledgeKeepSessions: number;

  /** Maximum seconds to wait for rate limit reset */
  rateLimitMaxWait: number;

  /** Show the full Claude Code TUI (default: true). False = headless query() mode. */
  tui: boolean;

  /** Whether this is a continuation of a previously completed relay */
  isContinuation: boolean;

  /** The continuation prompt text (inline or from file) */
  continuePrompt: string | null;

  /** Whether this is a pipeline run */
  isPipeline: boolean;

  /** Pipeline configuration (null if not a pipeline) */
  pipelineConfig: PipelineConfig | null;

  /** Maximum seconds for a single session before forced SIGTERM (0 = no limit) */
  sessionTimeout: number;

  /** Resume pipeline from this stage */
  resumeStage: string | null;

  /** Skip this stage in the pipeline */
  skipStage: string | null;
}

export const DEFAULT_CONFIG: Omit<CleaveConfig, 'initialPromptFile'> = {
  maxSessions: 10,
  workDir: '.',
  pauseSeconds: 10,
  completionMarker: 'ALL_COMPLETE',
  gitCommit: false,
  notify: true,
  resumeFrom: 0,
  verifyCommand: null,
  verifyTimeout: 120,
  safeMode: false,
  verbose: false,
  handoffThreshold: 60,
  handoffDeadline: 70,
  knowledgeKeepSessions: 5,
  rateLimitMaxWait: 18000,
  tui: true,
  sessionTimeout: 1800,   // 30 minutes
  isContinuation: false,
  continuePrompt: null,
  isPipeline: false,
  pipelineConfig: null,
  resumeStage: null,
  skipStage: null,
};

export const VERSION = '5.2.0';

/**
 * Validate config values at startup. Throws on invalid values.
 */
export function validateConfig(config: CleaveConfig): void {
  if (config.maxSessions < 1 || config.maxSessions > 10000) {
    throw new Error('maxSessions must be between 1 and 10,000');
  }
  if (config.pauseSeconds < 0 || config.pauseSeconds > 3600) {
    throw new Error('pauseSeconds must be between 0 and 3,600 (1 hour)');
  }
  if (config.handoffDeadline <= config.handoffThreshold) {
    throw new Error(`handoffDeadline (${config.handoffDeadline}) must be greater than handoffThreshold (${config.handoffThreshold})`);
  }
  if (config.knowledgeKeepSessions < 1) {
    throw new Error('knowledgeKeepSessions must be at least 1');
  }
  if (config.verifyTimeout < 1 || config.verifyTimeout > 600) {
    throw new Error('verifyTimeout must be between 1 and 600 seconds');
  }
  if (config.resumeFrom < 0) {
    throw new Error('resumeFrom must be non-negative');
  }
  if (config.resumeFrom >= config.maxSessions) {
    throw new Error(`resumeFrom (${config.resumeFrom}) must be less than maxSessions (${config.maxSessions})`);
  }
  if (config.sessionTimeout < 0 || config.sessionTimeout > 86400) {
    throw new Error('sessionTimeout must be between 0 and 86400 (24 hours)');
  }
}
