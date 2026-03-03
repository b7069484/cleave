# Cleave v6 Updates Design

Date: 2026-03-04
Version: 6.1.0 iteration

## Overview

Four features to improve the end-of-project experience, knowledge visibility, remote access, and post-completion usability.

---

## Feature 1: Post-Completion Continuation

### Problem
When Cleave finishes (task complete or max sessions reached), the TUI renders a static box and exits. Users cannot continue with follow-up work or add sessions after hitting the limit.

### Design

**Relay loop restructure:**
- `RelayLoop.run()` no longer returns immediately on `task_complete` or `max_sessions`
- Instead, emits a `'completion'` event and waits for user input via `waitForTransition()`
- The `for` loop becomes a `while` loop that can extend beyond original `maxSessions`
- When the user provides a follow-up or adds sessions, `maxSessions` is bumped and the loop continues

**New TUI component: `CompletionTransition`:**
- Replaces the static complete box in `App.tsx` (lines 30-42)
- Shows: status (complete vs limit reached), sessions run, total cost, elapsed time
- Shows last lines from PROGRESS.md (what was done, what's remaining)
- Three user options:
  - Type a follow-up prompt — injected into next session, sessions auto-extended
  - Press `[S]` — add more sessions, then auto-continues with existing NEXT_PROMPT.md
  - Press `[Q]` — truly quit (triggers debrief)

**Debrief only fires on explicit Q** — not on task completion.

### Files affected
- `src/relay/loop.ts` — restructure loop, add completion event
- `src/tui/App.tsx` — replace static complete box with CompletionTransition
- `src/tui/CompletionTransition.tsx` — new component
- `src/tui/useRelay.ts` — handle completion event, wire up continuation

---

## Feature 2: Completion Debrief Report

### Problem
No summary or reflection is generated when a project finishes. Users have no record of what was done, what tools were used, or lessons learned.

### Design

**Phase 1 — Orchestrator data collection:**
Gather structured data into a `DebriefContext` object:
- `sessionsRun`, `totalCostUsd`, `totalDurationMs` (already in RelayResult)
- Files modified: `git diff --name-only` against initial commit hash (captured at relay start)
- Tools used: aggregate `tool_start` events by tool `name` into frequency map
- Skills used: filter tool events where `name === 'Skill'`, extract skill name from `input`
- Errors: collect `session_error` and `rescue` events with session numbers
- Knowledge entries: count `### Session N` headers and `## Core Knowledge` bullets
- Final progress: read PROGRESS.md content

**Phase 2 — Claude reflection session (~$0.50-1.00):**
Spawn a final `SessionRunner` with debrief prompt containing the `DebriefContext`. Claude writes `.cleave/DEBRIEF.md` with sections:
1. Summary — what was accomplished (2-3 sentences)
2. Work Completed — each deliverable with file paths
3. Tools & Skills Used — what was used, frequency, effectiveness
4. What Worked — good patterns, approaches, decisions
5. What Didn't Work — failures, retries, dead ends
6. Recommendations — what to do differently next time

Budget cap: $1.00. No handoff files written — debrief only.

**Phase 3 — Terminal summary:**
After debrief session completes, read DEBRIEF.md, print condensed summary to terminal (Summary section + key stats).

### Files affected
- `src/relay/loop.ts` — collect debrief data, trigger debrief session on quit
- `src/relay/debrief.ts` — new: `DebriefContext` interface, `collectDebriefData()`, `buildDebriefPrompt()`
- `src/relay/session.ts` — reuse for debrief session (no changes needed)
- `src/tui/useRelay.ts` — handle debrief phase in completion flow
- `src/tui/App.tsx` — show "Generating debrief..." state, then terminal summary

---

## Feature 3: Knowledge Metric

### Problem
Footer shows `Knowledge: 3.2 KB` — raw file size. Since compaction keeps only last 5 sessions, this stays flat or shrinks. The metric is meaningless to the user.

### Design

**New display format:**
```
Knowledge: 8 insights · 1.4 KB core / 0.9 KB session
```

**New parser** — `parseKnowledgeMetrics(content: string)` in `state/knowledge.ts`:
- Split at `## Session Log` marker (same split compactKnowledge uses)
- Core section: count `- ` prefixed lines = insight count, measure byte length = core KB
- Session section: measure byte length = session KB
- Returns: `{ insightCount: number; coreSizeBytes: number; sessionSizeBytes: number }`

**State update** — in `useRelay.ts`:
- Replace `knowledgeBytes: number` with `knowledge: { insights: number; coreBytes: number; sessionBytes: number }`
- 1-second poll reads file content (not just stat), calls `parseKnowledgeMetrics`

**Footer update** — in `Footer.tsx`:
- Display insight count in bold (only grows — core knowledge is never pruned)
- Core/session KB in dimmer text
- User can now distinguish permanent knowledge accumulation from session log fluctuation

### Files affected
- `src/state/knowledge.ts` — add `parseKnowledgeMetrics()`
- `src/tui/useRelay.ts` — change knowledge state shape, update poll logic
- `src/tui/Footer.tsx` — update display format

---

## Feature 4: Remote Control

### Problem
Cleave is terminal-only. Claude Code now supports `/remote-control` which provides a browser URL for session control. Users want to monitor and intervene from their phone.

### Design

**Startup config** — in `StartupApp.tsx`:
- New setup step `'remote'` between `'mode'` and `'confirm'`
- Binary toggle: "Enable remote control (browser access)? [1] Yes [2] No"
- Default: No

**Config** — in `config.ts`:
- Add `remoteControl: boolean` to `RelayConfig`, default `false`

**Session flag** — in `SessionRunner.buildArgs()`:
- When `remoteControl` is true, add Claude CLI's remote control flag to spawn args

**URL capture** — in `SessionRunner`:
- Parse remote control URL from Claude's NDJSON stream output
- Emit `'remote_url'` event with the URL string

**TUI display** — in `Header.tsx`:
- When remote URL is active: `Remote: https://...` in cyan
- During transitions: `Remote: waiting for next session...`
- When disabled: line not shown
- URL changes per session (new Claude process = new URL)

### Files affected
- `src/relay/config.ts` — add `remoteControl` field
- `src/relay/session.ts` — add CLI flag, parse and emit remote URL
- `src/tui/StartupApp.tsx` — add remote control setup step
- `src/tui/Header.tsx` — display remote URL
- `src/tui/useRelay.ts` — track remote URL in state
- `src/stream/parser.ts` / `src/stream/types.ts` — add remote_url event type if needed
