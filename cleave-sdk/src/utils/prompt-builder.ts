/**
 * Builds session prompts with handoff instructions.
 * Deduplicated: buildBasePrompt() handles common logic for both TUI and headless modes.
 */

import * as fs from 'fs';
import * as path from 'path';
import { CleaveConfig } from '../config';
import { logger } from './logger';

/**
 * Build the handoff instructions block.
 * Exported so TUI mode can pass it via --append-system-prompt separately.
 */
export function buildHandoffInstructions(config: CleaveConfig): string {
  return `

━━━━━━━━ CLEAVE AUTOMATED RELAY — YOU MUST FOLLOW THESE RULES ━━━━━━━━

You are inside an automated relay. Another session will continue your work.
Your job: make progress AND write handoff files. Both are equally important.

RULE 1 — WRITE HANDOFF FILES EARLY AND OFTEN
After completing each logical chunk of work (e.g., a batch of files, a phase),
update .cleave/PROGRESS.md immediately. Do NOT wait until the end.
If your session crashes, the relay system uses these files to continue.

RULE 2 — CONTEXT BUDGET
- 0–50%: Work zone. Do productive work. Update PROGRESS.md after each batch.
- 50%: CHECKPOINT. Assess: will remaining work fit? If not, start handoff NOW.
- ${config.handoffThreshold}%: HARD STOP. Begin handoff procedure immediately.
- ${config.handoffDeadline}%+: DANGER. Quality collapses. Never reach this.

RULE 3 — THE HANDOFF PROCEDURE (4 files, do them in order)

1. Write \`.cleave/PROGRESS.md\`:
   First line: \`## STATUS: IN_PROGRESS\` (or \`${config.completionMarker}\` if ALL done)
   Then: what you did, exactly where you stopped, what's left.

2. Append to \`.cleave/KNOWLEDGE.md\` (DO NOT overwrite — append):
   Add \`### Session N\` entry with what worked, what failed, key discoveries.

3. Write \`.cleave/NEXT_PROMPT.md\`:
   Full instructions for the next session (it has ZERO memory of yours).
   Include: task context, what's done, where to resume, key file paths.
   End with: "When at ~${config.handoffThreshold}% context, STOP and do the handoff procedure."

4. Write \`HANDOFF_COMPLETE\` to \`.cleave/.handoff_signal\`
   Then print RELAY_HANDOFF_COMPLETE and stop.

If ALL work is done: set \`STATUS: ${config.completionMarker}\` in PROGRESS.md,
write \`TASK_FULLY_COMPLETE\` to .handoff_signal, print TASK_FULLY_COMPLETE.

CRITICAL: The relay system has a safety net — if you exit without handoff files,
it will auto-generate rescue files from your git changes. But this is a FALLBACK.
You should ALWAYS write the handoff files yourself for best continuity.
`;
}

/**
 * Build the base task prompt for a session (common logic for TUI + headless).
 * Reads NEXT_PROMPT.md for session 2+, or initial prompt for session 1.
 * Appends progress and knowledge references.
 */
function buildBasePrompt(config: CleaveConfig, sessionNum: number): string {
  const relayDir = path.join(config.workDir, '.cleave');
  const progressFile = path.join(relayDir, 'PROGRESS.md');
  const nextPromptFile = path.join(relayDir, 'NEXT_PROMPT.md');
  const knowledgeFile = path.join(relayDir, 'KNOWLEDGE.md');

  let prompt: string;

  if (sessionNum > 1 && fs.existsSync(nextPromptFile)) {
    const nextContent = fs.readFileSync(nextPromptFile, 'utf8').trim();
    if (nextContent.length > 0) {
      prompt = nextContent;
      logger.debug(`Session ${sessionNum}: using NEXT_PROMPT.md (${nextContent.length} chars)`);
    } else {
      // NEXT_PROMPT.md exists but is empty — fall back with warning
      logger.warn(`⚠️  NEXT_PROMPT.md is empty for session ${sessionNum} — falling back to initial prompt + PROGRESS.md`);
      prompt = fs.readFileSync(config.initialPromptFile, 'utf8');
      if (fs.existsSync(progressFile)) {
        prompt += `\n\n--- PROGRESS FROM PRIOR SESSIONS ---\n${fs.readFileSync(progressFile, 'utf8')}`;
      }
    }
  } else if (sessionNum > 1) {
    // NEXT_PROMPT.md missing entirely — fall back with warning
    logger.warn(`⚠️  No NEXT_PROMPT.md for session ${sessionNum} — falling back to initial prompt + PROGRESS.md`);
    prompt = fs.readFileSync(config.initialPromptFile, 'utf8');
    if (fs.existsSync(progressFile)) {
      prompt += `\n\n--- PROGRESS FROM PRIOR SESSIONS ---\n${fs.readFileSync(progressFile, 'utf8')}`;
    }
  } else {
    prompt = fs.readFileSync(config.initialPromptFile, 'utf8');
    if (fs.existsSync(progressFile)) {
      prompt += `\n\n--- PROGRESS FROM PRIOR SESSIONS ---\n${fs.readFileSync(progressFile, 'utf8')}`;
    }
  }

  // Knowledge reference
  if (fs.existsSync(knowledgeFile)) {
    const kLines = fs.readFileSync(knowledgeFile, 'utf8').split('\n').length;
    if (kLines > 10) {
      prompt += '\n\n--- ACCUMULATED KNOWLEDGE ---\nRead `.cleave/KNOWLEDGE.md` for tips and patterns from prior sessions.';
    }
  }

  // Shared pipeline knowledge reference
  const sharedKnowledge = path.join(config.workDir, '.cleave', 'shared', 'KNOWLEDGE.md');
  if (fs.existsSync(sharedKnowledge)) {
    const sharedLines = fs.readFileSync(sharedKnowledge, 'utf8').split('\n').length;
    if (sharedLines > 5) {
      prompt += '\n\n--- SHARED PIPELINE KNOWLEDGE ---\nRead `.cleave/shared/KNOWLEDGE.md` for cross-stage insights from earlier pipeline stages.';
    }
  }

  return prompt;
}

/**
 * Build just the task prompt (without handoff instructions).
 * Used in TUI mode where handoff instructions go via --append-system-prompt.
 */
export function buildTaskPrompt(config: CleaveConfig, sessionNum: number): string {
  return buildBasePrompt(config, sessionNum);
}

/**
 * Build the complete prompt for a given session (task + handoff instructions).
 * Used in headless/query() mode.
 */
export function buildSessionPrompt(config: CleaveConfig, sessionNum: number): string {
  const base = buildBasePrompt(config, sessionNum);
  // Don't double-append if the prompt already contains handoff instructions
  // (happens when NEXT_PROMPT.md from prior session included them)
  if (base.includes('AUTOMATED SESSION RELAY')) {
    return base;
  }
  return base + buildHandoffInstructions(config);
}

/**
 * Build stage-aware handoff instructions for pipeline mode.
 */
export function buildStageHandoffInstructions(
  config: CleaveConfig,
  stageName: string,
  stageNum: number,
  totalStages: number,
  stageCompletion: string
): string {
  return `

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PIPELINE STAGE ${stageNum}/${totalStages}: "${stageName}" — RELAY INSTRUCTIONS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

You are stage "${stageName}" (${stageNum} of ${totalStages}) in a Cleave pipeline.

**YOUR COMPLETION MARKER:** \`${stageCompletion}\`
When your stage's work is FULLY done, set \`STATUS: ${stageCompletion}\` in
\`.cleave/stages/${stageName}/PROGRESS.md\` and print \`TASK_FULLY_COMPLETE\`.

**STATE FILES:** Your state files are in \`.cleave/stages/${stageName}/\`:
- PROGRESS.md, KNOWLEDGE.md, NEXT_PROMPT.md (same handoff rules as standard relay)

**SHARED KNOWLEDGE:** If you discover insights useful for later stages,
add them to your Core Knowledge section — they'll be promoted to shared knowledge.

**CONTEXT BUDGET:** Same rules — stop at ~${config.handoffThreshold}% and do the handoff.

**HANDOFF SIGNAL:** When you complete the handoff procedure, write \`HANDOFF_COMPLETE\`
to \`.cleave/stages/${stageName}/.handoff_signal\` as your final action.
If the stage is fully done, write \`TASK_FULLY_COMPLETE\` to that file instead.
`;
}
