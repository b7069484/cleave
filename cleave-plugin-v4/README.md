# cleave v4.2 (Plugin Edition)

**Infinite context for Claude Code — now with TUI mode, continue command, and SDK integration.**

Chain sessions together automatically. Each session writes its own continuation prompt, accumulates knowledge, and hands off seamlessly. The plugin enforces handoff behavior through hooks, skills, and slash commands.

## What's New in v4.2

| | v3 (Plugin) | v4.2 (Plugin + SDK) |
|:---|:---|:---|
| **`/continue` command** | Not available | Continue with new task after completion |
| **Agent definition** | None | Relay orchestrator for automated mode |
| **Handoff threshold** | Hardcoded 60% | Configurable (60% default) |
| **Knowledge guidance** | Basic | Detailed with compaction notes |
| **Crash recovery** | Not documented | Documented in skill with recovery steps |
| **SDK integration** | None | `npx cleave-sdk` for full automated relay |
| **Hook scripts** | v3 versions | SDK versions with path quoting fix |

## Quick Start

```bash
# Clone/download
git clone https://github.com/YOUR_REPO/cleave-plugin-v4.git
cd cleave-plugin-v4

# Install
./setup.sh

# Use in Claude Code
claude --plugin cleave
```

### If Stop hooks aren't firing (known Claude Code bug)

```bash
# Install hooks directly into ~/.claude/settings.json
./setup.sh --install-hooks
```

## Plugin Structure

```
cleave-plugin-v4/
├── .claude-plugin/
│   └── plugin.json              # Plugin manifest (v4.2.0)
├── skills/
│   └── session-relay/
│       └── SKILL.md             # Handoff protocol (auto-invoked)
├── agents/
│   └── relay-orchestrator/
│       └── AGENT.md             # Automated relay agent
├── commands/
│   ├── handoff.md               # /handoff — force immediate handoff
│   ├── status.md                # /status — show relay progress
│   ├── resume.md                # /resume — continue from last handoff
│   └── continue.md              # /continue — new task, same knowledge
├── hooks/
│   └── hooks.json               # Stop + SessionStart hooks
├── scripts/
│   ├── stop-check.sh            # Stop hook: enforce handoff before exit
│   ├── session-start.sh         # SessionStart hook: timestamp session
│   ├── compact-knowledge.sh     # Prune KNOWLEDGE.md session log
│   └── loop-detect.sh           # Detect stuck handoff loops
├── setup.sh                     # Install/uninstall script
├── LICENSE                      # MIT
└── README.md
```

## How It Works

### The Plugin Components

**Session Relay Skill** — Contains the complete handoff protocol: context budget model (configurable thresholds), 4-step handoff procedure, knowledge management rules, subagent strategy, and crash recovery guidance. Auto-activates when Claude detects it's in a relay session.

**Relay Orchestrator Agent** — Agent definition for automated relay mode. Describes context budget monitoring, handoff coordination, knowledge management, and error recovery behavior.

**Stop Hook** — Fires when Claude tries to finish responding. Checks: (1) Is this an active relay session? (2) Were PROGRESS.md, KNOWLEDGE.md, and NEXT_PROMPT.md updated since the session started? If not, blocks the exit (exit code 2) and tells Claude what files are missing.

**SessionStart Hook** — Timestamps when each session begins, so the Stop hook can distinguish fresh files from stale ones.

**Slash Commands:**
- `/handoff` — Force an immediate handoff (useful when stuck or changing approach)
- `/status` — Dashboard showing progress, knowledge base size, session history, mode indicator
- `/resume` — Read NEXT_PROMPT.md + KNOWLEDGE.md and continue from last handoff
- `/continue` — Start a new task while preserving accumulated knowledge (maps to `cleave continue` in SDK)

### The `.cleave/` Directory

```
.cleave/
├── PROGRESS.md         # Current status, accomplishments, stop point
├── KNOWLEDGE.md        # Core Knowledge + Session Log
├── NEXT_PROMPT.md      # Continuation prompt for next session
├── .active_relay       # Marker: relay is in progress
├── .session_start      # Marker: current session start time
├── .session_counter    # Current session number
├── status.json         # Machine-readable status (optional)
└── logs/               # Archived per-session files
    ├── session_1_progress.md
    ├── session_1_next_prompt.md
    └── relay.log
```

## Usage

### Plugin-Only Mode (Manual Relay)

Use the plugin with manual `/resume` between sessions:

```bash
# Start Claude with the plugin
claude --plugin cleave

# In the session, start your task. When context runs out,
# Claude will write handoff files and print RELAY_HANDOFF_COMPLETE.

# Start a new session and continue:
# Type /resume to pick up where you left off

# When the task completes and you have a new task:
# Type /continue to start fresh with preserved knowledge
```

### With SDK (Automated Relay)

For fully automated multi-session relay:

```bash
# Install the SDK
npm install -g cleave-sdk

# Run with the plugin for in-session enforcement
npx cleave-sdk --plugin-dir ./cleave-plugin-v4 prompt.md

# Or in TUI mode (interactive)
npx cleave-sdk --tui prompt.md
```

### Slash Commands Reference

| Command | What It Does |
|:--------|:-------------|
| `/handoff` | Force immediate handoff — stops work, writes all three files |
| `/status` | Show progress, knowledge stats, session history, mode |
| `/resume` | Read handoff files and continue from last stop point |
| `/continue` | Archive completed task, start new task with same knowledge |

## Installation

### Standard Install

```bash
./setup.sh
```

Symlinks the plugin to `~/.claude/plugins/cleave`.

### With Direct Hooks (Recommended)

```bash
./setup.sh --install-hooks
```

Also installs Stop and SessionStart hooks directly into `~/.claude/settings.json`. Most reliable approach until plugin hook bugs are fixed.

### Uninstall

```bash
./setup.sh --uninstall
```

### Help

```bash
./setup.sh --help
```

## Migrating from v3

The `.cleave/` directory format is identical. Your existing PROGRESS.md, KNOWLEDGE.md, and NEXT_PROMPT.md files work as-is. The v4.2 plugin is a drop-in replacement — just update your plugin symlink:

```bash
cd cleave-plugin-v4
./setup.sh
```

New in v4.2:
- `/continue` command for chaining tasks
- Relay orchestrator agent for automated mode
- Configurable handoff thresholds
- Crash recovery documentation in the skill
- SDK compatibility (`npx cleave-sdk`)

## Known Issues

- **Stop hooks via plugins (issue #10412):** Exit code 2 may not work correctly when hooks are loaded through the plugin system. Workaround: use `./setup.sh --install-hooks` to install hooks directly into settings.json.
- **Plugin hook JSON output (issue #10875):** JSON output from plugin hooks may not be parsed. The Stop hook uses stderr + exit code 2 instead of JSON for this reason.

## License

MIT
