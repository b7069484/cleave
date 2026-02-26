# cleave-sdk

**Infinite context for Claude Code** — chain sessions together automatically with self-authored handoffs, knowledge accumulation, and enforced hooks.

Claude Code sessions are limited by context windows. When context fills up, the agent loses track of what it was doing. Cleave solves this by orchestrating a **relay** of sessions: each session writes its own continuation prompt, updates a shared knowledge base, and hands off to the next session seamlessly. The result is an agent that can work through tasks of arbitrary complexity without losing context.

## Contributing

**Never push directly to `main`.** All changes must go through pull requests. Create a feature/fix branch, open a PR into `main`, and only merge when all tests pass and there are no conflicts.

## Installation

```bash
npm install -g cleave-sdk
```

Requires [Claude Code](https://docs.anthropic.com/en/docs/claude-code) to be installed and authenticated.

## Quick Start

1. Write a task prompt file:

```markdown
# My Task

Refactor the authentication module to use JWT tokens.
Replace all session-based auth with stateless JWT.
Update tests to match.
```

2. Run it:

```bash
cleave my-task.md
```

Cleave starts a relay of Claude Code sessions. Each session works on the task, then writes a handoff before context runs out. The next session picks up exactly where the last one left off.

3. Watch it work. When the task is done, Claude writes `STATUS: ALL_COMPLETE` and Cleave stops.

## Commands

### `cleave run <prompt-file>` (default)

Start a new relay from a prompt file. The `run` keyword is optional — `cleave my-task.md` works the same as `cleave run my-task.md`.

```bash
cleave run task.md                      # Start a relay
cleave task.md                          # Same thing (run is default)
cleave task.md -m 20                    # Allow up to 20 sessions
cleave task.md -d ./my-project          # Set working directory
cleave task.md -g                       # Auto-commit after each session
cleave task.md --verify "npm test"      # Stop when tests pass
cleave task.md --no-tui                 # Headless mode (Agent SDK)
cleave task.md --safe-mode              # Require permission prompts
cleave task.md -r 5                     # Resume from session 5
```

### `cleave continue [prompt]`

Continue a completed relay with a new task. Preserves the accumulated knowledge base and builds on prior work.

```bash
cleave continue "Now add rate limiting to the API" -d ./my-project
cleave continue -f next-task.md -d ./my-project
```

The `continue` command:
- Reads the existing session count to know where to resume
- Archives the current PROGRESS.md
- Resets status to IN_PROGRESS with the new task
- Writes NEXT_PROMPT.md with continuation context
- **Preserves KNOWLEDGE.md** — accumulated knowledge carries over

## CLI Options

| Flag | Description | Default |
|------|-------------|---------|
| `-m, --max-sessions <n>` | Maximum sessions (1-1000) | `10` |
| `-d, --work-dir <dir>` | Working directory | `.` |
| `-p, --pause <seconds>` | Seconds between sessions | `10` |
| `-c, --completion-marker <string>` | Completion signal in PROGRESS.md | `ALL_COMPLETE` |
| `-g, --git-commit` | Auto-commit after each session | `false` |
| `--no-notify` | Disable desktop notifications | — |
| `--verify <command>` | Verification command (exit 0 = done) | — |
| `--safe-mode` | Require permission prompts | `false` |
| `-v, --verbose` | Detailed logging | `false` |
| `--subagents` | Hint Claude to spawn subagents | `false` |
| `--no-tui` | Headless mode (Agent SDK query) | — |
| `-r, --resume-from <n>` | Resume from session N (`run` only) | `0` |
| `-f, --file <path>` | Read prompt from file (`continue` only) | — |

## How It Works

### The Relay Loop

```
Session 1          Session 2          Session 3
┌──────────┐      ┌──────────┐      ┌──────────┐
│ Read task │      │ Read     │      │ Read     │
│ Do work   │ ──► │ handoff  │ ──► │ handoff  │ ──► ...
│ Handoff   │      │ Do work  │      │ Do work  │
└──────────┘      │ Handoff  │      │ Complete │
                  └──────────┘      └──────────┘
```

Each session:
1. Reads its task (initial prompt or previous session's handoff)
2. Does productive work until ~60% context usage
3. Writes the **handoff** — three files that transfer all context to the next session
4. The relay loop starts the next session with the handoff prompt

### Handoff Protocol

At ~60% context usage, Claude is instructed to stop productive work and write:

1. **`.cleave/PROGRESS.md`** — What was accomplished, exactly where work stopped
2. **`.cleave/KNOWLEDGE.md`** — Core insights (permanent) + session log (rolling)
3. **`.cleave/NEXT_PROMPT.md`** — Complete prompt for the next session

A **Stop hook** enforces this: Claude cannot exit until all three files are written and fresh. If it tries to exit early, the hook blocks it with instructions to complete the handoff.

### Two Modes

- **TUI mode** (default): Spawns `claude` as a subprocess with inherited stdio. You see the full Claude Code interactive interface. Hooks are enforced via a generated settings JSON file passed to `claude --settings`.
- **Headless mode** (`--no-tui`): Uses the Claude Agent SDK `query()` API for programmatic control. No TUI — output streams to stdout in verbose mode. Hooks are async TypeScript functions.

### Knowledge Compaction

The knowledge file has two sections:
- **Core Knowledge** — permanent insights that every session needs. Never pruned.
- **Session Log** — per-session notes, auto-pruned to the last 5 entries.

This keeps the knowledge file from growing unboundedly while preserving the most important information.

## The `.cleave/` Directory

```
.cleave/
├── PROGRESS.md          # Current task status and progress
├── KNOWLEDGE.md         # Accumulated knowledge base
├── NEXT_PROMPT.md       # Handoff prompt for next session
├── status.json          # Machine-readable status
├── .session_start       # Timestamp marker for freshness checks
├── .session_count       # Current session number
├── .active_relay        # Lock marker (relay is running)
├── .lock                # PID-based mutex
└── logs/
    ├── relay.log                    # Full relay log
    ├── session_1_progress.md        # Archived state per session
    ├── session_1_knowledge.md
    ├── session_1_next_prompt.md
    └── session_1_prompt.md
```

## Architecture

```
src/
├── index.ts                 Entry point
├── cli.ts                   CLI parsing (Commander) — run + continue subcommands
├── config.ts                CleaveConfig interface + defaults
├── relay-loop.ts            Main session relay orchestrator
├── session.ts               TUI (subprocess) + headless (Agent SDK) runners
├── hooks.ts                 Stop hook enforcement (shell + programmatic)
├── state/
│   ├── files.ts             .cleave/ directory I/O + continuation reset
│   ├── knowledge.ts         Knowledge accumulation + compaction
│   └── status.ts            status.json management
├── detection/
│   ├── completion.ts        Completion marker detection in PROGRESS.md
│   ├── loops.ts             Line-similarity loop detection (>85% threshold)
│   └── verify.ts            External verification command runner
├── integrations/
│   ├── git.ts               Auto-commit per session
│   ├── notify.ts            Desktop notifications (macOS + Linux)
│   └── archive.ts           Session file archiving to logs/
└── utils/
    ├── logger.ts            Colored, dual-output logging
    ├── lock.ts              PID-based file mutex
    └── prompt-builder.ts    Session prompt construction + handoff instructions
```

## Safety Features

- **Stop hook enforcement** — Claude cannot exit without completing the handoff
- **Loop detection** — Stops after 3 consecutive sessions with >85% similar handoffs
- **Crash recovery** — Stops after 3 consecutive non-zero exits (excluding rate limits)
- **Rate limit handling** — Automatically waits with countdown and retries
- **File lock** — PID-based mutex prevents concurrent cleave runs in the same directory
- **Verification command** — Objective completion check via external command (e.g., `npm test`)

## Editions

Cleave has evolved through three editions:

| Edition | Version | Architecture | Use Case |
|---------|---------|-------------|----------|
| **Shell** | v2 | Bash script | Simple relay, instruction-only enforcement |
| **Plugin** | v3 | Claude Code plugin | Shell-based hook enforcement |
| **SDK** | v4.2 | TypeScript + Agent SDK | Full orchestration, TUI + headless, programmatic hooks |

The SDK (v4.2) is the current recommended edition. It provides the most reliable handoff enforcement, knowledge compaction, and both interactive and programmatic modes.

### What Changed from v2/v3

| | v2 (Shell) | v3 (Plugin) | **v4 (SDK)** |
|:---|:---|:---|:---|
| **Engine** | Bash subprocess | Claude Code plugin | **TypeScript + Agent SDK** |
| **Hooks** | Instructions only | Shell scripts | **Async functions + shell** |
| **Rate limits** | Grep output text | Grep output text | **First-class SDK events** |
| **Types** | None | None | **Full TypeScript** |
| **Distribution** | Copy shell script | Symlink plugin | **`npm install -g`** |
| **Error handling** | Exit codes | Exit codes | **Structured try/catch** |

The `.cleave/` directory format is backward compatible across all editions.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `CLEAVE_MAX_SESSIONS` | Override max sessions |
| `CLEAVE_PAUSE` | Override pause seconds |
| `CLEAVE_COMPLETION_MARKER` | Override completion marker |
| `CLEAVE_SESSION` | Set by Cleave — current session number |
| `CLEAVE_WORK_DIR` | Set by Cleave — working directory |

## Requirements

- Node.js 18+
- Claude Code CLI installed and authenticated
- `@anthropic-ai/claude-agent-sdk` (installed as dependency)

## License

MIT
