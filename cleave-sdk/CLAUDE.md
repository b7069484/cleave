# Cleave SDK — Project Conventions

## Git Branching Policy

**NEVER push directly to `main`.** This is a hard rule — no exceptions.

1. Create a feature or fix branch (e.g., `fix/relay-exit`, `feat/pipeline-verify`)
2. Commit changes to the branch
3. Open a PR into `main`
4. Merge only when all tests pass and there are no conflicts

This applies to ALL changes, including those made by AI agents.

## Architecture

- `src/session.ts` — Spawns Claude Code sessions (TUI or headless)
- `src/relay-loop.ts` — Main session relay loop (runs sessions until completion)
- `src/pipeline-loop.ts` — Pipeline orchestrator (sequential stages, each a relay)
- `src/hooks.ts` — Hook management (Stop + SessionStart enforcement)
- `src/detection.ts` — Completion marker detection
- `src/utils/prompt-builder.ts` — Builds session prompts with handoff instructions
- `src/state/files.ts` — File system state management
- `src/cli.ts` — Commander.js CLI entry point
- `scripts/stop-check.sh` — Shell-based Stop hook for TUI mode
- `scripts/session-start.sh` — Shell-based SessionStart hook

## Build

```bash
npm run build && chmod +x dist/index.js && npm link
```

## Known Issues

- Claude Code TUI never auto-exits after processing — relay uses file polling + SIGTERM
- Plugin hooks (`${CLAUDE_PLUGIN_ROOT}`) break on paths with spaces — SDK copies scripts to `/tmp/`
- Claude cannot measure its own context usage — enforce batch limits in prompts
