# cleave

**Infinite context for Claude Code.**

Claude Code is powerful but has a finite context window. When a task requires more context than one session can hold — processing hundreds of files, researching across dozens of topics, refactoring a large codebase — you hit a wall at ~70% context and have to manually restart with a new prompt.

Cleave solves this by chaining sessions together automatically. Each session writes a handoff briefing for the next one. A fresh session reads it and picks up exactly where the last one left off. Your task runs to completion while you sleep.

## How It Works

```
┌─────────────┐     ┌─────────────────┐     ┌─────────────┐
│  Session 1   │────▶│  NEXT_PROMPT.md  │────▶│  Session 2   │──▶ ...
│              │     │  (written by     │     │              │
│  Processes   │     │   Session 1)     │     │  Continues   │
│  items 1-10  │     │                  │     │  items 11-20 │
│              │     │  "Start from     │     │              │
│  Writes      │     │   item 11.       │     │  Writes      │
│  handoff at  │     │   X works well.  │     │  handoff at  │
│  ~60% ctx    │     │   Avoid Y."      │     │  ~60% ctx    │
└─────────────┘     └─────────────────┘     └─────────────┘
```

1. You write an initial prompt describing your task
2. Cleave launches Claude Code with your prompt + handoff instructions
3. At ~60% context, Claude stops productive work and writes:
   - `PROGRESS.md` — status and exact stop point
   - `KNOWLEDGE.md` — promotes durable insights to Core, appends session notes
   - `NEXT_PROMPT.md` — bespoke continuation prompt (written by Claude with full context)
4. The handoff writing happens in the 60–70% buffer zone (structured output that tolerates mild quality decline)
5. Cleave detects the exit, reads `NEXT_PROMPT.md`, launches a fresh session
6. Repeats until the task is done or max sessions reached

**The key insight:** Claude writes its own continuation prompt. It knows what it did, what worked, what failed, and exactly where to resume. No human-authored bridging needed.

## Three Editions

Cleave comes in three editions. Same relay protocol, same `.cleave/` directory format, same handoff files. Pick the one that fits how you work.

| | Shell | Plugin | SDK |
|:---|:---|:---|:---|
| **Version** | v2 | v4.2 | v4.2 |
| **What it is** | Single bash script | Claude Code native plugin | TypeScript npm package |
| **Install** | `chmod +x cleave` | `./setup.sh` | `npm install -g cleave-sdk` |
| **Handoff enforcement** | Instructions only | Stop hook (blocks exit) | Stop hook + async TypeScript |
| **User interface** | Piped output | Full TUI + slash commands | TUI or headless |
| **Slash commands** | — | `/handoff` `/status` `/resume` `/continue` | — |
| **`continue` command** | — | `/continue` | `cleave continue "new task"` |
| **Automated relay** | Built-in loop | Manual (`/resume`) or pair with SDK | Built-in loop |
| **Agent definition** | — | Relay orchestrator agent | — |
| **Best for** | Zero dependencies, fire-and-forget | Interactive use, manual control | Full automation, programmatic |

All three editions read and write the same `.cleave/` directory. You can start a task with the SDK, check on it with the Plugin's `/status`, and the files are interchangeable.

### Shell Edition

Zero dependencies. One bash script. Drop it anywhere.

```bash
chmod +x cleave
./cleave my_task.md
```

Walk away. Come back when it's done. Supports max sessions, git commits, verification commands, rate limit handling, loop detection, desktop notifications. Everything in ~800 lines of bash.

```bash
./cleave --max-sessions 20 -d ./my-project task.md          # Large job
./cleave --git-commit --verify "pytest tests/ -x" task.md    # With safety nets
./cleave --resume-from 5 my_task.md                          # Pick up from session 5
```

### Plugin Edition

Native Claude Code plugin with hooks, skills, and slash commands.

```bash
cd cleave-plugin-v4
./setup.sh                    # Symlink to ~/.claude/plugins/cleave
./setup.sh --install-hooks    # Also install hooks directly (recommended)

claude --plugin cleave        # Start Claude with Cleave active
```

The plugin gives you:
- **Stop hook** — blocks Claude from exiting until handoff files are written
- **Session-relay skill** — auto-invoked handoff protocol with configurable thresholds
- **Slash commands** — `/handoff` (force handoff), `/status` (dashboard), `/resume` (continue from handoff), `/continue` (new task, same knowledge)
- **Relay orchestrator agent** — agent definition for automated mode

Use the plugin for interactive work where you want to see the TUI, use slash commands, and have hooks enforce the handoff. Pair with the SDK for automated relay or use `/resume` manually between sessions.

### SDK Edition

TypeScript package with full orchestration. Install from npm.

```bash
npm install -g cleave-sdk

cleave my-task.md                                    # TUI mode (default)
cleave my-task.md --no-tui                           # Headless mode
cleave my-task.md -m 20 --verify "npm test"          # With limits + verification
cleave continue "Now add rate limiting" -d ./project  # Chain a new task
```

The SDK provides:
- **TUI mode** — spawns Claude with full interactive interface, hooks via generated settings JSON
- **Headless mode** — uses the Agent SDK `query()` API for programmatic control
- **`cleave continue`** — start a new task that builds on accumulated knowledge
- **Crash recovery** — stops after 3 consecutive non-zero exits
- **File locking** — PID-based mutex prevents concurrent runs
- **Full TypeScript** — structured error handling, typed config, async hooks

## Quick Start

### 1. Write your initial prompt

Create a file describing your task. Be specific about scope, file locations, and what "done" means.

```markdown
<!-- my_task.md -->
You are refactoring a Python codebase from unittest to pytest.

The codebase is in ./src/ and tests are in ./tests/.
There are 847 test files that need to be converted.

For each file:
1. Replace unittest.TestCase classes with plain test functions
2. Replace self.assertEqual with assert statements
3. Replace setUp/tearDown with pytest fixtures
4. Run the converted test to verify it passes

Start from ./tests/test_auth/ and work alphabetically.
```

### 2. Run it

```bash
# Shell
./cleave my_task.md

# Plugin (manual relay)
claude --plugin cleave
# then type /resume between sessions

# SDK
cleave my_task.md
```

### 3. Check progress

```bash
cat .cleave/PROGRESS.md            # Current status
cat .cleave/KNOWLEDGE.md           # Accumulated knowledge
ls .cleave/logs/                   # Full session history
```

## The `.cleave/` Directory

All editions use the same directory structure.

```
your-project/
├── .cleave/
│   ├── PROGRESS.md              # Current status (updated each session)
│   ├── NEXT_PROMPT.md           # Continuation prompt (written by Claude)
│   ├── KNOWLEDGE.md             # Core Knowledge (permanent) + Session Log (rolling)
│   ├── status.json              # Machine-readable status
│   ├── .active_relay            # Marker: relay in progress
│   ├── .session_start           # Marker: current session start time
│   ├── .session_counter         # Current session number
│   └── logs/
│       ├── relay.log            # Relay log
│       ├── session_1_prompt.md
│       ├── session_1_progress.md
│       ├── session_1_next_prompt.md
│       ├── session_1_knowledge.md
│       └── ...
```

## Key Concepts

### Self-Authored Handoffs

Each session writes `NEXT_PROMPT.md` — the exact prompt for the next session. This isn't a generic template. It's a bespoke briefing that includes where to resume, what worked, what failed, and accumulated context. Each session is smarter than the last.

### Knowledge Accumulation

`NEXT_PROMPT.md` gets replaced each session. `KNOWLEDGE.md` persists — but it's structured to prevent unbounded growth:

- **`## Core Knowledge`** — Permanent insights every session needs (API configs, working search terms, critical discoveries). Claude is instructed to promote durable findings here. Never pruned.
- **`## Session Log`** — Session-specific notes (`### Session N — [Date]` entries). Auto-pruned to the last 5 entries, preventing stale context from consuming the context window.

Session 30 gets the permanent wisdom from session 1 (promoted to Core) without wading through 29 sessions of ephemeral notes.

### Dual Context Threshold

Cleave uses a two-phase approach based on research into context quality degradation:

- **0–60%** — Productive work zone
- **60%** — Stop productive work, begin handoff writing
- **60–70%** — Handoff zone (structured output tolerates mild quality loss)
- **70%+** — Danger zone, never reach this

This gives each session ~20% more productive capacity than a single "bail at 50%" threshold.

### Stop Hook Enforcement

The Plugin and SDK editions enforce handoffs with a Stop hook. When Claude tries to exit, the hook checks whether all three handoff files were written this session. If not, it blocks the exit (exit code 2) and tells Claude what's missing. The Shell edition relies on instructions alone — Claude usually complies, but the hook is a safety net.

### Rate Limit Handling

If Claude exits due to a rate limit, the relay detects it, waits with a countdown timer, then retries the same session. No session is wasted on a rate limit exit.

### Loop Detection

If consecutive sessions write near-identical `NEXT_PROMPT.md` files (>85% similar lines), the relay warns you. After 3 consecutive loops, it stops to prevent wasting tokens on a stuck agent.

### Verification Commands

Don't trust the agent's self-assessment. Verify objectively:

```bash
cleave --verify "pytest ./tests/ -x" task.md            # Tests must pass
cleave --verify "python check_outputs.py" task.md        # Custom check
```

If the command exits 0, the task is done — regardless of what Claude claims in PROGRESS.md.

### Subagent Strategy

For tasks with many independent items, Claude can spawn fresh subagents (`claude -p "..."`) for heavy subtasks. Each subagent gets a full 200K context window. The main session stays lean at ~15-30% context, extending effective capacity before handoff.

## Writing Good Prompts

The quality of the relay depends on Claude understanding the task well enough to write good handoffs:

1. **Be specific about scope.** "Process all 200 CSV files in ./data/" beats "process the data."
2. **Define what "done" means.** Claude needs to know when to write `ALL_COMPLETE`.
3. **Describe the file structure.** Where inputs are, where outputs go, what tools exist.
4. **Mention existing scripts.** List them with their functions so Claude doesn't rebuild them.
5. **Set quality expectations.** "Try 3 search queries before marking as unfound" beats "search thoroughly."

## Safety & Cost

### Cost

Each session uses API tokens. An Opus session can cost $5–15+. A 15-session relay could cost $75–225.
- Always set `--max-sessions` to a reasonable cap
- Start with 3–5 sessions to test before going to 15+

### Destructive Commands

`--dangerously-skip-permissions` means Claude can run any command.
- Use `--git-commit` so every session is checkpointed
- Run in a feature branch, not on `main`

### Agent Goes Off-Track

- Loop detection catches identical handoffs
- Check logs after the first 2–3 sessions
- Kill the relay (Ctrl+C), review `.cleave/logs/`, fix the prompt, `--resume-from N`

## .gitignore

```
.cleave/
```

## Comparisons

| Tool | What it does | How Cleave differs |
|------|-------------|-------------------|
| **Manual restart** | You read output, write new prompt | Cleave automates this entirely |
| **[claude-auto-resume](https://github.com/terryso/claude-auto-resume)** | Waits for rate limits, resumes | No context management or handoffs |
| **[autonomous-skill](https://github.com/feiskyer/claude-code-settings)** | Task checklist with dual-agent loop | Same prompt each session, no knowledge accumulation |
| **Claude Session Memory** | Passive recall across sessions | Not active task continuation |

**We stand on the shoulders of giants.** Rate limit detection from `claude-auto-resume`. Knowledge accumulation philosophy from `claude-session-init`. Verification-first approach from Ralph Wiggum's "completion promise" pattern. Dual context threshold from GSD's context rot research. The key innovation: self-authored handoffs + persistent knowledge + enforced hooks.

## Repository Structure

```
cleave/                  # Shell edition (v2) — single bash script
cleave-plugin-v4/        # Plugin edition (v4.2) — Claude Code native plugin
cleave-sdk/              # SDK edition (v4.2) — TypeScript npm package
marketplace.json         # Plugin directory listing
```

## License

MIT
