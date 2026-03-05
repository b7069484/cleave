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
<!-- CLEAVE_RELAY_INSTRUCTIONS_V6 -->
━━━━━━━━ CLEAVE AUTOMATED RELAY RULES ━━━━━━━━

THE HANDOFF PROCEDURE (do these 4 steps, in order, after each chunk of work):

1. Write \`.cleave/PROGRESS.md\`:
   First line: \`## STATUS: IN_PROGRESS\` (or \`STATUS: ${config.completionMarker}\` if ALL done)
   Then: SPECIFIC details — what you did, files changed, exactly where you stopped, what's left.

2. Append to \`.cleave/KNOWLEDGE.md\` (APPEND — do NOT overwrite the file):
   Add a \`### Session N\` entry with: what worked, what failed, key discoveries, gotchas.

3. Write \`.cleave/NEXT_PROMPT.md\`:
   Complete instructions for the next session. It has ZERO memory of yours.
   Include: full task context, what's done, where to resume, key file paths, commands.
   Do NOT copy these relay instructions into NEXT_PROMPT.md — they are auto-appended.

4. Write \`HANDOFF_COMPLETE\` to \`.cleave/.handoff_signal\`
   Then print the text RELAY_HANDOFF_COMPLETE and STOP working immediately.

If ALL work is genuinely done AND verified:
- Set \`STATUS: ${config.completionMarker}\` in PROGRESS.md
- Write \`TASK_FULLY_COMPLETE\` to .handoff_signal
- Print the text TASK_FULLY_COMPLETE

SESSION BUDGET: You have a limited budget (~$${config.sessionBudget}). You WILL be cut off when it runs out. Write handoff files after EVERY significant chunk of work — they are your "save game." The last handoff files you wrote become the next session's starting point.

YOUR SCOPE: Pick the top 1-3 items from the task or prior session's "Next Actions." Complete them thoroughly (read code, implement, test, commit). Update handoff files. If more work remains, do the handoff procedure and stop. The next session will continue where you left off.

NEVER delete or modify .cleave/ infrastructure. ONLY write to the specific handoff files listed above.

SAFETY NET: If you exit without handoff files, the relay auto-generates rescue files from your git changes. But this loses context. ALWAYS write handoff files yourself.
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
    if (nextContent.length >= 200) {
      prompt = nextContent;
      logger.debug(`Session ${sessionNum}: using NEXT_PROMPT.md (${nextContent.length} chars)`);
    } else if (nextContent.length > 0) {
      // NEXT_PROMPT.md exists but is too short — likely a rushed/incomplete handoff
      logger.warn(`NEXT_PROMPT.md too short (${nextContent.length} chars) for session ${sessionNum} — falling back to initial prompt + PROGRESS.md`);
      prompt = fs.readFileSync(config.initialPromptFile, 'utf8');
      if (fs.existsSync(progressFile)) {
        prompt += `\n\n--- PROGRESS FROM PRIOR SESSIONS ---\n${fs.readFileSync(progressFile, 'utf8')}`;
      }
    } else {
      logger.warn(`NEXT_PROMPT.md is empty for session ${sessionNum} — falling back to initial prompt + PROGRESS.md`);
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

  // Ground later sessions back to the original task to prevent instruction drift
  if (sessionNum >= 5) {
    try {
      const originalTask = fs.readFileSync(config.initialPromptFile, 'utf8');
      const truncated = originalTask.slice(0, 1000);
      prompt += `\n\n--- ORIGINAL TASK (for reference — do NOT redo completed work) ---\n${truncated}${originalTask.length > 1000 ? '\n[...truncated]' : ''}`;
    } catch { /* initial prompt file may not exist for continuations */ }
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
  // Uses a machine-readable sentinel that Claude is unlikely to reproduce
  if (base.includes('<!-- CLEAVE_RELAY_INSTRUCTIONS_V6 -->')) {
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

**SESSION BUDGET:** You have a limited budget per session. Work in manageable chunks and write handoff files between chunks. If you are cut off, rescue files will be auto-generated.

**HANDOFF SIGNAL:** When you complete the handoff procedure, write \`HANDOFF_COMPLETE\`
to \`.cleave/stages/${stageName}/.handoff_signal\` as your final action.
If the stage is fully done, write \`TASK_FULLY_COMPLETE\` to that file instead.

**CRITICAL:** NEVER delete or modify \`.cleave/logs/\`, \`.cleave/shared/\`, or any
file in \`.cleave/\` other than the handoff files listed above. The relay infrastructure
depends on these files. Deleting them will crash the pipeline.
`;
}
