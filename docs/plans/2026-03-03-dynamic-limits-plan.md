# Dynamic Session & Budget Limits — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable users to adjust maxSessions and sessionBudget mid-run via TUI hotkeys, with persistence to disk for crash recovery.

**Architecture:** Add `updateMaxSessions`/`updateSessionBudget` methods to `RelayLoop` that mutate config + persist via `CleaveState`. A new `LimitOverlay` ink component (triggered by `s`/`b` keys) collects the new value with confirmation. Footer shows current limits with hotkey hints.

**Tech Stack:** TypeScript, ink 6.8, React 19, vitest

---

### Task 1: CleaveState — Persist maxSessions and sessionBudget

**Files:**
- Modify: `src/state/files.ts:19-27` (add methods after session count methods)
- Test: `src/state/__tests__/files.test.ts`

**Step 1: Write the failing tests**

Add to the end of the `describe('CleaveState')` block in `src/state/__tests__/files.test.ts`:

```typescript
it('reads and writes max sessions', async () => {
  await state.init();
  expect(await state.getMaxSessions()).toBeNull();
  await state.setMaxSessions(30);
  expect(await state.getMaxSessions()).toBe(30);
});

it('reads and writes session budget', async () => {
  await state.init();
  expect(await state.getSessionBudget()).toBeNull();
  await state.setSessionBudget(8.5);
  expect(await state.getSessionBudget()).toBeCloseTo(8.5);
});
```

**Step 2: Run tests to verify they fail**

Run: `cd ~/Desktop/Cleave\ Code/cleave-v6 && npx vitest run src/state/__tests__/files.test.ts`
Expected: FAIL — `state.getMaxSessions is not a function`

**Step 3: Implement the methods**

Add to `src/state/files.ts` after the `setSessionCount` method (after line 26):

```typescript
// Persisted max sessions (for dynamic limit adjustment)
async getMaxSessions(): Promise<number | null> {
  const content = await this.readInternal('.max_sessions');
  const parsed = parseInt(content.trim(), 10);
  return isNaN(parsed) ? null : parsed;
}

async setMaxSessions(n: number): Promise<void> {
  await this.writeInternal('.max_sessions', String(n));
}

// Persisted session budget (for dynamic limit adjustment)
async getSessionBudget(): Promise<number | null> {
  const content = await this.readInternal('.session_budget');
  const parsed = parseFloat(content.trim());
  return isNaN(parsed) ? null : parsed;
}

async setSessionBudget(n: number): Promise<void> {
  await this.writeInternal('.session_budget', String(n));
}
```

**Step 4: Run tests to verify they pass**

Run: `cd ~/Desktop/Cleave\ Code/cleave-v6 && npx vitest run src/state/__tests__/files.test.ts`
Expected: ALL PASS

**Step 5: Commit**

```bash
cd ~/Desktop/Cleave\ Code/cleave-v6
git add src/state/files.ts src/state/__tests__/files.test.ts
git commit -m "feat(state): add persistent maxSessions and sessionBudget storage"
```

---

### Task 2: RelayLoop — Add limit update methods

**Files:**
- Modify: `src/relay/loop.ts:18-27` (add methods to RelayLoop class)
- Test: `src/relay/__tests__/loop.test.ts`

**Step 1: Write the failing test**

Add to end of `describe('RelayLoop')` in `src/relay/__tests__/loop.test.ts`:

```typescript
it('extends session limit when updateMaxSessions is called mid-run', async () => {
  const state = new CleaveState(tmpDir);
  await state.init();
  let callCount = 0;

  (SessionRunner as any).mockImplementation(function (this: any) {
    this.on = vi.fn();
    this.run = vi.fn(async () => {
      callCount++;
      await state.writeHandoffSignal('HANDOFF_COMPLETE');
      await state.writeNextPrompt('Continue');
      await state.writeProgress('## STATUS: IN_PROGRESS');
      await state.writeKnowledge('## Core Knowledge\n\n## Session Log\n');
      return {
        exitCode: 0, costUsd: 1.0, totalCostUsd: 1.0,
        durationMs: 10000, numTurns: 3, toolUseCount: 5,
        fullText: '', rateLimited: false, sessionId: `s${callCount}`,
      };
    });
  });

  const loop = new RelayLoop({
    projectDir: tmpDir,
    initialTask: 'Expandable task',
    maxSessions: 2,
    sessionBudget: 5,
    mode: 'auto',
    maxSessionLogEntries: 5,
  });

  // After session 1 starts, increase the limit to 4
  loop.on('session_start', ({ sessionNum }: { sessionNum: number }) => {
    if (sessionNum === 1) {
      loop.updateMaxSessions(4);
    }
  });

  const result = await loop.run();
  // Should run all 4 sessions, not stop at 2
  expect(result.sessionsRun).toBe(4);
  expect(result.completed).toBe(false);
  expect(result.reason).toBe('max_sessions');
});

it('updates session budget for next session', async () => {
  const state = new CleaveState(tmpDir);
  await state.init();
  const budgets: number[] = [];

  (SessionRunner as any).mockImplementation(function (this: any, config: any) {
    budgets.push(config.budget);
    this.on = vi.fn();
    this.run = vi.fn(async () => {
      await state.writeHandoffSignal('HANDOFF_COMPLETE');
      await state.writeNextPrompt('Continue');
      await state.writeProgress('## STATUS: IN_PROGRESS');
      await state.writeKnowledge('## Core Knowledge\n\n## Session Log\n');
      return {
        exitCode: 0, costUsd: 1.0, totalCostUsd: 1.0,
        durationMs: 10000, numTurns: 3, toolUseCount: 5,
        fullText: '', rateLimited: false, sessionId: 'test',
      };
    });
  });

  const loop = new RelayLoop({
    projectDir: tmpDir,
    initialTask: 'Budget test',
    maxSessions: 3,
    sessionBudget: 5,
    mode: 'auto',
    maxSessionLogEntries: 5,
  });

  loop.on('session_start', ({ sessionNum }: { sessionNum: number }) => {
    if (sessionNum === 1) {
      loop.updateSessionBudget(10);
    }
  });

  await loop.run();
  // Session 1 used original $5, sessions 2-3 should use $10
  expect(budgets[0]).toBe(5);
  expect(budgets[1]).toBe(10);
  expect(budgets[2]).toBe(10);
});
```

**Step 2: Run tests to verify they fail**

Run: `cd ~/Desktop/Cleave\ Code/cleave-v6 && npx vitest run src/relay/__tests__/loop.test.ts`
Expected: FAIL — `loop.updateMaxSessions is not a function`

**Step 3: Implement the methods**

Add to `src/relay/loop.ts`, inside the `RelayLoop` class, after the `resolveTransition` method (after line 38):

```typescript
/**
 * Dynamically update the max sessions limit. Takes effect on the next loop iteration.
 * Persists to disk so `cleave resume` picks it up.
 */
updateMaxSessions(n: number): void {
  this.config.maxSessions = n;
  this.state.setMaxSessions(n);
  this.emit('config_change', { maxSessions: n, sessionBudget: this.config.sessionBudget });
}

/**
 * Dynamically update the per-session budget. Takes effect on the next session spawn.
 * Persists to disk so `cleave resume` picks it up.
 */
updateSessionBudget(n: number): void {
  this.config.sessionBudget = n;
  this.state.setSessionBudget(n);
  this.emit('config_change', { maxSessions: this.config.maxSessions, sessionBudget: n });
}
```

**Step 4: Run tests to verify they pass**

Run: `cd ~/Desktop/Cleave\ Code/cleave-v6 && npx vitest run src/relay/__tests__/loop.test.ts`
Expected: ALL PASS

**Step 5: Commit**

```bash
cd ~/Desktop/Cleave\ Code/cleave-v6
git add src/relay/loop.ts src/relay/__tests__/loop.test.ts
git commit -m "feat(relay): add updateMaxSessions and updateSessionBudget methods"
```

---

### Task 3: LimitOverlay — New TUI component

**Files:**
- Create: `src/tui/LimitOverlay.tsx`
- No separate test file (tested via integration in Task 5)

**Step 1: Create the overlay component**

Create `src/tui/LimitOverlay.tsx`:

```tsx
import React, { useState, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';

export type LimitType = 'sessions' | 'budget';

interface LimitOverlayProps {
  type: LimitType;
  currentValue: number;
  sessionNum: number;
  maxSessions: number;
  onConfirm: (newValue: number) => void;
  onCancel: () => void;
}

export function LimitOverlay({
  type,
  currentValue,
  sessionNum,
  maxSessions,
  onConfirm,
  onCancel,
}: LimitOverlayProps) {
  const [inputText, setInputText] = useState('');
  const [error, setError] = useState('');

  const isSessions = type === 'sessions';
  const title = isSessions ? 'Adjust Session Limit' : 'Adjust Session Budget';

  useInput(useCallback((input: string, key: { return?: boolean; escape?: boolean; backspace?: boolean }) => {
    if (key.escape) {
      onCancel();
      return;
    }

    if (key.return) {
      const parsed = isSessions ? parseInt(inputText, 10) : parseFloat(inputText);
      if (isNaN(parsed) || parsed <= 0) {
        setError('Enter a valid positive number');
        return;
      }
      if (isSessions && parsed < sessionNum) {
        setError(`Must be >= current session (${sessionNum})`);
        return;
      }
      onConfirm(parsed);
      return;
    }

    if (key.backspace) {
      setInputText(t => t.slice(0, -1));
      setError('');
      return;
    }

    // Only accept digits and decimal point (for budget)
    if (/^[\d.]$/.test(input)) {
      setInputText(t => t + input);
      setError('');
    }
  }, [inputText, isSessions, sessionNum, onConfirm, onCancel]));

  return (
    <Box
      flexDirection="column"
      borderStyle="double"
      borderColor="yellow"
      paddingX={2}
      paddingY={1}
      alignItems="center"
    >
      <Text bold color="yellow">{title}</Text>
      <Text> </Text>
      <Box justifyContent="space-between" width={40}>
        <Text>Current: <Text bold>{isSessions ? currentValue : `$${currentValue.toFixed(2)}`}</Text></Text>
        {isSessions && <Text>Session: <Text bold>{sessionNum} of {maxSessions}</Text></Text>}
      </Box>
      <Text> </Text>
      <Box>
        <Text>New {isSessions ? 'limit' : 'budget'}: </Text>
        <Box borderStyle="round" borderColor="cyan" paddingX={1} minWidth={10}>
          <Text>{isSessions ? '' : '$'}{inputText}<Text color="cyan">|</Text></Text>
        </Box>
      </Box>
      {error ? (
        <Text color="red">{error}</Text>
      ) : (
        <Text> </Text>
      )}
      {!isSessions && (
        <Text dimColor>Takes effect next session</Text>
      )}
      <Text dimColor>Enter to confirm · Esc to cancel</Text>
    </Box>
  );
}
```

**Step 2: Verify it compiles**

Run: `cd ~/Desktop/Cleave\ Code/cleave-v6 && npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
cd ~/Desktop/Cleave\ Code/cleave-v6
git add src/tui/LimitOverlay.tsx
git commit -m "feat(tui): add LimitOverlay component for dynamic limit adjustment"
```

---

### Task 4: Footer — Add limits display and hotkey hints

**Files:**
- Modify: `src/tui/Footer.tsx`

**Step 1: Update Footer props and rendering**

Replace the full content of `src/tui/Footer.tsx`:

```tsx
import React from 'react';
import { Box, Text } from 'ink';
import type { RunningAgent } from './useRelay.js';

interface FooterProps {
  knowledgeSize: number;
  handoffsCompleted: number;
  maxHandoffs: number;
  runningAgents: RunningAgent[];
  sessionNum: number;
  maxSessions: number;
  sessionBudget: number;
}

export function Footer({ knowledgeSize, handoffsCompleted, maxHandoffs, runningAgents, sessionNum, maxSessions, sessionBudget }: FooterProps) {
  const kbSize = (knowledgeSize / 1024).toFixed(1);

  return (
    <Box flexDirection="column">
      {runningAgents.length > 0 && (
        <Box borderStyle="round" borderColor="cyan" paddingX={1} flexDirection="column">
          <Text bold color="cyan">Agents ({runningAgents.length} running)</Text>
          {runningAgents.map(agent => {
            const elapsed = Math.round((Date.now() - agent.startedAt) / 1000);
            return (
              <Box key={agent.id}>
                <Text color="cyan">  {'\u25B6'} </Text>
                <Text>{agent.description}</Text>
                <Text dimColor> ({agent.type}) {elapsed}s</Text>
              </Box>
            );
          })}
        </Box>
      )}
      <Box borderStyle="single" borderColor="gray" paddingX={1} flexDirection="column">
        <Box justifyContent="space-between">
          <Text>Knowledge: <Text bold>{kbSize} KB</Text></Text>
          <Text>Handoffs: <Text bold color={handoffsCompleted > 0 ? 'green' : 'gray'}>{handoffsCompleted}/{maxHandoffs}</Text></Text>
        </Box>
        <Box justifyContent="space-between">
          <Text dimColor>[s]</Text>
          <Text> Sessions: <Text bold>{sessionNum}/{maxSessions}</Text></Text>
          <Text>  </Text>
          <Text dimColor>[b]</Text>
          <Text> Budget: <Text bold>${sessionBudget.toFixed(2)}</Text>/session</Text>
        </Box>
      </Box>
    </Box>
  );
}
```

**Step 2: Verify it compiles (will fail until Task 5 updates App.tsx)**

Run: `cd ~/Desktop/Cleave\ Code/cleave-v6 && npx tsc --noEmit`
Expected: Type errors in `App.tsx` (missing new props) — this is fine, fixed in Task 5.

**Step 3: Commit**

```bash
cd ~/Desktop/Cleave\ Code/cleave-v6
git add src/tui/Footer.tsx
git commit -m "feat(tui): add session/budget display and hotkey hints to footer"
```

---

### Task 5: App + useRelay — Wire everything together

**Files:**
- Modify: `src/tui/useRelay.ts`
- Modify: `src/tui/App.tsx`

**Step 1: Update useRelay to handle overlay state and config changes**

In `src/tui/useRelay.ts`, make these changes:

a) Add import for `LimitType`:

```typescript
import type { LimitType } from './LimitOverlay.js';
```

b) Add `overlayMode` to `RelayState` interface (after `totalSessions: number;`):

```typescript
overlayMode: LimitType | null;
```

c) Add `overlayMode: null,` to the initial state in `useState`.

d) Add a `config_change` event listener inside the `useEffect`, after the `rescue` listener:

```typescript
loop.on('config_change', ({ maxSessions, sessionBudget }: { maxSessions: number; sessionBudget: number }) => {
  setState(s => ({
    ...s,
    maxSessions,
    budgetUsd: sessionBudget,
  }));
});
```

e) Add overlay control functions after `advanceFromTransition`:

```typescript
const openOverlay = useCallback((type: LimitType) => {
  setState(s => ({ ...s, overlayMode: type }));
}, []);

const closeOverlay = useCallback(() => {
  setState(s => ({ ...s, overlayMode: null }));
}, []);

const updateMaxSessions = useCallback((n: number) => {
  loopRef.current?.updateMaxSessions(n);
  setState(s => ({ ...s, overlayMode: null }));
}, []);

const updateSessionBudget = useCallback((n: number) => {
  loopRef.current?.updateSessionBudget(n);
  setState(s => ({ ...s, overlayMode: null }));
}, []);
```

f) Update the return statement:

```typescript
return { state, advanceFromTransition, openOverlay, closeOverlay, updateMaxSessions, updateSessionBudget };
```

**Step 2: Update App.tsx to render overlay and pass new footer props**

Replace the full content of `src/tui/App.tsx`:

```tsx
import React from 'react';
import { Box, Text, useInput } from 'ink';
import { Header } from './Header.js';
import { StreamView } from './StreamView.js';
import { Footer } from './Footer.js';
import { Transition } from './Transition.js';
import { LimitOverlay } from './LimitOverlay.js';
import { useRelay } from './useRelay.js';
import type { RelayConfig } from '../relay/config.js';

interface AppProps {
  config: RelayConfig;
}

export function App({ config }: AppProps) {
  const { state, advanceFromTransition, openOverlay, closeOverlay, updateMaxSessions, updateSessionBudget } = useRelay(config);

  // Global hotkeys for s/b (only when no overlay is active and not in transition text input)
  useInput((input, key) => {
    if (state.overlayMode) return; // Overlay is open, let it handle input
    if (state.phase === 'complete' || state.phase === 'error') return;

    if (input === 's' || input === 'S') {
      openOverlay('sessions');
    } else if (input === 'b' || input === 'B') {
      openOverlay('budget');
    }
  }, { isActive: !state.overlayMode && state.phase !== 'transition' });

  if (state.phase === 'complete') {
    return (
      <Box flexDirection="column" padding={1}>
        <Box borderStyle="double" borderColor={state.completed ? 'green' : 'yellow'} padding={1} flexDirection="column" alignItems="center">
          <Text bold color={state.completed ? 'green' : 'yellow'}>
            {state.completed ? 'TASK COMPLETE' : 'SESSION LIMIT REACHED'}
          </Text>
          <Text>Sessions run: {state.totalSessions}</Text>
          <Text>Total cost: ${state.totalCostUsd.toFixed(2)}</Text>
        </Box>
      </Box>
    );
  }

  if (state.phase === 'error') {
    return (
      <Box flexDirection="column" padding={1}>
        <Box borderStyle="double" borderColor="red" padding={1}>
          <Text bold color="red">Error: </Text>
          <Text>{state.error}</Text>
        </Box>
      </Box>
    );
  }

  if (state.phase === 'transition') {
    return (
      <Transition
        sessionNum={state.sessionNum}
        maxSessions={state.maxSessions}
        contextPercent={state.contextPercent}
        costUsd={state.totalCostUsd}
        tasksCompleted={0}
        tasksTotal={0}
        knowledgePromoted={0}
        onComplete={advanceFromTransition}
        mode={config.mode}
      />
    );
  }

  // Running phase
  return (
    <Box flexDirection="column" height="100%">
      <Header
        sessionNum={state.sessionNum}
        maxSessions={state.maxSessions}
        projectDir={config.projectDir}
        elapsedMs={state.elapsedMs}
        sessionCostUsd={state.sessionCostUsd}
        totalCostUsd={state.totalCostUsd}
        budgetUsd={state.budgetUsd}
        contextPercent={state.contextPercent}
      />
      {state.overlayMode ? (
        <LimitOverlay
          type={state.overlayMode}
          currentValue={state.overlayMode === 'sessions' ? state.maxSessions : state.budgetUsd}
          sessionNum={state.sessionNum}
          maxSessions={state.maxSessions}
          onConfirm={state.overlayMode === 'sessions' ? updateMaxSessions : updateSessionBudget}
          onCancel={closeOverlay}
        />
      ) : (
        <StreamView events={state.events} />
      )}
      <Footer
        knowledgeSize={state.knowledgeBytes}
        handoffsCompleted={state.handoffsCompleted}
        maxHandoffs={Math.max(0, state.maxSessions - 1)}
        runningAgents={state.runningAgents}
        sessionNum={state.sessionNum}
        maxSessions={state.maxSessions}
        sessionBudget={state.budgetUsd}
      />
    </Box>
  );
}
```

**Step 3: Verify it compiles**

Run: `cd ~/Desktop/Cleave\ Code/cleave-v6 && npx tsc --noEmit`
Expected: No errors

**Step 4: Run full test suite**

Run: `cd ~/Desktop/Cleave\ Code/cleave-v6 && npx vitest run`
Expected: ALL PASS

**Step 5: Commit**

```bash
cd ~/Desktop/Cleave\ Code/cleave-v6
git add src/tui/useRelay.ts src/tui/App.tsx
git commit -m "feat(tui): wire overlay, hotkeys, and footer to relay loop"
```

---

### Task 6: CLI resume — Read persisted limits as defaults

**Files:**
- Modify: `src/cli.ts:90-114` (resume command action)

**Step 1: Update the resume action**

In `src/cli.ts`, inside the `resume` command's `.action()` handler (starting around line 90), replace the config construction to read persisted limits:

Find this block:

```typescript
const config: RelayConfig = {
  projectDir,
  initialTask: nextPrompt,
  maxSessions: parseInt(opts.sessions, 10),
  sessionBudget: parseFloat(opts.budget),
  mode: opts.auto ? 'auto' : 'guided',
  model: opts.model,
  skipPermissions: opts.skipPermissions,
  maxSessionLogEntries: 5,
};
```

Replace with:

```typescript
// Read persisted limits (from dynamic adjustment), CLI flags override
const persistedMaxSessions = await state.getMaxSessions();
const persistedSessionBudget = await state.getSessionBudget();

const cliSessions = parseInt(opts.sessions, 10);
const cliBudget = parseFloat(opts.budget);

// Use persisted value if CLI flag is the default (user didn't explicitly set it)
const defaultMax = DEFAULT_CONFIG.maxSessions!;
const defaultBudget = DEFAULT_CONFIG.sessionBudget!;

const config: RelayConfig = {
  projectDir,
  initialTask: nextPrompt,
  maxSessions: cliSessions !== defaultMax ? cliSessions : (persistedMaxSessions ?? defaultMax),
  sessionBudget: cliBudget !== defaultBudget ? cliBudget : (persistedSessionBudget ?? defaultBudget),
  mode: opts.auto ? 'auto' : 'guided',
  model: opts.model,
  skipPermissions: opts.skipPermissions,
  maxSessionLogEntries: 5,
};
```

**Step 2: Verify it compiles**

Run: `cd ~/Desktop/Cleave\ Code/cleave-v6 && npx tsc --noEmit`
Expected: No errors

**Step 3: Run full test suite**

Run: `cd ~/Desktop/Cleave\ Code/cleave-v6 && npx vitest run`
Expected: ALL PASS

**Step 4: Commit**

```bash
cd ~/Desktop/Cleave\ Code/cleave-v6
git add src/cli.ts
git commit -m "feat(cli): resume reads persisted limits from dynamic adjustment"
```

---

### Task 7: Build and verify end-to-end

**Step 1: Build the project**

Run: `cd ~/Desktop/Cleave\ Code/cleave-v6 && npm run build`
Expected: Clean build, no errors

**Step 2: Run full test suite one final time**

Run: `cd ~/Desktop/Cleave\ Code/cleave-v6 && npx vitest run`
Expected: ALL PASS

**Step 3: Final commit (if any fixes were needed)**

```bash
cd ~/Desktop/Cleave\ Code/cleave-v6
git add -A
git commit -m "chore: final build verification for dynamic limits feature"
```
