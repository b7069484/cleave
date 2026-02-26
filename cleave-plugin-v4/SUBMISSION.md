# Cleave Plugin — Plugin Directory Submission

Pre-filled answers for the Claude Code Plugin Directory submission form.

---

## Plugin Name

cleave

## Version

4.2.0

## One-Line Description

Infinite context for Claude Code — automatic session relay with self-authored handoffs, knowledge accumulation, and enforced handoff hooks.

## Full Description

Cleave chains Claude Code sessions together automatically for tasks that exceed a single context window. Each session monitors its context budget, writes its own continuation prompt, accumulates knowledge across sessions, and hands off seamlessly to the next.

Key features:
- **Enforced handoffs** — Stop hook blocks session exit until handoff files are written
- **Knowledge accumulation** — Core Knowledge persists permanently; Session Log auto-prunes to last 5 entries
- **Slash commands** — `/handoff` (force handoff), `/status` (progress dashboard), `/resume` (continue from last handoff), `/continue` (new task, same knowledge)
- **Configurable thresholds** — Default 60% handoff trigger, adjustable per relay
- **Crash recovery** — Documented recovery procedure for interrupted sessions
- **Subagent strategy** — Guidance for spawning subagents to maximize context efficiency
- **SDK integration** — Compatible with `cleave-sdk` for fully automated relay orchestration

## Category

Productivity / Context Management

## Keywords

relay, session, context, handoff, infinite, continuation, long-running, tui, sdk, orchestration, knowledge, compaction

## Author

Israel

## License

MIT

## Repository URL

https://github.com/cleave-plugin/cleave-plugin-v4

## Installation Instructions

```bash
git clone https://github.com/cleave-plugin/cleave-plugin-v4.git
cd cleave-plugin-v4
./setup.sh
```

For maximum reliability (recommended):
```bash
./setup.sh --install-hooks
```

## How to Use

1. Start Claude Code with the plugin: `claude --plugin cleave`
2. Work on your task normally
3. When context runs low (~60%), Claude automatically writes handoff files
4. Start a new session and type `/resume` to continue
5. When done, use `/continue` to start a new task with preserved knowledge

For automated relay: `npx cleave-sdk prompt.md`

## Plugin Components

- **1 Skill:** session-relay (auto-invoked handoff protocol)
- **1 Agent:** relay-orchestrator (automated relay coordination)
- **4 Commands:** /handoff, /status, /resume, /continue
- **2 Hooks:** Stop (handoff enforcement), SessionStart (session timestamping)
- **4 Scripts:** stop-check.sh, session-start.sh, compact-knowledge.sh, loop-detect.sh

## Compatibility

- Claude Code CLI (any version supporting plugins)
- macOS, Linux (bash required for hook scripts)
- Optional: cleave-sdk npm package for automated relay

## Screenshots / Demo

N/A — CLI plugin, no visual UI. See README.md for usage examples.

## Testing

1. Install: `./setup.sh --install-hooks`
2. Start session: `claude --plugin cleave`
3. Create relay state: `mkdir -p .cleave && touch .cleave/.active_relay`
4. Verify hooks fire on session exit (Stop hook should block without handoff files)
5. Test `/status`, `/resume`, `/handoff` commands
6. Test `/continue` after marking a task ALL_COMPLETE
