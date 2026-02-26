# cleave

**Auto-relay for long-running Claude Code tasks that exceed a single context window.**

Claude Code is powerful but has a finite context window. When a task requires more context than one session can hold — processing hundreds of files, researching across dozens of topics, refactoring a large codebase — you hit a wall at ~70% context and have to manually restart with a new prompt.

`cleave` solves this by chaining sessions together automatically. Each session writes a handoff briefing for the next one. The relay script reads it and launches a fresh session. Your task runs to completion while you sleep.

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
2. `cleave` launches Claude Code with your prompt + handoff instructions
3. At ~60% context, Claude Code stops productive work and writes:
   - `PROGRESS.md` — status flag and crash recovery breadcrumb
   - `KNOWLEDGE.md` — promotes durable insights to Core, appends session notes to Session Log
   - `NEXT_PROMPT.md` — bespoke continuation prompt (written by Claude Code itself, with full context of what it learned)
4. The handoff writing happens in the 60–70% buffer zone (structured output that tolerates mild quality decline)
5. `cleave` detects the exit, reads `NEXT_PROMPT.md`, launches a fresh session
6. Repeats until the task is done or max sessions reached

**The key insight:** Claude Code writes its own continuation prompt. It knows what it did, what worked, what failed, and exactly where to resume. No human-authored bridging needed.

## Installation

```bash
# Download
curl -O https://raw.githubusercontent.com/YOUR_REPO/cleave/main/cleave
chmod +x cleave

# Or clone
git clone https://github.com/YOUR_REPO/cleave.git
cd cleave
chmod +x cleave

# Optional: add to PATH
sudo cp cleave /usr/local/bin/
```

**Requirements:**
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed and on your `PATH`
- Bash 4+ (macOS: `brew install bash` if needed)

## Quick Start

### 1. Write your initial prompt

Create a file describing your task. Be specific about what needs to be done, where the files are, and what "done" looks like.

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

### 2. Run the relay

```bash
cleave my_task.md
```

That's it. Walk away. Come back when it's done.

### 3. Check progress

```bash
# While running (in another terminal)
cat .cleave/PROGRESS.md

# After completion
cat .cleave/PROGRESS.md
ls .cleave/logs/   # Full history of every session
```

## Options

```
cleave [options] <prompt-file>

Options:
  -m, --max-sessions N        Max sessions before stopping (default: 10)
  -d, --work-dir DIR          Working directory for Claude Code (default: .)
  -p, --pause N               Seconds between sessions (default: 10)
  -c, --completion-marker STR String in PROGRESS.md signaling done (default: ALL_COMPLETE)
  -g, --git-commit            Auto-commit to git after each session
      --no-notify             Disable desktop notifications
  -r, --resume-from N         Resume from session N (skips earlier sessions)
  -v, --verbose               Detailed logging
  -h, --help                  Show help
      --version               Show version
```

## Examples

### Large codebase refactoring
```bash
cleave --max-sessions 20 -d ./my-project refactor_prompt.md
```

### Data processing pipeline
```bash
cleave --max-sessions 30 -c "ALL_FILES_PROCESSED" data_pipeline_prompt.md
```

### Research and download task
```bash
cleave --max-sessions 15 -d ./research-project research_prompt.md
```

### Resume after interruption
```bash
# Just run again — it picks up from .cleave/NEXT_PROMPT.md
cleave my_task.md
```

## What Gets Created

```
your-project/
├── .cleave/
│   ├── PROGRESS.md              # Current status (updated each session)
│   ├── NEXT_PROMPT.md           # Continuation prompt (written by Claude Code)
│   ├── KNOWLEDGE.md             # Two-section knowledge base (Core + rolling Session Log)
│   ├── status.json              # Machine-readable status (for monitoring tools)
│   └── logs/
│       ├── relay.log            # Relay script log
│       ├── session_1_prompt.md  # What session 1 received
│       ├── session_1_progress.md # What session 1 reported
│       ├── session_1_next_prompt.md # What session 1 wrote for session 2
│       ├── session_1_knowledge.md   # Knowledge snapshot after session 1
│       ├── session_2_prompt.md
│       └── ...
```

## Key Concepts

### Self-Authored Handoffs
Each session writes `NEXT_PROMPT.md` — the exact prompt for the next session. This isn't a generic template. It's a bespoke briefing that includes where to resume, what worked, what failed, and accumulated context. Each session is smarter than the last.

### Knowledge Accumulation (KNOWLEDGE.md)
`NEXT_PROMPT.md` gets replaced each session. `KNOWLEDGE.md` persists — but it's structured to prevent unbounded growth:

- **`## Core Knowledge`** — Permanent insights every session needs (API configs, working search terms, critical discoveries). Claude is instructed to promote durable findings here. This section is never pruned.
- **`## Session Log`** — Session-specific notes (`### Session N — [Date]` entries). The relay script **auto-prunes** this to the last 5 sessions before each run, preventing stale context from consuming the context window.

This means session 30 gets the permanent wisdom from session 1 (promoted to Core) without wading through 29 sessions of ephemeral notes.

### Rate Limit Handling
If Claude Code exits due to a rate limit, the relay detects it (parsing output for "usage limit" / "rate limit" messages), waits with a countdown timer, then retries the same session. No session is wasted on a rate limit exit. Inspired by [claude-auto-resume](https://github.com/terryso/claude-auto-resume).

### Loop Detection
If consecutive sessions write near-identical `NEXT_PROMPT.md` files (>85% similar lines), the relay warns you. After 3 consecutive loops, it stops to prevent wasting tokens on a stuck agent. This catches cases where Claude Code doesn't know how to proceed and just restates the same prompt.

### Git Integration
With `--git-commit`, the relay runs `git add -A && git commit` after each session. This gives you per-session snapshots you can roll back to if something goes wrong. Commits are tagged `cleave: session #N checkpoint`.

### Desktop Notifications
On macOS (via `osascript`) and Linux (via `notify-send`), you get alerts for:
- Task completion
- Rate limit waits
- Loop detection
- Max sessions reached

Disable with `--no-notify`.

### Machine-Readable Status
`status.json` is updated in real-time with current session number, status, and timestamp. External monitoring tools or dashboards can poll this file.

### Verification Commands (Ralph Wiggum Philosophy)
Don't trust the agent's self-assessment. Verify objectively. With `--verify`, you provide a command that checks if the work is actually done:

```bash
# For coding tasks: tests must pass
cleave --verify "pytest ./tests/ -x" task.md

# For data processing: check output count
cleave --verify "python check_outputs.py" task.md

# For image research: every module must have images
cleave --verify "python verify_images.py" task.md
```

If the command exits 0, the task is done — regardless of what Claude Code claims in PROGRESS.md. If it exits non-zero, the relay continues. This is inspired by Ralph Wiggum's "completion promise" pattern: objective verification beats self-assessment.

### Subagent Spawning (GSD Pattern)
With `--subagents`, the relay hints Claude Code to spawn fresh `claude -p` subagents for heavy subtasks. This keeps the main session lean (~15-30% context) while subagents each get a full 200K context window. Particularly useful for tasks that process many independent files or items.

### Dual Context Threshold
Cleave uses a two-phase approach based on GSD framework research on context quality degradation:

- **0–60%** — Productive work zone (peak quality through early decline)
- **60%** — Stop productive work, begin handoff writing
- **60–70%** — Handoff zone (structured/formulaic output tolerates mild quality loss)
- **70%+** — Danger zone, never reach this

This gives each session ~20% more productive capacity than a single "bail at 50%" threshold, while keeping handoff writing safely in the buffer zone.

## Writing Good Initial Prompts

The quality of the relay depends on Claude Code understanding the task well enough to write good handoffs. Tips:

1. **Be specific about the scope.** "Process all 200 CSV files in ./data/" is better than "process the data."

2. **Define what "done" means.** Claude Code needs to know when to write `ALL_COMPLETE`.

3. **Describe the file structure.** Tell Claude Code where inputs are, where outputs go, and what tools/scripts exist.

4. **Mention existing scripts.** If you have helper scripts, list them with their functions so Claude Code doesn't rebuild them.

5. **Set quality expectations.** "Try 3 search queries before marking a screen as unfound" is better than "search thoroughly."

### Prompt Template

```markdown
# Task Description
[What needs to be done, in detail]

# Project Structure
[Where files are, what exists, what tools are available]

# Workflow Per Item
[Step-by-step for processing each unit of work]

# Quality Standards
[What "good enough" looks like, when to skip vs. retry]

# Starting Point
[Where to begin — or check PROGRESS.md if resuming]
```

## How the Handoff Works

The relay appends these instructions to your prompt automatically:

> When you reach ~60% context:
> 1. STOP productive work
> 2. Update `.cleave/PROGRESS.md` with status
> 3. Update `.cleave/KNOWLEDGE.md` — promote durable insights to Core, append session notes
> 4. Write `.cleave/NEXT_PROMPT.md` — the exact prompt for the next session
> 5. Print `RELAY_HANDOFF_COMPLETE` and stop
>
> Complete all handoff writing before 70% context (hard wall).

Claude Code's `NEXT_PROMPT.md` typically includes:
- Full task context (for the fresh session that has no memory)
- Exactly where to resume
- What it learned (search terms that work, bugs it fixed, patterns it noticed)
- Warnings about dead ends or things to skip
- The same handoff instructions (so the chain continues)

This means each session gets **smarter** — it inherits the accumulated knowledge of all prior sessions through the handoff chain.

## Troubleshooting

### Claude Code doesn't write NEXT_PROMPT.md
The relay falls back to your initial prompt + whatever PROGRESS.md contains. This works but isn't as precise. Make sure your initial prompt is detailed enough to be useful on its own.

### Sessions end too early / too late
Claude Code estimates its own context usage. If it's cutting off too early, you can raise `HANDOFF_THRESHOLD` (default: 50). If it's running out of context before handing off, lower it to 40%.

### Claude Code keeps rebuilding scripts
Add this to the top of your prompt:
```
IMPORTANT: Scripts already exist in ./scripts/. DO NOT create new ones.
Use the existing scripts: [list them with key functions]
```

### Task seems stuck in a loop
Check `.cleave/logs/` — compare consecutive `NEXT_PROMPT.md` files. If they're nearly identical, Claude Code may be stuck. Modify the initial prompt with more specific instructions about the stuck point.

## Safety & Contingencies

### Cost Runaway
Each session uses API tokens. An Opus session can cost $5–15+. A 15-session relay could cost $75–225.
- **Mitigation:** Always set `--max-sessions` to a reasonable cap. Start with 3–5 to test before going to 15+.
- **Monitoring:** Check `status.json` or `relay.log` from another terminal to see where you are.

### Destructive Commands
`--dangerously-skip-permissions` means Claude Code can delete files, overwrite code, run any command.
- **Mitigation:** Use `--git-commit` so every session is checkpointed. Roll back with `git revert` if needed.
- **Best practice:** Run in a feature branch, not on `main`.

### Agent Goes Off-Track
Claude Code might misinterpret the task and start doing something unrelated.
- **Mitigation:** Loop detection catches identical handoffs. Check logs after the first 2–3 sessions.
- **Recovery:** Kill the relay (Ctrl+C), review `.cleave/logs/`, fix the prompt, and `--resume-from N`.

### Rate Limit Storms
If you're on a free tier or low-rate plan, sessions may repeatedly hit limits.
- **Mitigation:** The relay auto-waits up to 5 hours for rate limits. Use `--pause 60` for longer gaps between sessions.

### KNOWLEDGE.md Core Section Grows Large
Over many sessions, Core Knowledge might accumulate redundant entries if Claude over-promotes.
- **Mitigation:** Manually review `## Core Knowledge` periodically and trim redundancies. The Session Log is auto-pruned — only Core requires manual curation.

### Session Crashes Without Handoff
If Claude Code crashes, NEXT_PROMPT.md may not be written.
- **Mitigation:** The relay falls back to your initial prompt + PROGRESS.md + KNOWLEDGE.md. Not as precise as a handoff, but the task continues.

## .gitignore

Add to your `.gitignore`:
```
.cleave/
```

The relay state is local to your machine and shouldn't be committed (it contains session logs and potentially large prompt files).

## How is this different from X?

| Tool | What it does | What it doesn't do |
|------|-------------|-------------------|
| **Manual restart** | You read output, write new prompt, paste it | Requires a human. Doesn't scale. |
| **[Ralph Wiggum loops](https://github.com/ruvnet/claude-flow)** | Runs Claude Code against a plan file until tests pass | Designed for coding tasks. No structured handoffs. Same generic prompt each loop. |
| **[claude-auto-resume](https://github.com/terryso/claude-auto-resume)** | Waits for rate limits, then resumes | Doesn't manage context between sessions. No handoff. |
| **[autonomous-skill](https://github.com/feiskyer/claude-code-settings)** | Task checklist + loop with dual-agent pattern | Same executor prompt every session. No accumulated knowledge. Requires plugin install. |
| **[claude-session-init](https://github.com/anombyte93/claude-session-init)** | Persistent context files across sessions | Focused on remembering, not continuing a specific task. |
| **Claude Session Memory** | Auto-recalls past sessions passively | Passive recall, not active task continuation. No handoff authoring. |
| **Claude Code Tasks** | Persistent task lists with dependencies | Checklist management. Doesn't write continuation prompts. |
| **cleave** | Agent writes its own continuation + knowledge compounds | — |

**We stand on the shoulders of giants.** Rate limit detection is inspired by `claude-auto-resume`. Knowledge accumulation draws from `claude-session-init`'s philosophy. The verification-first approach and completion signals come from Ralph Wiggum's "completion promise" pattern. The dual context threshold and subagent spawning are informed by GSD's context rot research. The key innovation is combining self-authored handoffs with persistent knowledge, objective verification, and rate limit resilience in a zero-dependency shell script.

## License

MIT
