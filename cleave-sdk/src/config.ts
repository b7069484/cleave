/**
 * Cleave configuration types and defaults.
 */

export interface CleaveConfig {
  /** Path to the initial prompt file */
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

  /** Resume from a specific session number (skip earlier sessions) */
  resumeFrom: number;

  /** External verification command (exit 0 = done) */
  verifyCommand: string | null;

  /** Require permission prompts (no bypass) */
  safeMode: boolean;

  /** Detailed logging */
  verbose: boolean;

  /** Hint Claude to spawn subagents for heavy tasks */
  enableSubagents: boolean;

  /** Context % threshold to begin handoff (stop productive work) */
  handoffThreshold: number;

  /** Context % hard deadline (must finish handoff before this) */
  handoffDeadline: number;

  /** Rolling window: keep last N session entries in knowledge log */
  knowledgeKeepSessions: number;

  /** Maximum seconds to wait for rate limit reset */
  rateLimitMaxWait: number;
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
  safeMode: false,
  verbose: false,
  enableSubagents: false,
  handoffThreshold: 60,
  handoffDeadline: 70,
  knowledgeKeepSessions: 5,
  rateLimitMaxWait: 18000,
};

export const VERSION = '4.0.0';
