/**
 * Pipeline orchestrator — runs multiple stages sequentially,
 * each stage being its own Cleave relay with isolated state.
 *
 * Handles: stage ordering, dependency checking, retries, skip,
 * resume-from-stage, knowledge promotion, and pipeline state tracking.
 */

import * as fs from 'fs';
import * as path from 'path';
import { CleaveConfig, PipelineConfig, StageConfig } from './config';
import {
  RelayPaths,
  resolveStagePaths,
  initPipelineDir,
  initRelayDir,
  savePipelineState,
  loadPipelineState,
  promoteToSharedKnowledge,
  resetStageForRetry,
  readSessionCount,
  PipelineState,
} from './state/files';
import { runRelayCore, RelayCoreResult } from './relay-loop';
import { buildStageHandoffInstructions } from './utils/prompt-builder';
import { runVerification } from './detection';
import { sendNotification } from './integrations/notify';
import { FileLock } from './utils/lock';
import { logger } from './utils/logger';

/**
 * Run the full pipeline.
 */
export async function runPipelineLoop(config: CleaveConfig): Promise<void> {
  const pipeline = config.pipelineConfig;
  if (!pipeline) {
    throw new Error('No pipeline configuration provided');
  }

  const workDir = config.workDir;
  const pipelineDir = path.join(workDir, '.cleave');

  // ── Initialize pipeline directory ──
  let state: PipelineState;
  const existingState = loadPipelineState(workDir);

  if (existingState && config.resumeStage) {
    // Resume from existing pipeline state
    state = existingState;
    logger.info(`Resuming pipeline "${pipeline.name}" from stage: ${config.resumeStage}`);
  } else {
    // Fresh start
    state = initPipelineDir(workDir, pipeline.stages.map(s => s.name));
    state.name = pipeline.name;
    savePipelineState(workDir, state);
    logger.info(`Starting pipeline "${pipeline.name}" with ${pipeline.stages.length} stages`);
  }

  // Copy pipeline config for reference
  const configCopyPath = path.join(pipelineDir, 'pipeline.yaml');
  if (config.initialPromptFile && fs.existsSync(config.initialPromptFile)) {
    fs.copyFileSync(config.initialPromptFile, configCopyPath);
  }

  // Initialize logger
  logger.init(pipelineDir, config.verbose);

  // Acquire file lock
  const lock = new FileLock(pipelineDir);
  if (!lock.acquire()) {
    logger.error(`Error: another cleave session is already running in ${workDir}`);
    process.exit(1);
  }

  // Write active pipeline marker (so the stop hook detects pipeline mode)
  fs.writeFileSync(path.join(pipelineDir, '.active_pipeline'), '1');

  // Cleanup on exit — prevent double-cleanup with flag
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    lock.release();
    try {
      const marker = path.join(pipelineDir, '.active_pipeline');
      if (fs.existsSync(marker)) fs.unlinkSync(marker);
    } catch { /* best effort */ }
  };
  process.on('exit', cleanup);
  process.on('SIGINT', () => { cleanup(); process.exit(130); });
  process.on('SIGTERM', () => { cleanup(); process.exit(143); });

  // ── Pipeline banner ──
  console.log('');
  console.log('  ╔════════════════════════════════════════════════╗');
  console.log(`  ║  CLEAVE PIPELINE: ${pipeline.name.padEnd(29)}║`);
  console.log('  ╠════════════════════════════════════════════════╣');
  for (let i = 0; i < pipeline.stages.length; i++) {
    const s = pipeline.stages[i];
    const status = state.stages[s.name] || 'pending';
    const icon = status === 'complete' ? '✅' : status === 'skipped' ? '⏭️ ' : status === 'failed' ? '❌' : '⬜';
    console.log(`  ║  ${icon} Stage ${i + 1}: ${s.name.padEnd(34)}║`);
  }
  console.log('  ╚════════════════════════════════════════════════╝');
  console.log('');

  // ── Determine starting stage ──
  let startIdx = 0;
  if (config.resumeStage) {
    const idx = pipeline.stages.findIndex(s => s.name === config.resumeStage);
    if (idx === -1) {
      logger.error(`Resume stage "${config.resumeStage}" not found in pipeline`);
      process.exit(1);
    }
    startIdx = idx;
  }

  // ── Run stages sequentially ──
  for (let i = startIdx; i < pipeline.stages.length; i++) {
    const stage = pipeline.stages[i];
    const stageNum = i + 1;
    const totalStages = pipeline.stages.length;

    // ── Skip check ──
    if (config.skipStage === stage.name) {
      logger.info(`⏭️  Skipping stage "${stage.name}" (--skip-stage)`);
      state.stages[stage.name] = 'skipped';
      savePipelineState(workDir, state);
      continue;
    }

    // ── Skip already-completed stages (when resuming) ──
    if (state.stages[stage.name] === 'complete') {
      logger.info(`✅ Stage "${stage.name}" already complete — skipping`);
      continue;
    }

    // ── Check dependencies ──
    if (stage.requires) {
      const unmet = stage.requires.filter(dep => {
        const depState = state.stages[dep];
        return depState !== 'complete' && depState !== 'skipped';
      });
      if (unmet.length > 0) {
        logger.error(`Stage "${stage.name}" requires: ${unmet.join(', ')} — not yet complete`);
        state.stages[stage.name] = 'failed';
        savePipelineState(workDir, state);
        if (stage.onFail === 'skip') {
          logger.warn(`Skipping stage "${stage.name}" (onFail: skip)`);
          state.stages[stage.name] = 'skipped';
          savePipelineState(workDir, state);
          continue;
        }
        logger.error(`Pipeline stopped: dependency not met for stage "${stage.name}"`);
        if (config.notify) sendNotification('cleave ❌', `Pipeline stopped: ${stage.name} dependency unmet`);
        process.exit(1);
      }
    }

    // ── Run stage (with retry support) ──
    const maxAttempts = stage.onFail === 'retry' ? (stage.retryMax || 1) : 1;
    let stageCompleted = false;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (attempt > 1) {
        logger.info(`🔄 Retrying stage "${stage.name}" (attempt ${attempt}/${maxAttempts})`);
      }

      // Run this stage (guarded — catch unexpected crashes)
      let result: RelayCoreResult;
      try {
        result = await runStage(config, pipeline, stage, stageNum, totalStages, state, attempt);
      } catch (err: any) {
        logger.error(`Stage "${stage.name}" crashed unexpectedly: ${err.message}`);
        logger.error(`Stack: ${err.stack || 'no stack'}`);
        result = { completed: false, maxSessionsReached: false, sessionsRun: 0, lastSession: 0 };
      }

      if (result.completed) {
        stageCompleted = true;
        state.stages[stage.name] = 'complete';
        savePipelineState(workDir, state);

        // Promote knowledge to shared
        if (stage.shareKnowledge !== false) {
          const stagePaths = resolveStagePaths(workDir, stage.name);
          promoteToSharedKnowledge(stagePaths.knowledgeFile, workDir, stage.name);
          logger.debug(`Knowledge promoted from "${stage.name}" to shared`);
        }

        logger.success(`Stage "${stage.name}" complete (${result.sessionsRun} sessions)`);
        if (config.notify) sendNotification('cleave ✅', `Stage ${stageNum}/${totalStages} "${stage.name}" complete`);
        break;
      }

      // Stage did not complete
      if (attempt < maxAttempts) {
        // Reset for retry (preserve knowledge)
        const stagePaths = resolveStagePaths(workDir, stage.name);
        resetStageForRetry(stagePaths);
        logger.warn(`Stage "${stage.name}" did not complete — retrying...`);
      }
    }

    if (!stageCompleted) {
      // Stage failed after all attempts
      state.stages[stage.name] = 'failed';
      state.currentStage = stage.name;
      savePipelineState(workDir, state);

      if (stage.onFail === 'skip') {
        logger.warn(`⏭️  Skipping failed stage "${stage.name}" (onFail: skip)`);
        state.stages[stage.name] = 'skipped';
        savePipelineState(workDir, state);
        continue;
      }

      // Default: stop
      logger.error(`❌ Stage "${stage.name}" failed after ${maxAttempts} attempt(s). Pipeline stopped.`);
      if (config.notify) sendNotification('cleave ❌', `Pipeline stopped: stage "${stage.name}" failed`);
      process.exit(1);
    }
  }

  // ── All stages complete ──
  console.log('');
  console.log('  ╔════════════════════════════════════════════════╗');
  console.log(`  ║  ✅ PIPELINE COMPLETE: ${pipeline.name.padEnd(24)}║`);
  console.log('  ╚════════════════════════════════════════════════╝');
  console.log('');

  // Update final state
  state.currentStage = null;
  savePipelineState(workDir, state);

  if (config.notify) {
    sendNotification('cleave ✅', `Pipeline "${pipeline.name}" complete!`);
  }

  logger.success(`Pipeline "${pipeline.name}" finished — all stages complete.`);
}

/**
 * Run a single pipeline stage as a Cleave relay.
 */
async function runStage(
  config: CleaveConfig,
  _pipeline: PipelineConfig,
  stage: StageConfig,
  stageNum: number,
  totalStages: number,
  state: PipelineState,
  _attempt: number,
): Promise<RelayCoreResult> {
  const workDir = config.workDir;
  const stagePaths = resolveStagePaths(workDir, stage.name);

  // Initialize stage directory
  initRelayDir(stagePaths);

  // Update pipeline state
  state.stages[stage.name] = 'in_progress';
  state.currentStage = stage.name;
  savePipelineState(workDir, state);

  logger.info('');
  logger.info(`━━━ Stage ${stageNum}/${totalStages}: "${stage.name}" ━━━`);

  // Build a stage-specific config overlay
  const stageConfig: CleaveConfig = {
    ...config,
    initialPromptFile: stage.prompt,
    maxSessions: stage.maxSessions,
    completionMarker: stage.completion,
    verifyCommand: stage.verify || null,
  };

  // Build stage-aware handoff instructions
  const stageHandoff = buildStageHandoffInstructions(
    stageConfig, stage.name, stageNum, totalStages, stage.completion
  );

  // Custom prompt builder that uses stage paths and stage handoff instructions
  const buildPrompt = (cfg: CleaveConfig, sessionNum: number): string => {
    let prompt: string;

    // Check if there's a NEXT_PROMPT.md from a previous session in this stage
    if (sessionNum > 1 && fs.existsSync(stagePaths.nextPromptFile)) {
      const nextContent = fs.readFileSync(stagePaths.nextPromptFile, 'utf8').trim();
      if (nextContent.length > 0) {
        prompt = nextContent;
        logger.debug(`Stage "${stage.name}" session ${sessionNum}: using NEXT_PROMPT.md (${nextContent.length} chars)`);
      } else {
        logger.warn(`⚠️  Stage "${stage.name}": NEXT_PROMPT.md is empty for session ${sessionNum} — falling back to stage prompt + PROGRESS.md`);
        prompt = fs.readFileSync(stage.prompt, 'utf8');
        if (fs.existsSync(stagePaths.progressFile)) {
          prompt += `\n\n--- PROGRESS FROM PRIOR SESSIONS ---\n${fs.readFileSync(stagePaths.progressFile, 'utf8')}`;
        }
      }
    } else if (sessionNum > 1) {
      logger.warn(`⚠️  Stage "${stage.name}": no NEXT_PROMPT.md for session ${sessionNum} — falling back to stage prompt + PROGRESS.md`);
      prompt = fs.readFileSync(stage.prompt, 'utf8');
      if (fs.existsSync(stagePaths.progressFile)) {
        prompt += `\n\n--- PROGRESS FROM PRIOR SESSIONS ---\n${fs.readFileSync(stagePaths.progressFile, 'utf8')}`;
      }
    } else {
      // First session: read the stage's initial prompt
      prompt = fs.readFileSync(stage.prompt, 'utf8');

      // Append progress if exists
      if (fs.existsSync(stagePaths.progressFile)) {
        const progress = fs.readFileSync(stagePaths.progressFile, 'utf8');
        prompt += `\n\n--- PROGRESS FROM PRIOR SESSIONS ---\n${progress}`;
      }
    }

    // Reference stage knowledge
    if (fs.existsSync(stagePaths.knowledgeFile)) {
      const kLines = fs.readFileSync(stagePaths.knowledgeFile, 'utf8').split('\n').length;
      if (kLines > 10) {
        prompt += `\n\n--- ACCUMULATED KNOWLEDGE ---\nRead \`.cleave/stages/${stage.name}/KNOWLEDGE.md\` for tips and patterns from prior sessions.`;
      }
    }

    // Reference shared pipeline knowledge
    const sharedKnowledge = path.join(workDir, '.cleave', 'shared', 'KNOWLEDGE.md');
    if (fs.existsSync(sharedKnowledge)) {
      const sharedLines = fs.readFileSync(sharedKnowledge, 'utf8').split('\n').length;
      if (sharedLines > 5) {
        prompt += '\n\n--- SHARED PIPELINE KNOWLEDGE ---\nRead `.cleave/shared/KNOWLEDGE.md` for cross-stage insights from earlier pipeline stages.';
      }
    }

    // In headless mode, append handoff instructions directly to prompt
    if (!cfg.tui) {
      prompt += stageHandoff;
    }

    return prompt;
  };

  // Run the relay core for this stage
  const result = await runRelayCore({
    paths: stagePaths,
    config: stageConfig,
    startSession: readSessionCount(stagePaths),
    maxSessions: stage.maxSessions,
    completionMarker: stage.completion,
    verifyCommand: stage.verify || null,
    verifyTimeout: config.verifyTimeout,
    buildPrompt,
    label: `stage: ${stage.name}`,
  });

  // Run external verification if the relay thinks it completed
  if (result.completed && stage.verify) {
    const verifyResult = runVerification(stage.verify, workDir, config.verifyTimeout);
    if (!verifyResult.passed) {
      logger.warn(`Stage "${stage.name}" claimed complete but verification failed`);
      return { ...result, completed: false };
    }
  }

  return result;
}
