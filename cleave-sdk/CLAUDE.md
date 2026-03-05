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
- Claude cannot measure its own context usage — addressed via --max-budget-usd per session

## v5.6.0 Fixes (2026-03-01)

- Default mode changed from `tui` to `print` (print is reliable, TUI requires polling/SIGTERM)
- Added `--budget` flag (default $5/session) — passes `--max-budget-usd` to claude, prevents context burn
- Fixed dedup guard in prompt-builder.ts — was checking wrong string, causing instruction bloat each session
- Rewrote handoff instructions — no longer asks Claude to self-monitor context %, focuses on chunk-based workflow
- Rescue handoff (safety net) continues to catch sessions cut off by budget cap

## v6.0.0 Reliability Overhaul (2026-03-05)

- **Stop hook fix**: exit 0 (not 2) + portable grep for macOS — hook actually works now
- **Print mode hooks**: --settings file generated for print mode, matching TUI behavior
- **Env var fix**: delete CLAUDE_CODE_ENTRYPOINT to prevent nested session detection
- **Headless mode overhaul**: budget, model, permissions, systemPrompt, rescue handoff, full message handling
- **Activity display**: real-time tool call logging in print mode
- **Interactive-first**: --interactive-first flag for session 1 clarifying questions
- **Security**: execFile for notifications, stage name validation
- **Prompt engineering**: attention-optimized instruction ordering, original task grounding for session 5+
- **Dedup guard**: machine-readable sentinel instead of fragile substring match
- **NEXT_PROMPT.md validation**: 200-char minimum, reject empty/trivial handoffs
- **Loop detection**: order-aware bigrams + 3-session lookback
- **UI polish**: banner alignment, 1s countdown, logger init order
