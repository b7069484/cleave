# cleave (Plugin Edition)

**Infinite context for Claude Code — now as a native plugin.**

Chain sessions together automatically. Each session writes its own continuation prompt. The plugin enforces handoff behavior through hooks, skills, and slash commands. You get the full interactive TUI back.

## What Changed from v2 (Shell Script)

| | v2 (Shell) | v3 (Plugin) |
|:---|:---|:---|
| **Claude runs as** | Piped subprocess (no TUI) | Interactive mode (full TUI) |
| **Handoff enforcement** | Instructions Claude follows on faith | Stop hook blocks exit until files written |
| **Handoff protocol** | Appended to every prompt | Skill auto-activates |
| **User commands** | None | `/handoff`, `/status`, `/resume` |
| **Outer loop** | 780-line bash script | ~250-line thin launcher |
| **Context bar** | Hidden | Visible |

Everything else is preserved: knowledge accumulation, loop detection, rate limit handling, git commits, verification commands, desktop notifications.

## Quick Start

```bash
# Clone/download
git clone https://github.com/YOUR_REPO/cleave-plugin.git
cd cleave-plugin

# Install
./setup.sh

# Run
./cleave my_task.md
```

### If Stop hooks aren't firing (known Claude Code bug)

```bash
# Install hooks directly into ~/.claude/settings.json
./setup.sh --install-hooks
```

This is a workaround for [Claude Code issue #10412](https://github.com/anthropics/claude-code/issues/10412) where Stop hooks don't work correctly via the plugin system.

## Plugin Structure

```
cleave-plugin/
├── .claude-plugin/
│   └── plugin.json              # Plugin manifest
├── skills/
│   └── session-relay/
│       └── SKILL.md             # Handoff protocol (auto-invoked)
├── commands/
│   ├── handoff.md               # /handoff — force immediate handoff
│   ├── status.md                # /status — show relay progress
│   └── resume.md                # /resume — continue from last handoff
├── hooks/
│   └── hooks.json               # Stop + SessionStart hooks
├── scripts/
│   ├── stop-check.sh            # Stop hook: enforce handoff before exit
│   ├── session-start.sh         # SessionStart hook: timestamp session
│   ├── compact-knowledge.sh     # Prune KNOWLEDGE.md session log
│   └── loop-detect.sh           # Detect stuck handoff loops
├── cleave                       # Thin launcher (outer loop)
├── setup.sh                     # Install/uninstall script
└── README.md
```

## How It Works

### The Plugin Components

**Session Relay Skill** — Contains the complete handoff protocol: context budget model, 4-step handoff procedure, knowledge management rules, and subagent strategy. Auto-activates when Claude detects it's in a relay session. This replaces the giant instruction block that v2 appended to every prompt.

**Stop Hook** — Fires when Claude tries to finish responding. Checks: (1) Is this an active relay session? (2) Were PROGRESS.md, KNOWLEDGE.md, and NEXT_PROMPT.md updated since the session started? If not, blocks the exit (exit code 2) and tells Claude what files are missing. This is the enforcement mechanism v2 lacked.

**SessionStart Hook** — Timestamps when each session begins, so the Stop hook can distinguish "files updated this session" from "stale files from last session."

**Slash Commands:**
- `/handoff` — Force an immediate handoff (useful when you're stuck or want to restart with a different approach)
- `/status` — Dashboard showing progress, knowledge base size, session history
- `/resume` — Read NEXT_PROMPT.md + KNOWLEDGE.md and continue from where the last session left off

### The Outer Loop

The `cleave` launcher script is now just a session manager:

1. Initialize `.cleave/` directory and marker files
2. Build the prompt (first session: user's file; later: NEXT_PROMPT.md)
3. Launch `claude --plugin cleave-plugin --prompt "..."` in interactive mode
4. When Claude exits: archive files, check completion, detect loops, compact knowledge
5. If not done: pause, then repeat from step 2

The critical difference: Claude Code runs interactively with full TUI. You see the context bar, streaming output, everything. The handoff logic lives inside the plugin where it's actually enforced, not in instructions that Claude might forget.

## Usage

```bash
# Basic relay
./cleave my_task.md

# More sessions, different working directory
./cleave --max-sessions 20 -d ./my-project task.md

# With git checkpoints and verification
./cleave --git-commit --verify "pytest tests/ -x" -m 15 task.md

# Resume from session 5
./cleave --resume-from 5 my_task.md

# All options
./cleave --help
```

### Slash Commands (During a Session)

```
/handoff          Force handoff now
/status           Show relay progress dashboard
/resume           Read handoff files and continue
```

## Options

```
  -m, --max-sessions N      Maximum sessions (default: 10)
  -d, --work-dir DIR        Working directory (default: .)
  -p, --pause N             Seconds between sessions (default: 10)
  -c, --completion-marker   Completion string (default: ALL_COMPLETE)
  -g, --git-commit          Auto-commit after each session
      --no-notify           Disable desktop notifications
  -r, --resume-from N       Resume from session N
      --verify CMD          Verify completion (exit 0 = done)
      --safe-mode           Require permission prompts
      --plugin-dir DIR      Path to plugin directory
  -v, --verbose             Detailed logging
```

## Installation

### Standard Install

```bash
./setup.sh
```

This symlinks the plugin to `~/.claude/plugins/cleave` so Claude Code can find it.

### With Direct Hooks (Recommended)

```bash
./setup.sh --install-hooks
```

Also installs Stop and SessionStart hooks directly into `~/.claude/settings.json`. This is the most reliable approach until the plugin hook bugs are fixed.

### Uninstall

```bash
./setup.sh --uninstall
```

### Add to PATH (Optional)

```bash
sudo ln -sf $(pwd)/cleave /usr/local/bin/cleave
```

## Migrating from v2

The `.cleave/` directory format is identical. Your existing PROGRESS.md, KNOWLEDGE.md, and NEXT_PROMPT.md files work as-is. Just point the v3 launcher at your project:

```bash
cd my-project
/path/to/cleave-plugin/cleave --resume-from 8 original_prompt.md
```

## Known Issues

- **Stop hooks via plugins (issue #10412):** Exit code 2 may not work correctly when hooks are loaded through the plugin system. Workaround: use `./setup.sh --install-hooks` to install hooks directly into settings.json.
- **Plugin hook JSON output (issue #10875):** JSON output from plugin hooks may not be parsed. The Stop hook uses stderr + exit code 2 instead of JSON for this reason.

## License

MIT
