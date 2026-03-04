export function collectToolStats(events) {
    const tools = {};
    const skills = [];
    for (const event of events) {
        if (event.name === 'Skill') {
            const skillName = String(event.input?.skill ?? '');
            if (skillName && !skills.includes(skillName)) {
                skills.push(skillName);
            }
        }
        tools[event.name] = (tools[event.name] ?? 0) + 1;
    }
    return { tools, skills };
}
function formatDuration(ms) {
    const mins = Math.floor(ms / 60000);
    const secs = Math.floor((ms % 60000) / 1000);
    if (mins > 0)
        return `${mins}m ${secs}s`;
    return `${secs}s`;
}
export function buildDebriefPrompt(ctx) {
    const toolLines = Object.entries(ctx.toolStats)
        .sort(([, a], [, b]) => b - a)
        .map(([name, count]) => `  - ${name}: ${count}`)
        .join('\n');
    const skillLines = ctx.skills.length > 0
        ? ctx.skills.map(s => `  - ${s}`).join('\n')
        : '  (none)';
    const fileLines = ctx.filesChanged.length > 0
        ? ctx.filesChanged.map(f => `  - ${f}`).join('\n')
        : '  (none detected)';
    const errorLines = ctx.errors.length > 0
        ? ctx.errors.map(e => `  - Session ${e.sessionNum}: ${e.message}`).join('\n')
        : '  (none)';
    return `# Debrief Request

You just completed a multi-session autonomous project. Write a detailed debrief report.

## Raw Data

- Sessions run: ${ctx.sessionsRun} session${ctx.sessionsRun !== 1 ? 's' : ''}
- Total cost: $${ctx.totalCostUsd.toFixed(2)}
- Total duration: ${formatDuration(ctx.totalDurationMs)}

### Tools Used
${toolLines}

### Skills Used
${skillLines}

### Files Changed
${fileLines}

### Errors Encountered
${errorLines}

### Final Progress State
${ctx.finalProgress}

### Accumulated Knowledge
${ctx.finalKnowledge}

## Your Task

Write a file to \`.cleave/DEBRIEF.md\` with the following sections:

1. **Summary** — What was accomplished, in 2-3 sentences.
2. **Work Completed** — Each deliverable with file paths where it can be found.
3. **Tools & Skills Used** — What was used, frequency, which were most effective.
4. **What Worked** — Patterns, approaches, and decisions that went well.
5. **What Didn't Work** — Failures, retries, dead ends, wasted effort.
6. **Recommendations** — What to do differently next time, improvements for future runs.

Be specific and actionable. Reference actual file paths and concrete outcomes, not generalities.
Do NOT write any handoff files. Only write DEBRIEF.md.`;
}
//# sourceMappingURL=debrief.js.map