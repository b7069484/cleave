# Cleave v6 Design — Custom TUI over `claude -p --output-format stream-json`

**Date:** 2026-03-03
**Status:** Approved

## Problem

Claude Code has a finite context window (~200K tokens). For large tasks, the context fills up and the session dies. Cleave solves this by making Claude write its own continuation prompt, then automatically starting a fresh session with that prompt loaded. Chain enough sessions and you get effectively infinite context — fully autonomous, zero human intervention.

Previous versions (v1-v5) all failed at the same bottleneck: reliably controlling Claude Code's TUI for auto-restart. Approaches tried: pipe-based I/O (destroyed TTY), tmux (fragile timing), Stop hooks (buggy plugin system), SIGTERM + file polling (racy). The headless `claude -p` mode works reliably for chaining but lacks the visual TUI experience.

## Solution

Don't fight the TUI. Run `claude -p --output-format stream-json` (which already works reliably for session chaining) and build a purpose-built TUI that renders the structured JSON event stream. This gives us:

1. **Reliable relay** — `claude -p` exits naturally. No SIGTERM, no `/exit` injection, no idle detection heuristics.
2. **Better visibility** — structured events let us render real-time context usage, agent activity, and relay-specific info that Claude Code's TUI can't show.
3. **Clean session lifecycle** — process spawn → stream → exit → restart. No hacks.

## Architecture

```
┌─────────────────────────────────────────────┐
│              CLEAVE TUI                      │
│  (ink/React for terminals - renders events)  │
├─────────────────────────────────────────────┤
│           STREAM PARSER                      │
│  (parses stream-json from claude -p)         │
├─────────────────────────────────────────────┤
│            RELAY LOOP                        │
│  (session lifecycle, handoff, knowledge)     │
├─────────────────────────────────────────────┤
│      claude -p --output-format stream-json   │
│  (Claude Code does ALL the real work)        │
└─────────────────────────────────────────────┘
```

Claude Code remains the engine — tool handling, file editing, agent spawning, hooks, permissions. Cleave builds three layers on top:

1. **Stream Parser** — parses newline-delimited JSON events from claude -p
2. **Relay Loop** — manages session lifecycle, handoff detection, knowledge compaction
3. **TUI** — renders parsed events into a rich terminal interface

## Session Lifecycle

1. Build prompt from NEXT_PROMPT.md (or initial task) + handoff protocol + knowledge
2. Spawn `claude -p --output-format stream-json --max-budget-usd $BUDGET "prompt"`
3. Parse stream events → render to TUI in real-time
4. Track token/cost data from stream events
5. Process exits naturally (no SIGTERM, no `/exit` injection needed)
6. Check `.cleave/.handoff_signal`:
   - `HANDOFF_COMPLETE` → start Session N+1
   - `TASK_FULLY_COMPLETE` → done, exit relay
   - Missing (crash/budget exceeded) → rescue handoff → Session N+1
7. Repeat until session limit reached or task fully complete

## TUI Layout

### During a session:
```
╔═══════════════════════════════════════════════════════════════╗
║  CLEAVE  Session 3/20  │  ~/myproject  │  ⏱ 4m 12s          ║
║  Context: ████████████░░░░░░░  62%  │  Budget: $2.30/$5.00   ║
╠═══════════════════════════════════════════════════════════════╣
║                                                               ║
║  Claude's streaming text output...                            ║
║                                                               ║
║  ┌─ Read: src/utils/parser.ts ─────────────────────────────┐  ║
║  │ (247 lines)                                              │  ║
║  └──────────────────────────────────────────────────────────┘  ║
║                                                               ║
║  ┌─ Edit: src/utils/parser.ts ─────────────────────────────┐  ║
║  │ - function parse(input) {                                │  ║
║  │ + function parse(input: string | string[]) {             │  ║
║  └──────────────────────────────────────────────────────────┘  ║
║                                                               ║
║  ┌─ Agent: test-runner ────────────────────────────────────┐  ║
║  │ ✓ 42/42 passed (3.2s)                                   │  ║
║  └──────────────────────────────────────────────────────────┘  ║
║                                                               ║
╠═══════════════════════════════════════════════════════════════╣
║  Knowledge: 4.2KB  │  Tasks: 3/7 done  │  Handoff: ready     ║
╚═══════════════════════════════════════════════════════════════╝
```

### Between sessions:
```
╔═══════════════════════════════════════════════════════════════╗
║                   SESSION 3 COMPLETE                          ║
║  Context used: 142K / 200K (71%)                              ║
║  Cost: $2.30  │  Tasks completed: 3/7                         ║
║  Knowledge promoted: 2 new entries                            ║
║  Starting Session 4/20 in 3s...                               ║
╚═══════════════════════════════════════════════════════════════╝
```

**Header:** Session number, working directory, elapsed time, context bar (real token %), budget tracker.

**Main area:** Scrolling view — streaming text with collapsible tool call cards (Read, Edit, Bash, Agent, TaskCreate).

**Footer:** Knowledge size, task progress, handoff status.

## Handoff Protocol

### Handoff enforcement via budget cap

- `--max-budget-usd` (default $5) controls session length
- Budget correlates with context usage — when budget is hit, Claude stops
- Handoff instructions tell Claude: "You have a SESSION BUDGET. Write handoff files BEFORE you run out."
- Adaptive budgets: if session N used 95% of budget before handoff, session N+1 gets a stronger "hand off early" instruction

### Rescue handoff (safety net)

If Claude exits without writing handoff files:
1. Check git diff for changes made
2. Read any partial PROGRESS.md
3. Auto-generate rescue NEXT_PROMPT.md: "Previous session made these changes: [summary]. Continue the task."
4. Relay chain continues — never silently dies

### Handoff files (.cleave/ directory)
```
.cleave/
├── PROGRESS.md          # Status + accomplishments + stop point
├── KNOWLEDGE.md         # Core Knowledge (permanent) + Session Log (rolling 5)
├── NEXT_PROMPT.md       # Complete prompt for next session
├── .handoff_signal      # "HANDOFF_COMPLETE" or "TASK_FULLY_COMPLETE"
├── .session_start       # Timestamp marker
├── .session_count       # Current session number
├── status.json          # Machine-readable status
└── logs/
    └── session_N_*.md   # Per-session archives
```

### Knowledge management

- **Core Knowledge** section: permanent, promoted insights. Auto-compacted when exceeding size threshold.
- **Session Log** section: rolling window of last 5 sessions. Auto-pruned before each session.

## Technology Stack

- **TypeScript** — type-safe, consistent with Node.js ecosystem
- **ink** — React for terminals. Battle-tested (Gatsby, Prisma, Shopify CLIs)
- **Commander.js** — CLI argument parsing
- **chokidar** — file watching for handoff detection
- **chalk** — terminal colors
- **No native modules** — pure JS/TS. `npm install` just works.

## Project Structure

```
cleave-v6/
├── src/
│   ├── index.ts              # Entry point
│   ├── cli.ts                # Commander CLI: run, resume, continue, status
│   ├── relay/
│   │   ├── loop.ts           # Session lifecycle orchestrator
│   │   ├── session.ts        # Spawns claude -p, manages process
│   │   ├── handoff.ts        # Handoff detection, rescue handoff
│   │   └── prompt-builder.ts # Builds session prompts from state
│   ├── stream/
│   │   ├── parser.ts         # Parses stream-json events
│   │   └── types.ts          # Event type definitions
│   ├── state/
│   │   ├── files.ts          # .cleave/ directory I/O
│   │   ├── knowledge.ts      # Knowledge compaction
│   │   └── config.ts         # Configuration & defaults
│   ├── tui/
│   │   ├── App.tsx           # Root ink component
│   │   ├── Header.tsx        # Session info, context bar, budget
│   │   ├── StreamView.tsx    # Main scrolling content area
│   │   ├── ToolCard.tsx      # Renders tool call events
│   │   ├── AgentPanel.tsx    # Renders agent/subagent activity
│   │   ├── Footer.tsx        # Knowledge, tasks, handoff status
│   │   └── Transition.tsx    # Between-session summary screen
│   └── utils/
│       ├── logger.ts         # File logging
│       └── git.ts            # Git integration
├── package.json
├── tsconfig.json
└── README.md
```

## CLI Interface

```bash
# Start a new task
cleave run "Refactor the authentication system" --sessions 20 --budget 5

# Resume from where you left off
cleave resume

# Continue with a new task, keeping accumulated knowledge
cleave continue "Now add OAuth support"

# Check status
cleave status
```

## Key Design Decisions

1. **Standalone project** — clean break from multi-edition confusion in cleave 4
2. **`claude -p` not TUI wrapping** — the reason every prior version failed was fighting the TUI. We don't fight it; we replace the rendering layer.
3. **ink for TUI** — component-based React model. Easy to iterate and add features.
4. **No plugin/hooks dependency** — handoff enforcement via budget caps + rescue handoff, not Claude Code's plugin system (which has known bugs #10412, #10875).
5. **Handoff instructions in prompt** — injected as part of the session prompt, not relying on CLAUDE.md markers (cleaner, no side effects on the user's project).
6. **No native modules** — no node-pty, no node-gyp. Pure TypeScript. Installs everywhere.
7. **Adaptive budgets** — learned from v5.6's fixed budget approach. Adjust per-session based on observed usage.

## What This Design Intentionally Excludes

- **Interactive mid-session input** — `claude -p` is fire-and-forget per session. For autonomous relay, you're not there to interact.
- **Pipeline mode** — focus on single-task relay first. Pipelines can be added later.
- **Plugin edition** — hooks enforcement is not needed when budget caps + rescue handoff work.
- **Shell edition** — TypeScript only. No bash script variant.

## Success Criteria

1. A user runs `cleave run "task" --sessions 10` and walks away
2. Cleave chains 10 sessions autonomously with zero human intervention
3. Each session's TUI renders in real-time showing context usage, tool activity, and agent work
4. Between sessions, a transition screen shows what was accomplished
5. Knowledge accumulates across sessions; no critical context is lost
6. If any session crashes or exceeds budget without handoff, rescue handoff keeps the chain alive
