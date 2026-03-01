/**
 * Main session relay loop — orchestrates the entire cleave lifecycle.
 * Extracted: runRelayCore() is reusable by pipeline-loop for per-stage relays.
 */

import * as fs from 'fs';
import { CleaveConfig } from './config';
import {
  RelayPaths,
  resolvePaths,
  initRelayDir,
  touchSessionStart,
  cleanupRelay,
  resetForContinuation,
  readSessionCount,
} from './state/files';
import { compactKnowledge } from './state/knowledge';
import { writeStatus } from './state/status';
import { isComplete, detectLoop, runVerification } from './detection';
import { runSession } from './session';
import { commitSession } from './integrations/git';
import { sendNotification } from './integrations/notify';
import { archiveSession } from './integrations/archive';
import { buildSessionPrompt, buildTaskPrompt } from './utils/prompt-builder';
import { FileLock } from './utils/lock';
import { logger } from './utils/logger';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function handleRateLimit(resetAt: number | null, config: CleaveConfig): Promise<void> {
  const now = Date.now();
  let waitMs = resetAt ? Math.max(resetAt - now + 30_000, 0) : 300_000;
  waitMs = Math.min(waitMs, config.rateLimitMaxWait * 1000);
  const waitSec = Math.ceil(waitMs / 1000);
  logger.warn(`⏳ Rate limit detected. Waiting ${waitSec} seconds for reset...`);
  if (config.notify) sendNotification('cleave', `Rate limit hit. Waiting ${waitSec}s for reset...`);

  let remaining = waitMs;
  while (remaining > 0) {
    const mins = Math.floor(remaining / 60_000);
    const secs = Math.floor((remaining % 60_000) / 1000);
    process.stdout.write(`\r  Rate limit reset in: ${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}  `);
    const tick = Math.min(10_000, remaining);
    await sleep(tick);
    remaining -= tick;
  }
  process.stdout.write('\r  Rate limit should be lifted.                    \n');
}

// ── Reusable Core ──

export interface RelayCoreOptions {
  paths: RelayPaths;
  config: CleaveConfig;
  startSession: number;
  maxSessions: number;
  completionMarker: string;
  verifyCommand: string | null;
  verifyTimeout: number;
  buildPrompt?: (config: CleaveConfig, sessionNum: number) => string;
  label?: string;
}

export interface RelayCoreResult {
  completed: boolean;
  maxSessionsReached: boolean;
  sessionsRun: number;
  lastSession: number;
}

/**
 * Reusable core relay loop. Runs sessions until completion, max sessions, or failure.
 * Does NOT handle: init, lock acquisition, cleanup, continuation mode, banner.
 */
export async function runRelayCore(opts: RelayCoreOptions): Promise<RelayCoreResult> {
  const { paths, config, completionMarker, verifyCommand, verifyTimeout } = opts;
  const label = opts.label ? `[${opts.label}] ` : '';

  let sessionCount = opts.startSession;
  let consecutiveLoops = 0;
  let consecutiveCrashes = 0;

  while (sessionCount < opts.maxSessions) {
    sessionCount++;

    // ── Check completion ──
    if (isComplete(paths.progressFile, completionMarker)) {
      logger.success(`${label}✅ Task complete after session #${sessionCount - 1}!`);
      writeStatus(paths.statusFile, config, sessionCount - 1, 'complete', 'All done');
      if (config.notify) sendNotification('cleave ✅', `${label}Complete after ${sessionCount - 1} sessions!`);
      if (config.gitCommit) commitSession(config.workDir, sessionCount - 1);
      return { completed: true, maxSessionsReached: false, sessionsRun: sessionCount - opts.startSession, lastSession: sessionCount - 1 };
    }

    // ── Loop detection ──
    const loopResult = detectLoop(paths.logsDir, paths.nextPromptFile, sessionCount);
    if (loopResult.isLoop) {
      consecutiveLoops++;
      if (consecutiveLoops >= 3) {
        logger.error(`${label}❌ 3 consecutive loops detected. Stopping.`);
        writeStatus(paths.statusFile, config, sessionCount, 'stuck', 'Loop detected 3 times');
        if (config.notify) sendNotification('cleave ❌', `${label}Stuck in a loop.`);
        return { completed: false, maxSessionsReached: false, sessionsRun: sessionCount - opts.startSession, lastSession: sessionCount };
      }
      logger.warn(`${label}🔄 Loop detected: ${loopResult.similarity}% similar (attempt ${consecutiveLoops}/3)`);
    } else {
      consecutiveLoops = 0;
    }

    // ── Compact knowledge ──
    try {
      const compactResult = compactKnowledge(paths.knowledgeFile, config.knowledgeKeepSessions);
      if (compactResult.pruned) {
        logger.debug(`Knowledge compacted: ${compactResult.oldLines} → ${compactResult.newLines} lines`);
      }
    } catch (err: any) {
      logger.warn(`${label}⚠️  Knowledge compaction failed (non-fatal): ${err.message}`);
    }

    // ── Build prompt ──
    let prompt: string;
    try {
      prompt = opts.buildPrompt
        ? opts.buildPrompt(config, sessionCount)
        : (config.sessionMode === 'headless')
          ? buildSessionPrompt(config, sessionCount)
          : buildTaskPrompt(config, sessionCount);
    } catch (err: any) {
      logger.error(`${label}Prompt build failed for session #${sessionCount}: ${err.message}`);
      consecutiveCrashes++;
      if (consecutiveCrashes >= 3) {
        logger.error(`${label}❌ 3 consecutive failures (prompt build). Stopping.`);
        return { completed: false, maxSessionsReached: false, sessionsRun: sessionCount - opts.startSession, lastSession: sessionCount };
      }
      continue;
    }

    // ── Session header ──
    logger.session(sessionCount, opts.maxSessions);
    writeStatus(paths.statusFile, config, sessionCount, 'running', `${label}Session #${sessionCount} active`);
    touchSessionStart(paths, sessionCount);

    // ── Run session ──
    let result;
    try {
      result = await runSession(prompt, config, paths, sessionCount);
    } catch (err: any) {
      logger.error(`${label}Session #${sessionCount} error: ${err.message}`);
      consecutiveCrashes++;
      if (consecutiveCrashes >= 3) {
        logger.error(`${label}❌ 3 consecutive failures. Stopping.`);
        writeStatus(paths.statusFile, config, sessionCount, 'error', `Session error: ${err.message}`);
        if (config.notify) sendNotification('cleave ❌', `${label}3 consecutive failures.`);
        return { completed: false, maxSessionsReached: false, sessionsRun: sessionCount - opts.startSession, lastSession: sessionCount };
      }
      continue;
    }
    logger.debug(`${label}Session #${sessionCount} exited (code: ${result.exitCode})`);

    // ── Handle rate limit ──
    if (result.rateLimited) {
      await handleRateLimit(result.rateLimitResetAt, config);
      logger.success('Rate limit cleared. Retrying session...');
      sessionCount--;
      consecutiveCrashes = 0;
      continue;
    }

    // ── Handle crashes ──
    if (result.exitCode !== 0) {
      consecutiveCrashes++;
      if (consecutiveCrashes >= 3) {
        logger.error(`${label}❌ 3 consecutive crashes (exit ${result.exitCode}). Stopping.`);
        writeStatus(paths.statusFile, config, sessionCount, 'error', `Crashed 3 times`);
        if (config.notify) sendNotification('cleave ❌', `${label}3 consecutive crashes.`);
        return { completed: false, maxSessionsReached: false, sessionsRun: sessionCount - opts.startSession, lastSession: sessionCount };
      }
      logger.warn(`${label}⚠️  Session #${sessionCount} exit code ${result.exitCode} (crash ${consecutiveCrashes}/3)`);
    } else {
      consecutiveCrashes = 0;
    }

    // ── Run verification ──
    if (verifyCommand) {
      const verifyResult = runVerification(verifyCommand, config.workDir, verifyTimeout);
      if (verifyResult.passed) {
        logger.success(`${label}✅ Verification passed!`);
        writeStatus(paths.statusFile, config, sessionCount, 'verified_complete', 'Verification passed');
        if (config.notify) sendNotification('cleave ✅', `${label}Verified complete!`);
        if (config.gitCommit) commitSession(config.workDir, sessionCount);
        return { completed: true, maxSessionsReached: false, sessionsRun: sessionCount - opts.startSession, lastSession: sessionCount };
      }
    }

    // ── Archive + git (guarded — must not crash the relay) ──
    try {
      archiveSession(paths, sessionCount, prompt);
    } catch (err: any) {
      logger.warn(`${label}⚠️  Archive failed (non-fatal): ${err.message}`);
    }
    if (config.gitCommit) {
      try {
        commitSession(config.workDir, sessionCount);
      } catch (err: any) {
        logger.warn(`${label}⚠️  Git commit failed (non-fatal): ${err.message}`);
      }
    }

    // ── Report ──
    if (fs.existsSync(paths.nextPromptFile)) {
      logger.success(`Handoff received (${fs.statSync(paths.nextPromptFile).size} bytes)`);
    } else {
      logger.warn('⚠️  No NEXT_PROMPT.md — will use initial prompt + PROGRESS.md');
    }

    // ── Check completion again ──
    if (isComplete(paths.progressFile, completionMarker)) {
      logger.success(`${label}✅ Task complete after session #${sessionCount}!`);
      writeStatus(paths.statusFile, config, sessionCount, 'complete', 'All done');
      if (config.notify) sendNotification('cleave ✅', `${label}Complete after ${sessionCount} sessions!`);
      if (config.gitCommit) commitSession(config.workDir, sessionCount);
      return { completed: true, maxSessionsReached: false, sessionsRun: sessionCount - opts.startSession, lastSession: sessionCount };
    }

    writeStatus(paths.statusFile, config, sessionCount, 'paused', 'Between sessions');

    if (sessionCount < opts.maxSessions) {
      logger.debug(`Next session in ${config.pauseSeconds}s...`);
      await sleep(config.pauseSeconds * 1000);
    }
  }

  logger.warn(`${label}⚠️  Reached max sessions (${opts.maxSessions}).`);
  return { completed: false, maxSessionsReached: true, sessionsRun: sessionCount - opts.startSession, lastSession: sessionCount };
}

// ── Standard Entry Point ──

/**
 * Run the main relay loop (entry point for `cleave run` and `cleave continue`).
 */
export async function runRelayLoop(config: CleaveConfig): Promise<void> {
  const paths: RelayPaths = resolvePaths(config.workDir);

  // Initialize relay directory
  if (!config.isContinuation) {
    initRelayDir(paths);
  } else {
    fs.mkdirSync(paths.logsDir, { recursive: true });
  }

  logger.init(paths.relayDir, config.verbose);
  logger.banner(config);
  logger.info(`cleave started (${config.sessionMode} mode)`);
  logger.debug(`Work dir: ${config.workDir}`);

  // Acquire file lock
  const lock = new FileLock(paths.relayDir);
  if (!lock.acquire()) {
    logger.error('Error: Another cleave session is already running in this directory.');
    logger.error('  Only one relay can run per working directory at a time.');
    logger.error('  If the previous session crashed, delete .cleave/.lock to recover.');
    process.exit(1);
  }

  if (fs.existsSync(paths.activeRelayMarker)) {
    logger.warn('Found stale .active_relay from previous crash — will be overwritten');
  }

  // Cleanup on exit — prevent double-cleanup with flag
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    cleanupRelay(paths);
    lock.release();
  };
  process.on('exit', cleanup);
  process.on('SIGINT', () => { cleanup(); process.exit(130); });
  process.on('SIGTERM', () => { cleanup(); process.exit(143); });

  // Handle continuation mode
  let sessionCount: number;
  if (config.isContinuation && config.continuePrompt) {
    const prevCount = readSessionCount(paths);
    sessionCount = prevCount;
    logger.info(`Continuing from session #${prevCount} — injecting new task`);
    resetForContinuation(paths, config.continuePrompt, prevCount);
    logger.success(`State reset for continuation.`);
  } else {
    sessionCount = config.resumeFrom;
  }

  // Run core relay loop
  const result = await runRelayCore({
    paths,
    config,
    startSession: sessionCount,
    maxSessions: config.maxSessions,
    completionMarker: config.completionMarker,
    verifyCommand: config.verifyCommand,
    verifyTimeout: config.verifyTimeout,
  });

  if (result.completed) return;

  if (result.maxSessionsReached) {
    logger.debug(`Resume: cleave --resume-from ${result.lastSession} -m ${config.maxSessions + 10} ${config.initialPromptFile}`);
    writeStatus(paths.statusFile, config, result.lastSession, 'max_sessions', 'Stopped at session limit');
    if (config.notify) sendNotification('cleave ⚠️', `Reached ${config.maxSessions} sessions. Task incomplete.`);
    process.exit(1);
  }

  process.exit(2);
}
