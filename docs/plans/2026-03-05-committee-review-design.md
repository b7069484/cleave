# Cleave v5.6.1 Expert Committee Review & Design Proposal

**Date:** 2026-03-05
**Reviewers:** 5-expert committee (Apple UI/UX, OpenAI Agentic AI, LLM Creator, Anthropic Engineer, CLI/MCP/Plugin Expert)
**Codebase:** cleave-sdk v5.6.1 (uncommitted on main)

---

## Executive Summary

The committee identified **78 total issues** across the codebase:
- **Critical:** 11
- **Major:** 25
- **Minor:** 22
- **Enhancement:** 20

The most impactful findings cluster around **3 root causes** that explain all of the user-reported symptoms (wonky TUI, unreliable remote control, missing activity display, broken clarifying questions, unreliable metrics):

### Root Cause 1: Shell Hook Exit Code Breaks Stop Enforcement
`stop-check.sh:157` uses `exit 2` when outputting block JSON. Claude Code likely ignores stdout when exit code is non-zero (fail-open), meaning the Stop hook **never actually blocks exit**. This is probably the single biggest reason "the remote control doesn't work correctly."

### Root Cause 2: Print Mode Has No Stop Hook At All
`session.ts` print mode never passes `--settings` with hooks. TUI mode generates a settings file with Stop/SessionStart hooks, but print mode (the default) has **zero hook enforcement**. The rescue handoff is the only safety net, and it produces low-quality generic prompts.

### Root Cause 3: Headless/SDK Mode Is Severely Under-Implemented
Missing: `allowDangerouslySkipPermissions`, `maxBudgetUsd`, `model`, `systemPrompt` for handoff instructions, most message types unhandled, no rescue handoff logic. Headless mode is essentially non-functional for production use.

---

## Critical Issues (Prioritized)

| # | Issue | File | Expert |
|---|-------|------|--------|
| 1 | **Stop hook `exit 2` should be `exit 0`** — block decision communicated via JSON, not exit code | stop-check.sh:157 | CLI/MCP |
| 2 | **Print mode has no `--settings` for hooks** — no Stop hook enforcement at all | session.ts:534 | CLI/MCP |
| 3 | **`grep -P` fails silently on macOS** — completion detection broken in stop hook | stop-check.sh:94 | Agentic AI, CLI/MCP |
| 4 | **Missing `allowDangerouslySkipPermissions`** — headless hangs on permission prompts | session.ts:346 | CLI/MCP |
| 5 | **Missing `CLAUDE_CODE_ENTRYPOINT` env deletion** — nested session detection issues | session.ts:153,577 | CLI/MCP |
| 6 | **No NEXT_PROMPT.md quality validation** — bad handoff cascades into permanent context loss | prompt-builder.ts:88 | LLM Creator |
| 7 | **Dedup guard fragile substring match** — one bad NEXT_PROMPT.md strips all relay instructions | prompt-builder.ts:151 | Agentic AI, LLM Creator |
| 8 | **Headless mode missing rescue handoff** — budget cutoff silently breaks chain | session.ts:317-394 | Agentic AI |
| 9 | **Command injection via `--verify`** — unsanitized shell execution | detection.ts:129 | Anthropic |
| 10 | **osascript injection edge case** — sanitizer incomplete for shell interpolation | notify.ts:29 | Anthropic |
| 11 | **FileLock TOCTOU + PID reuse** — two processes can hold "lock" simultaneously | lock.ts:22 | Anthropic |

## Major Issues (Top 15)

| # | Issue | File | Expert |
|---|-------|------|--------|
| 12 | **Print mode shows NO activity output** — user sees nothing for 5-30 min | session.ts:630 | Apple UI/UX |
| 13 | **Clarifying questions impossible in all modes** — no interactive-first phase | session.ts (all modes) | User-reported |
| 14 | **TUI SIGTERM-based chaining inherently fragile** — root of "wonky" behavior | session.ts:103 | Apple UI/UX |
| 15 | **Vestigial context-% language** in rescue/stage prompts contradicts budget model | session.ts:495, prompt-builder.ts:185 | LLM Creator |
| 16 | **Banner box right border missing** on content lines | logger.ts:98 | Apple UI/UX |
| 17 | **Handoff instruction ordering suboptimal** for LLM attention patterns | prompt-builder.ts:16-72 | LLM Creator |
| 18 | **Budget not model-aware** — $5 gets 1/5 the work on Opus vs Sonnet | config.ts:160 | Agentic AI |
| 19 | **SDK message types mostly unhandled** (19 types, only 3 handled) | session.ts:362 | CLI/MCP |
| 20 | **Pipeline stages share working directory** — no filesystem isolation | pipeline-loop.ts:260 | Agentic AI |
| 21 | **Loop detection order-insensitive** and misses oscillation patterns | detection.ts:51 | Agentic AI |
| 22 | **Instruction drift unmitigated** — no grounding to original task | prompt-builder.ts:88 | LLM Creator |
| 23 | **Print mode safe mode hangs** — `acceptEdits` blocks on Bash prompts in `-p` | session.ts:545 | CLI/MCP |
| 24 | **Core Knowledge grows unbounded** — no size limit or summarization | knowledge.ts | LLM Creator |
| 25 | **Stage name path traversal** — unsanitized in filesystem paths | files.ts:49 | Anthropic |
| 26 | **Rate limit countdown 10s granularity** — should be 1s | relay-loop.ts:40 | Apple UI/UX |

## Design Gap: Clarifying Questions

Across all three modes, Claude cannot ask the user clarifying questions:
- **Print mode**: stdin piped and closed
- **TUI mode**: instruction says "Do NOT ask for confirmation"
- **Headless mode**: no interactive channel

**Proposed fix**: Add an `--interactive-first` flag (or make it default) that runs session 1 in true TUI mode without the "don't ask" instruction and without polling/SIGTERM. After session 1 completes naturally, switch to print mode for sessions 2+. This gives the user a chance to interact with Claude during the critical first session.

---

## Proposed Approaches

### Approach A: "Surgical Strike" — Fix the 5 Root-Cause Bugs Only

**Scope:** 1-2 days, ~8 targeted changes

Fix only the issues that explain the reported symptoms:

1. `stop-check.sh:157` — change `exit 2` to `exit 0`
2. `stop-check.sh:94` — replace `grep -P` with `grep -E` (macOS compat)
3. `session.ts` print mode — generate and pass `--settings` file for hooks
4. `session.ts:153,577` — delete `CLAUDE_CODE_ENTRYPOINT` env var
5. `session.ts:545` — change `acceptEdits` to `bypassPermissions` in print safe mode (or `dontAsk`)
6. `prompt-builder.ts:151` — replace dedup guard with UUID sentinel
7. `prompt-builder.ts:88` — add 200-char minimum for NEXT_PROMPT.md
8. `session.ts:495`, `prompt-builder.ts:185` — remove vestigial context-% language

**Pros:** Fastest path to reliability. Addresses "remote control doesn't work" and "TUI wonky" directly.
**Cons:** Leaves headless mode broken, no activity display, no clarifying questions, security issues unaddressed.

### Approach B: "Reliability Overhaul" — Fix All Critical + Major Issues

**Scope:** 3-5 days, ~25 changes across all files

Everything in Approach A, plus:

1. **Headless mode fixes**: `allowDangerouslySkipPermissions`, `maxBudgetUsd`, `model`, `systemPrompt`, full message type handling, rescue handoff
2. **Activity display**: Add real-time tool call logging in print mode (non-verbose)
3. **Clarifying questions**: `--interactive-first` flag for session 1
4. **Security**: `execFile` for verify commands and notifications, stage name validation, curated env vars
5. **UI polish**: Fix banner alignment, 1s countdown timer, logger init ordering
6. **Prompt engineering**: Reorder handoff instructions for LLM attention, add original task grounding
7. **Loop detection**: Compare last 3 sessions, fix order-insensitive comparison
8. **Knowledge**: Add Core Knowledge size limit

**Pros:** Comprehensive — addresses all user-visible issues and most security concerns. Makes all three modes production-ready.
**Cons:** Larger scope, more testing needed, higher risk of regressions without a test suite.

### Approach C: "Foundation Reset" — Reliability Overhaul + Test Suite + Architecture Improvements

**Scope:** 5-8 days

Everything in Approach B, plus:

1. **Test suite**: Unit tests for all detection, state, and prompt-building functions
2. **MCP integration**: Replace file-based hooks with an MCP server for bidirectional communication
3. **Pipeline isolation**: Auto-commit/stash between stages, per-stage working directories
4. **Typed everything**: Replace all `any` with proper types, typed CLI options
5. **Budget intelligence**: Model-aware defaults, token tracking from stream events
6. **Knowledge summarization**: Auto-summarize Core Knowledge when it exceeds limits

**Pros:** Sets the foundation for long-term reliability and maintainability. MCP integration eliminates entire categories of hook bugs.
**Cons:** Significant time investment. MCP refactor changes the architecture. Overkill if the goal is just to ship a working v5.6.

---

## Recommendation

**I would take Approach B** if I were you. Here's why:

1. **Approach A is tempting but insufficient.** The stop hook exit code and grep fixes will make the remote control work, but headless mode stays broken, there's no activity display, and security holes remain. You'd be shipping something that works for print mode only, with known issues everywhere else.

2. **Approach C is the right long-term answer but wrong timing.** A test suite and MCP integration are important, but they're infrastructure investments. You want to ship a reliable v6 first, then add the foundation for v7.

3. **Approach B hits the sweet spot.** It fixes every user-visible issue, makes all three modes production-ready, adds the interactive-first feature for clarifying questions, and closes the security holes. 3-5 days is reasonable given the codebase size. The changes are focused (no architecture rewrites) and can be done branch-by-branch with PRs.

**Execution order for Approach B:**
1. Shell hook fixes (exit code + grep -P) — immediate impact
2. Print mode hook enforcement — makes default mode reliable
3. Env var + dedup guard + NEXT_PROMPT.md validation — prevents cascading failures
4. Headless mode overhaul — makes SDK mode usable
5. Activity display + clarifying questions — UX improvements
6. Security fixes + prompt engineering + loop detection — hardening
7. UI polish — final touches

Each of these is a logical PR that can be tested independently.
