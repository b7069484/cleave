/**
 * Builds session prompts with handoff instructions appended.
 */

import * as fs from 'fs';
import * as path from 'path';
import { CleaveConfig } from '../config';

/**
 * Build the handoff instructions block that gets appended to every prompt.
 */
function buildHandoffInstructions(config: CleaveConfig): string {
  const subagentBlock = config.enableSubagents ? `
**SUBAGENT STRATEGY (recommended for heavy tasks):**
For tasks that involve processing many files or doing repetitive work, consider
spawning subagents to keep your main context lean:
  \`claude -p "Process files X-Y according to these rules: ..." --dangerously-skip-permissions\`
This gives each subtask a fresh 200K context window while your orchestrator
session stays at ~15-30% context. Only do this for clearly independent subtasks.
` : '';

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

When you estimate you've used ~${config.handoffThreshold}% of your context window, STOP working
and execute the handoff procedure immediately.
${subagentBlock}
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
 * Build the complete prompt for a given session.
 */
export function buildSessionPrompt(config: CleaveConfig, sessionNum: number): string {
  const relayDir = path.join(config.workDir, '.cleave');
  const progressFile = path.join(relayDir, 'PROGRESS.md');
  const nextPromptFile = path.join(relayDir, 'NEXT_PROMPT.md');
  const knowledgeFile = path.join(relayDir, 'KNOWLEDGE.md');

  let prompt: string;

  if (sessionNum > 1 && fs.existsSync(nextPromptFile)) {
    // Use Claude's own handoff prompt
    prompt = fs.readFileSync(nextPromptFile, 'utf8');
  } else {
    // First session or no handoff: use initial prompt
    prompt = fs.readFileSync(config.initialPromptFile, 'utf8');

    // Append progress if exists
    if (fs.existsSync(progressFile)) {
      const progress = fs.readFileSync(progressFile, 'utf8');
      prompt += `\n\n--- PROGRESS FROM PRIOR SESSIONS ---\n${progress}`;
    }
  }

  // Append knowledge reference
  if (fs.existsSync(knowledgeFile)) {
    const knowledgeLines = fs.readFileSync(knowledgeFile, 'utf8').split('\n').length;
    if (knowledgeLines > 10) {
      prompt += '\n\n--- ACCUMULATED KNOWLEDGE ---\nRead `.cleave/KNOWLEDGE.md` for tips and patterns from prior sessions.';
    }
  }

  // Always append handoff instructions
  prompt += buildHandoffInstructions(config);

  return prompt;
}
