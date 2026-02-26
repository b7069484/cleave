/**
 * Main session relay loop — orchestrates the entire cleave lifecycle.
 *
 * For each session:
 *   1. Check completion
 *   2. Detect loops
 *   3. Compact knowledge
 *   4. Build prompt
 *   5. Run session (with Stop hook enforcement)
 *   6. Handle rate limits
 *   7. Run verification
 *   8. Archive state
 *   9. Git commit
 *   10. Pause
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
import { writeStatus, SessionStatus } from './state/status';
import { isComplete } from './detection/completion';
import { detectLoop } from './detection/loops';
import { runVerification } from './detection/verify';
import { runSession } from './session';
import { commitSession } from './integrations/git';
import { sendNotification } from './integrations/notify';
import { archiveSession } from './integrations/archive';
import { buildSessionPrompt, buildTaskPrompt } from './utils/prompt-builder';
import { FileLock } from './utils/lock';
import { logger } from './utils/logger';

/**
 * Sleep for the specified milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Handle rate limit: wait with countdown, then signal retry.
 */
async function handleRateLimit(
  resetAt: number | null,
  config: CleaveConfig
): Promise<void> {
  const now = Date.now();
  let waitMs = resetAt ? Math.max(resetAt - now + 30_000, 0) : 300_000; // Default 5 min

  // Cap at max wait
  waitMs = Math.min(waitMs, config.rateLimitMaxWait * 1000);

  const waitSec = Math.ceil(waitMs / 1000);
  logger.warn(`⏳ Rate limit detected. Waiting ${waitSec} seconds for reset...`);

  if (config.notify) {
    sendNotification('cleave', `Rate limit hit. Waiting ${waitSec}s for reset...`);
  }

  // Countdown (log every 30s)
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

/**
 * Run the main relay loop.
 */
export async function runRelayLoop(config: CleaveConfig): Promise<void> {
  const paths: RelayPaths = resolvePaths(config.workDir);

  // Initialize relay directory (skip for continuations — preserve existing state)
  if (!config.isContinuation) {
    initRelayDir(paths);
  } else {
    // Just ensure logs dir exists and mark active
    fs.mkdirSync(paths.logsDir, { recursive: true });
  }

  // Initialize logger
  logger.init(paths.relayDir, config.verbose);

  // Show banner
  logger.banner(config);
  logger.info(`cleave started (${config.tui ? 'TUI' : 'headless'} mode)`);
  logger.debug(`Work dir: ${config.workDir}`);
  logger.debug(`Initial prompt: ${config.initialPromptFile}`);

  // Acquire file lock
  const lock = new FileLock(paths.relayDir);
  if (!lock.acquire()) {
    logger.error(`Error: another cleave session is already running in ${config.workDir}`);
    process.exit(1);
  }

  // Ensure cleanup on exit
  const cleanup = () => {
    cleanupRelay(paths);
    lock.release();
  };
  process.on('exit', cleanup);
  process.on('SIGINT', () => { cleanup(); process.exit(130); });
  process.on('SIGTERM', () => { cleanup(); process.exit(143); });

  // ── Handle continuation mode ──
  let sessionCount: number;
  if (config.isContinuation && config.continuePrompt) {
    const prevCount = readSessionCount(paths);
    sessionCount = prevCount; // Will be incremented to prevCount+1 at top of loop
    logger.info(`Continuing from session #${prevCount} — injecting new task`);
    resetForContinuation(paths, config.continuePrompt, prevCount);
    logger.success(`State reset for continuation. PROGRESS.md → IN_PROGRESS`);
  } else {
    sessionCount = config.resumeFrom;
  }

  let consecutiveFailures = 0;

  while (sessionCount < config.maxSessions) {
    sessionCount++;

    // ── Check completion ──
    if (isComplete(paths.progressFile, config.completionMarker)) {
      logger.success(`✅ Task complete after session #${sessionCount - 1}!`);
      writeStatus(paths.statusFile, config, sessionCount - 1, 'complete', 'All done');
      if (config.notify) sendNotification('cleave ✅', `Task complete after ${sessionCount - 1} sessions!`);
      if (config.gitCommit) commitSession(config.workDir, sessionCount - 1);
      return;
    }

    // ── Loop detection ──
    const loopResult = detectLoop(paths.logsDir, paths.nextPromptFile, sessionCount);
    if (loopResult.isLoop) {
      consecutiveFailures++;
      if (consecutiveFailures >= 3) {
        logger.error(`❌ 3 consecutive loops detected. Stopping to prevent waste.`);
        writeStatus(paths.statusFile, config, sessionCount, 'stuck', 'Loop detected 3 times');
        if (config.notify) sendNotification('cleave ❌', 'Stopped: agent stuck in a loop.');
        process.exit(2);
      }
      logger.warn(`🔄 LOOP DETECTED: Session ${sessionCount} handoff is ${loopResult.similarity}% identical to previous`);
      logger.warn(`  Continuing despite loop (attempt ${consecutiveFailures} of 3)...`);
    } else {
      consecutiveFailures = 0;
    }

    // ── Compact knowledge ──
    const compactResult = compactKnowledge(paths.knowledgeFile, config.knowledgeKeepSessions);
    if (compactResult.pruned) {
      logger.debug(`  Knowledge compacted: ${compactResult.oldLines} → ${compactResult.newLines} lines`);
    }

    // ── Build prompt ──
    // TUI mode: task prompt only (handoff instructions go via --append-system-prompt)
    // Headless mode: full prompt with handoff instructions appended
    const prompt = config.tui
      ? buildTaskPrompt(config, sessionCount)
      : buildSessionPrompt(config, sessionCount);

    // ── Session header ──
    logger.session(sessionCount, config.maxSessions);
    writeStatus(paths.statusFile, config, sessionCount, 'running', `Session #${sessionCount} active`);

    // ── Touch session start marker ──
    // In TUI mode the SessionStart hook also touches this, but we do it here too
    // for consistency and in case the hook doesn't fire (e.g., hook installation issue)
    touchSessionStart(paths, sessionCount);

    // ── Run session ──
    const result = await runSession(prompt, config, paths, sessionCount);
    logger.debug(`Session #${sessionCount} exited (code: ${result.exitCode})`);

    // ── Handle rate limit ──
    if (result.rateLimited) {
      await handleRateLimit(result.rateLimitResetAt, config);
      logger.success('Rate limit cleared. Retrying session...');
      sessionCount--; // Retry same session
      continue;
    }

    // ── Run verification ──
    if (config.verifyCommand) {
      const verifyResult = runVerification(config.verifyCommand, config.workDir);
      if (verifyResult.passed) {
        logger.success('✅ Verification passed — task objectively complete!');
        writeStatus(paths.statusFile, config, sessionCount, 'verified_complete', 'Verification passed');
        if (config.notify) sendNotification('cleave ✅', `Task verified complete after ${sessionCount} sessions!`);
        if (config.gitCommit) commitSession(config.workDir, sessionCount);
        return;
      }
    }

    // ── Archive session files ──
    archiveSession(paths, sessionCount, prompt);

    // ── Git commit ──
    if (config.gitCommit) {
      commitSession(config.workDir, sessionCount);
    }

    // ── Report ──
    if (fs.existsSync(paths.nextPromptFile)) {
      const size = fs.statSync(paths.nextPromptFile).size;
      logger.success(`Handoff received (${size} bytes)`);
    } else {
      logger.warn('⚠️  No NEXT_PROMPT.md — will use initial prompt + PROGRESS.md');
    }

    if (fs.existsSync(paths.knowledgeFile)) {
      const lines = fs.readFileSync(paths.knowledgeFile, 'utf8').split('\n').length;
      logger.debug(`Knowledge base: ${lines} lines`);
    }

    // ── Check completion again ──
    if (isComplete(paths.progressFile, config.completionMarker)) {
      logger.success(`✅ Task complete after session #${sessionCount}!`);
      writeStatus(paths.statusFile, config, sessionCount, 'complete', 'All done');
      if (config.notify) sendNotification('cleave ✅', `Task complete after ${sessionCount} sessions!`);
      if (config.gitCommit) commitSession(config.workDir, sessionCount);
      return;
    }

    writeStatus(paths.statusFile, config, sessionCount, 'paused', 'Between sessions');

    // ── Pause ──
    if (sessionCount < config.maxSessions) {
      logger.debug(`Next session in ${config.pauseSeconds}s...`);
      await sleep(config.pauseSeconds * 1000);
    }
  }

  // Max sessions reached
  console.log('');
  logger.warn(`⚠️  Reached max sessions (${config.maxSessions}). Task not yet complete.`);
  logger.debug(`Resume: cleave --resume-from ${sessionCount} -m ${config.maxSessions + 10} ${config.initialPromptFile}`);
  writeStatus(paths.statusFile, config, sessionCount, 'max_sessions', 'Stopped at session limit');
  if (config.notify) sendNotification('cleave ⚠️', `Reached ${config.maxSessions} sessions. Task incomplete.`);
  process.exit(1);
}
