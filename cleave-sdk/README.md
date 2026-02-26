# cleave v4 — Agent SDK Edition

**Infinite context for Claude Code — built on the Agent SDK.**

Chain sessions together automatically. Each session writes its own continuation prompt. Programmatic hooks enforce handoff behavior. Knowledge compounds across sessions. No shell script hacks.

## What's Different from v2/v3

| | v2 (Shell) | v3 (Plugin) | **v4 (Agent SDK)** |
|:---|:---|:---|:---|
| **Engine** | Bash subprocess | Claude Code plugin | **Agent SDK (TypeScript)** |
| **Hooks** | Instructions only | Shell scripts (buggy) | **Async functions (reliable)** |
| **Rate limits** | Grep output text | Grep output text | **First-class SDK events** |
| **Types** | None | None | **Full TypeScript** |
| **Distribution** | Copy shell script | Symlink plugin | **npm install** |
| **Error handling** | Exit codes | Exit codes | **Structured try/catch** |
| **.cleave/ format** | ✓ | ✓ | **✓ (backward compatible)** |

Everything else is preserved: self-authored handoffs, knowledge accumulation, loop detection, verification commands, git checkpoints, desktop notifications.

## Quick Start

```bash
# Install
cd cleave-sdk
npm install
npm run build

# Run
node dist/index.js my_task.md

# Or link globally
npm link
cleave my_task.md
```

## Usage

```
cleave [options] <prompt-file>

Options:
  -m, --max-sessions <n>      Maximum sessions, 1-1000 (default: 10)
  -d, --work-dir <dir>        Working directory (default: .)
  -p, --pause <seconds>       Seconds between sessions (default: 10)
  -c, --completion-marker     Completion signal string (default: ALL_COMPLETE)
  -g, --git-commit            Auto-commit after each session
  --no-notify                 Disable desktop notifications
  -r, --resume-from <n>       Resume from session N
  --verify <command>          Verification command (exit 0 = done)
  --safe-mode                 Require permission prompts
  -v, --verbose               Detailed logging
  --subagents                 Hint Claude to spawn subagents
```

## Architecture

```
src/
├── index.ts                 CLI entry point
├── cli.ts                   Flag parsing + validation
├── config.ts                CleaveConfig type + defaults
├── relay-loop.ts            Main session relay orchestrator
├── session.ts               SDK query() wrapper
├── hooks.ts                 Stop hook enforcement (programmatic)
├── state/
│   ├── files.ts             .cleave/ file I/O
│   ├── knowledge.ts         Knowledge accumulation + compaction
│   └── status.ts            status.json management
├── detection/
│   ├── completion.ts        Marker detection in PROGRESS.md
│   ├── loops.ts             >85% similarity detection
│   └── verify.ts            External verification command
├── integrations/
│   ├── git.ts               Auto-commit per session
│   ├── notify.ts            Desktop notifications
│   └── archive.ts           Session file archiving
└── utils/
    ├── logger.ts            Colored, structured logging
    ├── lock.ts              File-based mutex
    └── prompt-builder.ts    Session prompt construction
```

## How It Works

1. You write an initial prompt describing your task
2. `cleave` launches a Claude session via the Agent SDK with your prompt + handoff instructions
3. At ~60% context, Claude stops productive work and writes:
   - `PROGRESS.md` — status and crash recovery breadcrumb
   - `KNOWLEDGE.md` — permanent insights + session notes
   - `NEXT_PROMPT.md` — bespoke continuation prompt
4. The **Stop hook** (programmatic, not a shell script) verifies all three files were written before allowing exit
5. The relay loop reads `NEXT_PROMPT.md`, launches a fresh session
6. Repeats until done or max sessions reached

## Key Improvement: Programmatic Hooks

The v3 plugin relied on shell scripts for the Stop hook, which had known bugs (Claude Code issue #10412 — exit code 2 doesn't work in plugin context). The SDK version uses async TypeScript functions:

```typescript
// No shell scripts, no exit code bugs, no JSON parsing issues
Stop: [{
  hooks: [async (input) => {
    const { missing, stale } = checkHandoffFiles(paths);
    if (missing.length > 0 || stale.length > 0) {
      return { decision: 'block', reason: 'Write handoff files first.' };
    }
    return {};
  }]
}]
```

## Backward Compatible

The `.cleave/` directory format is identical to v2 and v3. A project started with the bash script can be resumed with the SDK version:

```bash
# Started with v2
./cleave my_task.md
# Ctrl+C at session 5

# Resume with v4
node dist/index.js --resume-from 5 my_task.md
```

## Requirements

- Node.js 18+
- Claude Code CLI installed (the Agent SDK wraps it)
- `@anthropic-ai/claude-agent-sdk` (installed automatically)

## License

MIT
