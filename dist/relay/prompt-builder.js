export function buildHandoffInstructions(projectDir) {
    return `
## SESSION RELAY PROTOCOL

You are in an autonomous relay session managed by Cleave. You have a SESSION BUDGET that WILL cut you off when exhausted. Before that happens, you MUST write handoff files.

### When to hand off
- When you've completed a meaningful chunk of work
- When you sense you're running low on budget (after many tool calls)
- BEFORE the budget cuts you off — leave margin

### KNOWLEDGE.md — Create EARLY, update often
**Create .cleave/KNOWLEDGE.md within your first few tool calls.** Don't wait until handoff. Two sections:
- \`## Core Knowledge\` — Permanent insights (architecture decisions, key patterns found, important file paths). Append new discoveries as you find them.
- \`## Session Log\` — This session's work summary under \`### Session N\`. Update as you make progress.

Every time you discover something important (a key file path, an architecture pattern, a gotcha), append it to KNOWLEDGE.md immediately. This file is how wisdom compounds across sessions.

### Handoff files (write ALL of these to .cleave/ before budget runs out):

1. **PROGRESS.md** — Current status. Start with \`## STATUS: IN_PROGRESS\` or \`## STATUS: ALL_COMPLETE\`. List what's done, what's next, blockers.

2. **KNOWLEDGE.md** — Should already exist from your early updates. Do a final update with session summary.

3. **NEXT_PROMPT.md** — Complete prompt for the next session. Include: what to do next, relevant file paths, context needed. Write it as if briefing a skilled developer who has never seen this codebase.

4. **.handoff_signal** — Write exactly \`HANDOFF_COMPLETE\` when handoff files are ready. Write \`TASK_FULLY_COMPLETE\` ONLY when the entire original task is 100% done.

### Rules
- Create KNOWLEDGE.md early — don't wait for handoff
- Write handoff files BEFORE you run out of budget
- NEXT_PROMPT.md must be self-contained — the next session has NO memory of this one
- Do NOT write TASK_FULLY_COMPLETE unless the original task is truly finished
`.trim();
}
export function buildSessionPrompt(input) {
    const { sessionNum, maxSessions, initialTask, nextPrompt, knowledge, progress } = input;
    const parts = [];
    parts.push(`# Cleave Relay — Session ${sessionNum} of ${maxSessions}`);
    parts.push('');
    if (knowledge.trim()) {
        parts.push('## Accumulated Knowledge');
        parts.push(knowledge.trim());
        parts.push('');
    }
    if (progress.trim() && sessionNum > 1) {
        parts.push('## Previous Progress');
        parts.push(progress.trim());
        parts.push('');
    }
    parts.push('## Your Task');
    if (sessionNum === 1 || !nextPrompt.trim()) {
        parts.push(initialTask);
    }
    else {
        parts.push(nextPrompt.trim());
    }
    return parts.join('\n');
}
//# sourceMappingURL=prompt-builder.js.map