---
name: session-relay
description: "Manages session relay handoffs for long-running tasks that exceed a single context window. Automatically invoked when working on a cleave relay task. Handles context budget monitoring, structured handoff file writing (PROGRESS.md, KNOWLEDGE.md, NEXT_PROMPT.md), and session continuity. Use when: the prompt mentions .cleave/, relay, handoff, session continuation, or context budget."
user-invocable: false
allowed-tools: "Read, Write, Edit, Bash, Glob, Grep"
---

# Cleave Session Relay — Handoff Protocol (v4.2)

You are running inside **cleave**, an automated session relay system. Your context window is finite and quality degrades predictably. This skill defines the mandatory handoff procedure you MUST follow.

## Context Quality Model

Context quality degrades as usage increases. The handoff threshold is configurable — defaults shown below:

| Context Used | Quality Zone | What To Do |
|:------------|:------------|:-----------|
| 0–30% | Peak quality | Do your best work here |
| 30–50% | Good quality | Continue productive work |
| 50–60% | Declining | Still productive, start planning handoff |
| **60%** | **HANDOFF TRIGGER** | **STOP productive work. Begin handoff.** |
| 60–70% | Handoff zone | Write the three handoff files (structured output holds fine here) |
| 70%+ | DANGER | Quality collapses. Never reach this. |

> **Note:** If the relay was started with a custom threshold (e.g., `--handoff-threshold 50`), use that value instead of 60%. The NEXT_PROMPT.md from the previous session will specify the exact threshold.

## The Golden Rule

**When you estimate you've used ~60% of your context window, STOP all productive work immediately and execute the handoff procedure below.** Do not try to squeeze in "one more thing." The handoff zone (60-70%) exists specifically for writing structured handoff files — that formulaic output tolerates mild quality decline.

## Handoff Procedure (4 Steps)

### Step 1 — Update `.cleave/PROGRESS.md`

Write or update this file with:

```markdown
# Cleave Progress Report

**STATUS:** IN_PROGRESS | ALL_COMPLETE
**Session:** #N
**Timestamp:** YYYY-MM-DD HH:MM
**Context Used:** ~XX%

## Accomplished This Session
- [Specific items completed with counts: "Processed files 34-67 (34 files)"]
- [Concrete deliverables: "Created auth module in src/auth/"]

## Stopped At
- [Exact position: file path, line number, item index, step name]
- [What was the last thing completed]
- [What is the very next thing to do]

## Issues & Resolutions
- [Problems hit and how they were solved]
- [Workarounds applied]
- [Dead ends discovered]

## Overall Progress
- [X of Y total items done]
- [Estimated sessions remaining]
```

Set STATUS to `ALL_COMPLETE` only when the **entire task** is finished.

### Step 2 — Update `.cleave/KNOWLEDGE.md`

This file has two sections. **Read it first**, then update:

**`## Core Knowledge`** — PERMANENT insights every future session needs:
- API keys, working URLs, valid credentials
- Search terms that actually work
- Critical config values or environment setup
- Architectural decisions and their rationale
- Hard-won debugging insights

If you discovered something universally important this session, **promote it here**. This section is never auto-pruned, so keep it concise and high-signal.

**`## Session Log`** — Your session-specific notes. APPEND a new entry:

```markdown
### Session N — YYYY-MM-DD

- What worked: [specific techniques, commands, approaches]
- What failed: [dead ends, broken approaches, things to skip]
- Performance: [timing, counts, throughput observations]
- Warnings: [things the next session should watch out for]
```

**CRITICAL:** APPEND to this file. Do NOT overwrite or reorganize existing content. The relay system auto-prunes old Session Log entries (keeps last 5), so promote anything permanently valuable to Core Knowledge before it's lost.

### Step 3 — Write `.cleave/NEXT_PROMPT.md`

This is the **exact prompt** the next session will receive. It has zero memory of this session — everything it needs must be in this file.

Include ALL of the following:

1. **Full task context** — What is the overall task? What are the goals? What does "done" look like?
2. **Project structure** — Where are the files? What scripts/tools exist? How to use them?
3. **Setup steps** — Virtual env activation, environment variables, dependencies
4. **Exact resume point** — Where to start (file, line, item, step). Be surgically precise.
5. **What worked** — Techniques, search terms, API patterns that are proven
6. **What to avoid** — Dead ends, broken approaches, things to skip
7. **Knowledge reference** — Tell the next session: "Read `.cleave/KNOWLEDGE.md` for accumulated tips and patterns from prior sessions."
8. **Do NOT copy relay/handoff instructions** into NEXT_PROMPT.md — they are appended automatically by the relay system. Instead, end with: "When at ~60% context, STOP and do the handoff procedure."

### Step 4 — Signal Completion

Write a signal file and print confirmation:

- **Handoff:** Write `HANDOFF_COMPLETE` to `.cleave/.handoff_signal`, then print `RELAY_HANDOFF_COMPLETE`
- **Task done:** Write `TASK_FULLY_COMPLETE` to `.cleave/.handoff_signal`, then print `TASK_FULLY_COMPLETE`

Then **stop immediately**. The `.handoff_signal` file is what the relay system detects to start the next session. Do not do any more work.

## Subagent Strategy (Optional)

For tasks involving many independent items (processing files, converting tests, etc.), consider spawning subagents to keep your main context lean:

```bash
claude -p "Process files X-Y according to these rules: ..." --dangerously-skip-permissions
```

Each subagent gets a fresh 200K context window. Your orchestrator session stays at ~15-30% context, giving you far more productive capacity before handoff. Only use this for clearly independent subtasks.

## Crash Recovery

If you detect signs of a previous session crash (e.g., `.cleave/.session_start` is newer than handoff files, or PROGRESS.md shows IN_PROGRESS but NEXT_PROMPT.md is missing/stale):

1. Read `.cleave/PROGRESS.md` to understand what the crashed session was doing
2. Read `.cleave/KNOWLEDGE.md` for any accumulated context
3. Resume from the last known good state documented in PROGRESS.md
4. Note the crash in your Session Log entry: "Recovered from session N crash"

The relay system tracks crash counts in `.cleave/status.json` for monitoring.

## Important Reminders

- **Read `.cleave/KNOWLEDGE.md` at the start of every session** — it contains accumulated wisdom from prior sessions
- **Read `.cleave/PROGRESS.md` at the start** — it tells you where the last session stopped
- **Never skip the handoff** — even if you think you're almost done, write the files. If you ARE done, set STATUS to ALL_COMPLETE
- **Be specific in NEXT_PROMPT.md** — vague handoffs waste entire sessions. "Continue processing" is bad. "Process files 67-100 in ./data/csv/ starting with customer_q3.csv" is good
- **The 60% threshold is approximate** — err on the side of handing off early rather than late. A premature handoff wastes 10% of one session. A late handoff corrupts the entire chain.
- **SDK integration** — If this plugin is running alongside `cleave-sdk` (via `npx cleave-sdk`), the SDK handles the outer loop, knowledge compaction, and loop detection automatically. The plugin provides the in-session handoff enforcement and slash commands.
