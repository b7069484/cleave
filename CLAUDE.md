# Project Conventions

## Git Branching Policy

**NEVER push directly to `main`.** This is a hard rule — no exceptions.

All changes must follow this workflow:
1. Create a feature or fix branch (e.g., `fix/relay-exit`, `feat/pipeline-verify`)
2. Make changes and commit to the branch
3. Open a pull request into `main`
4. Merge only when all tests pass and there are no merge conflicts

This applies to ALL changes — bug fixes, features, documentation, config updates. Both human-authored and AI-authored changes must go through PRs.

## Repository Structure

- `cleave-sdk/` — The TypeScript SDK (npm package)
- `cleave-plugin-v4/` — Claude Code plugin wrapper (hooks handled by SDK)
- `marketplace.json` — Plugin marketplace metadata

## Build & Test

```bash
cd cleave-sdk
npm run build        # Compile TypeScript
chmod +x dist/index.js && npm link   # Make `cleave` command available
```

## Key Paths on Dev Machine

- SDK source: `~/Desktop/Cleave Code/cleave 4/cleave-sdk/`
- Digital WTH project: `~/Desktop/digital-wth/`
- Pipeline prompts: `~/Desktop/digital-wth/digital-wth-prompts/`
