# Cleave v6.4

**Infinite context for Claude Code.**

Cleave chains Claude Code sessions together with self-authored handoffs, compounding knowledge, and a real-time TUI. When one session runs low on context, it writes a briefing for the next one — lessons learned, dead ends mapped, exact resume points. Every session is smarter than the last.

```
cleave
```

That's it. The interactive wizard asks what you want done and starts the relay.

## How It Works

```
Session 1                 Session 2                 Session N
┌──────────────┐         ┌──────────────┐         ┌──────────────┐
│ Processes     │         │ Continues    │         │ Finishes     │
│ items 1-12   │────────▶│ from item 13 │────────▶│ the job      │
│              │ handoff │              │ handoff │              │
│ Writes       │         │ Inherits all │         │ N sessions   │
│ NEXT_PROMPT  │         │ knowledge    │         │ of wisdom    │
└──────────────┘         └──────────────┘         └──────────────┘
       │                        │                        │
       ▼                        ▼                        ▼
  KNOWLEDGE.md ──────── grows across all sessions ──────────▶
```

1. You describe a task (or the interactive wizard helps you define it)
2. Cleave launches Claude Code in headless mode (`claude -p --output-format stream-json`)
3. A real-time TUI shows context usage, cost, running agents, and knowledge growth
4. At budget limit, Claude writes handoff files: `PROGRESS.md`, `KNOWLEDGE.md`, `NEXT_PROMPT.md`
5. Cleave detects the handoff, archives the session, and launches a fresh one
6. The new session inherits all accumulated knowledge and picks up exactly where the last left off
7. Repeats until the task is done or max sessions reached

**The key insight:** Claude writes its own continuation prompt. It knows what it did, what worked, what failed, and exactly where to resume. No human-authored bridging needed.

## Four Modes

Cleave runs in four modes, from fully interactive to fully autonomous.

### Mode 1: Interactive (`cleave` or `cleave start`)

A setup wizard that walks you through configuration:

1. **Project folder** — where to work
2. **Task description** — what to build/fix/process
3. **Strategy** — Execute (start immediately) or Plan (ask 2-3 clarifying questions first)
4. **Max sessions** — how many sessions to chain (default: 15)
5. **Budget per session** — cost cap per session in USD equivalent (default: $5)
6. **Session mode** — Guided (pause between sessions) or Auto (no pauses)

Then it starts the relay with the TUI.

### Mode 2: Guided (`cleave run "task"`)

The default for `cleave run`. Sessions auto-chain with a **10-second countdown** between each one. During the countdown:

- **Type** to pause the countdown and inject instructions into the next session
- **Press Enter** to send your instructions and continue
- **Press S** to adjust the session limit on the fly
- **Press B** to adjust the per-session budget on the fly
- **Press Q** to quit the relay (generates a debrief report)
- **Wait** for the countdown to auto-advance

This gives you a window to course-correct without requiring constant attention. The `S` and `B` hotkeys also work during active sessions — no need to wait for the transition.

**Post-completion continuation:** When the task completes or you hit the session limit, you're not locked out. The completion screen lets you type follow-up instructions (e.g., "now add tests for those chapters") to continue in a new session, press `S` to add more sessions, or press `Q` to quit and generate a debrief report.

### Mode 3: Auto (`cleave run "task" --auto`)

Fully autonomous. Sessions chain with a 3-second countdown between each. No user input accepted. Best for well-defined tasks you trust to run unattended.

### Mode 4: Headless (`cleave run "task" --headless`)

No TUI at all. Outputs session start/end markers to the console. Designed for CI pipelines, background jobs, or remote servers where you don't need a visual interface.

### Mode Comparison

| | Interactive | Guided | Auto | Headless |
|---|---|---|---|---|
| **Command** | `cleave` | `cleave run "task"` | `cleave run "task" --auto` | `cleave run "task" --headless` |
| **Setup wizard** | Yes | No | No | No |
| **Task clarification** | Optional (Plan strategy) | No | No | No |
| **Real-time TUI** | Yes | Yes | Yes | No |
| **Pause between sessions** | 10s (guided) | 10s countdown | 3s countdown | None |
| **Inject instructions** | Yes | Yes | No | No |
| **Adjust limits mid-run** | Yes | Yes | Yes | No |
| **Human attention needed** | At setup only | Optional | None | None |
| **Best for** | First-time use, complex tasks | Most tasks | Trusted, well-defined tasks | CI/CD, remote servers |

## Installation

### Prerequisites

Cleave requires **Node.js 18+** and **Claude Code CLI**. If you already have both, skip to "Install Cleave" below.

**1. Node.js 18+**

Check if you have it: `node --version`. If it prints v18 or higher, you're good. If not:

```bash
# macOS with Homebrew:
brew install node

# macOS without Homebrew (installs nvm, then Node):
curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.0/install.sh | bash
source ~/.zshrc
nvm install 18

# Or download the installer from https://nodejs.org
```

**2. Claude Code CLI**

Check if you have it: `claude --version`. If it works, you're good. If not:

```bash
npm install -g @anthropic-ai/claude-code
claude   # follow prompts to authenticate
```

### Install Cleave

```bash
npm install -g cleave-cli
```

This installs Cleave globally and makes the `cleave` command available in your terminal.

Or run from source:

```bash
git clone https://github.com/b7069484/cleave.git
cd cleave
npm install && npm run build
npm link
```

> **Note:** The npm package is `cleave-cli`, not `cleave`. The `cleave` name on npm belongs to an unrelated project.

## Usage

```bash
# Interactive setup wizard (recommended for first run)
cleave

# Start a guided relay
cleave run "Convert all unittest files to pytest in ./tests/"

# Auto mode with custom settings
cleave run "Refactor the auth system" --auto --sessions 20 --budget 8

# Headless for CI
cleave run "Run full security audit" --headless --sessions 10

# Resume a previous relay
cleave resume

# Check relay status
cleave status
```

### Options

```
cleave start              Interactive setup wizard (default command)
cleave run <task>         Start relay with task description
cleave resume             Resume from last handoff
cleave status             Show relay status

Options for 'run':
  -s, --sessions <n>      Max sessions (default: 15)
  -b, --budget <n>        Per-session budget in USD (default: 5)
  -d, --dir <path>        Project directory (default: current dir)
  -m, --model <model>     Model to use (e.g., sonnet, opus)
  --auto                  Auto mode — no pause between sessions
  --headless              Headless mode — no TUI
  --skip-permissions      Skip Claude Code permission prompts
  --allowed-tools <t...>  Tools to allow without prompting
```

## The TUI

Cleave's real-time terminal interface shows everything that matters:

```
┌─ CLEAVE ─── Session 3/15 ─── ~/my-project ─── 4m 32s ────────────────────┐
│ Context: ████████████░░░░░░░░ 58%     Session: $3.08/$5.00  Total: $9.24 │
└───────────────────────────────────────────────────────────────────────────┘
│ [stream of Claude's activity — tool calls, file edits, agent spawns]     │
│ ...                                                                      │
│ ▶ Researching auth patterns (Explore) 12s                                │
│ ▶ Running test suite (general-purpose) 45s                               │
┌───────────────────────────────────────────────────────────────────────────┐
│ Knowledge: 8 insights · 1.4 KB core / 0.9 KB session  Handoffs: 2/14      │
│ [s] Sessions: 3/15              [b] Budget: $5.00/session                │
└───────────────────────────────────────────────────────────────────────────┘
```

- **Context bar** — real-time context window usage from Claude's token counts
- **Cost** — session cost and cumulative total (see Cost section below)
- **Stream** — live activity feed showing tool calls, text output, agent spawns
- **Running agents** — background subagents with type and elapsed time
- **Knowledge** — insight count (permanent discoveries) plus core/session KB breakdown
- **Handoffs** — successful handoff count (0/N, increments as sessions chain)
- **Limit controls** — press `S` or `B` anytime to adjust session limit or budget on the fly

## Understanding Cost

The cost displayed in Cleave's TUI comes from Claude CLI's `result` event, which reports token usage at API rates.

**If you're on a Claude Pro, Team, or Max subscription:** These numbers represent the *API-equivalent cost* of your usage — a proxy for how much subscription capacity you're consuming. **You are not charged these dollar amounts separately.** Your subscription covers the usage.

**If you're using the Anthropic API directly:** The cost numbers reflect actual API charges.

The `--budget` flag maps to Claude CLI's `--max-budget-usd`, which caps each session's token consumption to roughly that dollar equivalent. This works the same way on subscriptions — it limits how long a session runs, not what you pay.

**Rule of thumb for subscription users:** Think of the budget as a session length control, not a billing control. A $5 budget gives a session roughly 15-25 minutes of heavy tool use on Opus.

## Handoff Files

Each session writes these files to `.cleave/`:

| File | Purpose | Lifecycle |
|------|---------|-----------|
| `PROGRESS.md` | Status report — what's done, what's next, blockers | Overwritten each session |
| `KNOWLEDGE.md` | Accumulated insights — architecture decisions, patterns, tips | Grows across all sessions |
| `NEXT_PROMPT.md` | Complete briefing for the next session | Overwritten each session |
| `.handoff_signal` | `HANDOFF_COMPLETE` or `TASK_FULLY_COMPLETE` | Signal file, cleared between sessions |

**KNOWLEDGE.md** is the key to Cleave's compounding intelligence. It has two sections:
- **Core Knowledge** — permanent insights as a numbered list (architecture decisions, key patterns, important file paths). Claude is instructed to only append new numbered items, never restructure.
- **Session Log** — per-session work summaries

The knowledge file is compacted between sessions to stay within a reasonable size, keeping the most recent session logs and all core knowledge.

## Architecture

```
src/
├── cli.ts              # Commander CLI — 4 modes
├── index.ts            # Entry point
├── relay/
│   ├── config.ts       # RelayConfig type + defaults
│   ├── loop.ts         # RelayLoop — session chaining engine
│   ├── session.ts      # SessionRunner — spawns claude -p
│   ├── handoff.ts      # Handoff detection + rescue generation
│   ├── prompt-builder.ts # Builds session prompts + handoff instructions
│   └── debrief.ts      # Debrief report data collection + prompt builder
├── state/
│   ├── files.ts        # CleaveState — file I/O for .cleave/
│   └── knowledge.ts    # Knowledge compaction
├── stream/
│   ├── parser.ts       # StreamParser — NDJSON → typed events (stateful dedup)
│   └── types.ts        # Event type definitions
└── tui/
    ├── App.tsx                # Main app — routes between phases
    ├── StartupApp.tsx         # Interactive setup wizard
    ├── Header.tsx             # Session info, context bar, cost
    ├── StreamView.tsx         # Live activity feed
    ├── Footer.tsx             # Knowledge metrics, handoff counter, limit controls
    ├── CompletionTransition.tsx # Post-completion screen (follow-up, add sessions, quit)
    ├── LimitOverlay.tsx       # Dynamic session/budget limit adjustment overlay
    ├── Transition.tsx         # Between-session countdown + input
    └── useRelay.ts            # React hook — connects TUI to RelayLoop
```

## Comparison with Other Tools

### vs. Other Session Continuity Tools

| Capability | Manual | Ralph Wiggum | GSD | auto-resume | Session Memory | **Cleave v6** |
|---|---|---|---|---|---|---|
| No human in the loop | No | Yes | Yes | Yes | No | **Yes** |
| Agent writes own handoff | No | No | No | No | Partial | **Yes** |
| Knowledge compounds | No | No | Partial | No | Partial | **Yes** |
| Fresh context each session | Yes | No | Yes | Partial | Yes | **Yes** |
| Real-time TUI | No | No | No | No | No | **Yes** |
| Multiple run modes | No | No | No | No | No | **4 modes** |
| Task clarification | No | No | No | No | No | **AI-powered** |
| Rate limit resilience | No | Partial | No | Yes | No | **Yes** |
| Mid-relay prompt injection | No | No | No | No | No | **Yes** |
| Dynamic limit adjustment | No | No | No | No | No | **Yes** |
| Crash recovery | No | No | Partial | No | No | **Yes** |
| Full audit trail | No | No | Partial | No | No | **Yes** |

### vs. Context Window Workarounds

| Approach | How it works | Limitation | Cleave advantage |
|---|---|---|---|
| **Longer context windows** | Bigger model context | Quality degrades past 50% usage | Fresh context each session |
| **Summarization** | Compress old context | Lossy — details lost | Full knowledge file preserved |
| **RAG / embeddings** | Retrieve relevant chunks | Requires setup, misses connections | Agent decides what matters |
| **Manual restart** | Human writes new prompt | Tedious, error-prone, doesn't scale | Fully automated handoffs |

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| **Cost accumulation** | Set `--sessions` and `--budget` caps. Start with 3-5 sessions to test. |
| **Permission bypass** | `--skip-permissions` lets Claude run any command. Use git branches for safety. |
| **Handoff quality varies** | Crash recovery falls back to initial prompt + PROGRESS + KNOWLEDGE. Check first 2-3 sessions. |
| **Rate limits** | Cleave detects rate limits and continues. On free tiers, long runs may stall. |
| **Agent goes off-track** | Check logs after first few sessions. Use guided mode to course-correct. |
| **Knowledge file grows large** | Auto-compacted between sessions. Core knowledge preserved, old session logs trimmed. |

## Files Created

```
your-project/
└── .cleave/
    ├── PROGRESS.md                 # Current status
    ├── KNOWLEDGE.md                # Accumulated knowledge
    ├── NEXT_PROMPT.md              # Next session's prompt
    ├── .handoff_signal             # Handoff/completion signal
    ├── .session_count              # Current session number
    ├── .session_start              # Session start timestamp
    ├── .max_sessions               # Persisted session limit (from dynamic adjustment)
    ├── .session_budget             # Persisted budget limit (from dynamic adjustment)
    ├── DEBRIEF.md                  # Post-run debrief report (generated on quit)
    └── logs/
        ├── events.log              # TUI event log
        ├── session_1_progress.md   # Archived per-session files
        ├── session_1_knowledge.md
        ├── session_1_next_prompt.md
        └── ...
```

Add `.cleave/` to your `.gitignore`.

## License

MIT
