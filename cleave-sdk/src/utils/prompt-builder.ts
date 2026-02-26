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

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
AUTOMATED SESSION RELAY — MANDATORY INSTRUCTIONS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

You are running inside an automated relay system. Context quality degrades
predictably: 0-30% = peak quality, 50%+ = declining, 70%+ = errors/hallucinations.

**CONTEXT BUDGET:**
- **0–${config.handoffThreshold}%** — Do productive work. This is your working zone.
- **${config.handoffThreshold}%** — STOP productive work. Begin the handoff procedure below.
- **${config.handoffThreshold}–${config.handoffDeadline}%** — Handoff zone. Write the three files below.
  This is structured/formulaic output — quality holds fine here.
- **${config.handoffDeadline}%+** — DANGER. Never reach this. Quality collapses.

**50% CHECKPOINT — MANDATORY SELF-ASSESSMENT:**
When you estimate you've used ~50% of your context window, STOP and do this calculation:
1. How much work remains? (e.g., "60 more images" or "30 more modules")
2. How much context did the work so far consume? (e.g., "50% for 80 images")
3. Will the remaining work fit in the remaining ~20% budget (before ${config.handoffThreshold}%)?
4. **If NO** — STOP IMMEDIATELY and begin the handoff procedure. Do NOT continue working.
5. **If YES** — continue, but monitor closely. Stop at ${config.handoffThreshold}% regardless.

This checkpoint is MANDATORY. Do not skip it. The relay system will start a new session
to continue your work — your job is clean progress and clean handoffs, NOT finishing everything.

When you estimate you've used ~${config.handoffThreshold}% of your context window, STOP working
and execute the handoff procedure immediately, even if you are in the middle of a batch or task.

**STEP 1 — Update \`.cleave/PROGRESS.md\`:**
- STATUS: either \`IN_PROGRESS\` or \`${config.completionMarker}\`
- What you accomplished (specific counts, files, items)
- Exactly where you stopped (be precise — file, line, item, step)
- Issues encountered and resolutions
- Session number and timestamp

**STEP 2 — Update \`.cleave/KNOWLEDGE.md\`:**
This file has two sections — read it first, then update:
\`## Core Knowledge\` — PERMANENT insights every session needs (API keys, working
  search terms, critical config, architectural decisions). If you discover something
  universally important, add it here. Keep it concise — this section is never pruned.
\`## Session Log\` — Your session-specific notes. APPEND a new entry at the bottom:
  Format: \`### Session N — [Date]\` followed by bullet points.
  Include: what worked, what failed, dead ends, performance observations.
  This section is auto-pruned to the last 5 entries by the relay script, so
  promote anything permanently valuable up to Core Knowledge before it's lost.
IMPORTANT: APPEND to this file. Do not overwrite or reorganize existing content.

**STEP 3 — Write \`.cleave/NEXT_PROMPT.md\`:**
The EXACT prompt for the next session (fed verbatim). Include:
- Full task context (the next session has zero memory)
- What scripts/tools exist and how to use them
- Setup steps (venv, env vars, etc.)
- Exactly where to resume
- Reference KNOWLEDGE.md: tell next session to read it
- These same handoff instructions
- End with: "When at ~${config.handoffThreshold}% context, STOP and do the handoff procedure."

**STEP 4 — Print exactly:** \`RELAY_HANDOFF_COMPLETE\`
Then stop immediately.

If ALL work is done, write \`STATUS: ${config.completionMarker}\` in PROGRESS.md
and print \`TASK_FULLY_COMPLETE\` instead.
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
  return buildBasePrompt(config, sessionNum) + buildHandoffInstructions(config);
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
`;
}
