# Dynamic Session & Budget Limits

## Problem

When running a long relay (e.g., 46-chapter review), the initial session limit (e.g., 15) may prove insufficient mid-run. Currently, the only option is to kill the process and `cleave resume -s 30`, losing the live TUI state. Users need to adjust limits on the fly without restarting.

## Design

### Core Mechanism

`RelayLoop` gets two new public methods:

```typescript
updateMaxSessions(n: number): void
updateSessionBudget(n: number): void
```

Each method:
1. Mutates `this.config.maxSessions` / `this.config.sessionBudget` in-place
2. Persists the new value to `.cleave/.max_sessions` / `.cleave/.session_budget`
3. Emits a `config_change` event so the TUI updates immediately

The existing `for (let i = 1; i <= this.config.maxSessions; i++)` loop naturally picks up the change on the next iteration boundary. Budget changes take effect on the next session spawn (current session already launched with its `--max-budget-usd` value).

### Persistence

New files in `.cleave/`:
- `.max_sessions` — plain text integer (e.g., `30`)
- `.session_budget` — plain text float (e.g., `8.00`)

Written on every limit change. Read by `cleave resume` as defaults (CLI `-s`/`-b` flags override).

`CleaveState` gets corresponding read/write methods following the existing `.session_count` pattern.

### TUI: Hotkey Overlay

**Keybindings**: `s` (sessions), `b` (budget). Active during `running` and `transition` phases. Not active when the transition text input is focused.

**LimitOverlay component** — a modal rendered over the stream view:

```
┌─ Adjust Session Limit ─────────────┐
│                                     │
│  Current: 15    Session: 8 of 15    │
│  New limit: [30]                    │
│                                     │
│  Enter to confirm · Esc to cancel   │
└─────────────────────────────────────┘
```

- Shows current value and position (session N of M) for context
- Text input for the new value
- Validates: must be a number, must be >= current session number
- On confirm: calls through `useRelay` → `RelayLoop.updateMaxSessions(n)`
- Budget overlay identical in structure, shows dollar amounts
- Budget overlay notes: "Takes effect next session"

### TUI: Footer Enhancement

Add limits display and hotkey hints to the existing Footer:

```
┌─────────────────────────────────────────────────┐
│ Knowledge: 12.3 KB    Handoffs: 7/29            │
│ [s] Sessions: 8/30    [b] Budget: $5.00/session │
└─────────────────────────────────────────────────┘
```

### State Flow

1. `useInput` in `App.tsx` listens for `s`/`b` (only when no overlay active)
2. Sets `overlayMode: 'sessions' | 'budget' | null` in state
3. `LimitOverlay` renders when `overlayMode` is set
4. On confirm, calls `useRelay`-exposed `updateMaxSessions(n)` / `updateSessionBudget(n)`
5. These call `loopRef.current.updateMaxSessions(n)` / `updateSessionBudget(n)`
6. Loop emits `config_change` → `useRelay` updates `RelayState.maxSessions` / `budgetUsd`
7. Header + Footer re-render with new values

### Edge Cases

| Scenario | Behavior |
|---|---|
| Set limit below current session | Validation rejects, shows error |
| Change limit during last session | Works — loop condition adapts, continues past old limit |
| Budget change mid-session | Current session unaffected, next session uses new budget |
| Auto/headless mode | No TUI controls — use `cleave resume -s/-b` instead |
| `cleave resume` after crash | Reads `.max_sessions`/`.session_budget` as defaults |
| Files don't exist (older runs) | CLI defaults apply as before |
| Prompt header `Session N of M` | Naturally reflects new max from `this.config.maxSessions` |

### Files Changed

| File | Change |
|---|---|
| `src/relay/loop.ts` | Add `updateMaxSessions`, `updateSessionBudget` methods |
| `src/relay/config.ts` | No changes (config interface already has the fields) |
| `src/state/files.ts` | Add `readMaxSessions`, `writeMaxSessions`, `readSessionBudget`, `writeSessionBudget` |
| `src/tui/LimitOverlay.tsx` | New component — modal overlay for editing limits |
| `src/tui/App.tsx` | Add `useInput` for `s`/`b` keys, render `LimitOverlay`, pass new props |
| `src/tui/useRelay.ts` | Add `overlayMode` state, expose `updateMaxSessions`/`updateSessionBudget`, handle `config_change` event |
| `src/tui/Footer.tsx` | Add session/budget display with hotkey hints |
| `src/cli.ts` | `cleave resume` reads persisted limits as defaults |
