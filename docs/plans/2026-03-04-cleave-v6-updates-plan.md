# Cleave v6 Updates Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add four features to Cleave v6: post-completion continuation, completion debrief report, improved knowledge metric, and remote control pass-through.

**Architecture:** Each feature is independent and touches different layers (relay loop, TUI components, state parsing). We implement bottom-up: data/state changes first, then relay loop logic, then TUI. The knowledge metric is pure refactor (no new behavior). The debrief and continuation features modify the relay loop's exit path. Remote control adds a config flag and CLI arg pass-through.

**Tech Stack:** TypeScript, Ink (React for terminal), Vitest, Claude CLI (`claude -p --output-format stream-json`)

---

### Task 1: Knowledge Metric — Add `parseKnowledgeMetrics()`

**Files:**
- Modify: `src/state/knowledge.ts`
- Test: `src/state/__tests__/knowledge.test.ts`

**Step 1: Write the failing tests**

Add to `src/state/__tests__/knowledge.test.ts`:

```typescript
import { parseKnowledgeMetrics } from '../knowledge.js';

describe('parseKnowledgeMetrics', () => {
  it('counts bullet points under Core Knowledge as insights', () => {
    const input = `## Core Knowledge\n- Fact one\n- Fact two\n- Fact three\n\n## Session Log\n### Session 1\n- Did stuff`;
    const result = parseKnowledgeMetrics(input);
    expect(result.insightCount).toBe(3);
  });

  it('measures core and session byte sizes separately', () => {
    const core = '## Core Knowledge\n- Fact one\n- Fact two\n';
    const session = '## Session Log\n### Session 1\n- Did stuff\n';
    const input = core + '\n' + session;
    const result = parseKnowledgeMetrics(input);
    expect(result.coreSizeBytes).toBeGreaterThan(0);
    expect(result.sessionSizeBytes).toBeGreaterThan(0);
    expect(result.coreSizeBytes).toBeLessThan(Buffer.byteLength(input));
  });

  it('returns zeros for empty content', () => {
    const result = parseKnowledgeMetrics('');
    expect(result.insightCount).toBe(0);
    expect(result.coreSizeBytes).toBe(0);
    expect(result.sessionSizeBytes).toBe(0);
  });

  it('handles content with no Session Log section', () => {
    const input = '## Core Knowledge\n- Fact one\n- Fact two';
    const result = parseKnowledgeMetrics(input);
    expect(result.insightCount).toBe(2);
    expect(result.sessionSizeBytes).toBe(0);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd "/Users/israelbitton/Desktop/Cleave Code/cleave-v6" && npx vitest run src/state/__tests__/knowledge.test.ts`
Expected: FAIL — `parseKnowledgeMetrics` is not exported

**Step 3: Implement `parseKnowledgeMetrics`**

Add to `src/state/knowledge.ts`:

```typescript
export interface KnowledgeMetrics {
  insightCount: number;
  coreSizeBytes: number;
  sessionSizeBytes: number;
}

export function parseKnowledgeMetrics(content: string): KnowledgeMetrics {
  if (!content.trim()) {
    return { insightCount: 0, coreSizeBytes: 0, sessionSizeBytes: 0 };
  }

  const sessionLogIndex = content.indexOf('## Session Log');

  let coreSection: string;
  let sessionSection: string;

  if (sessionLogIndex === -1) {
    coreSection = content;
    sessionSection = '';
  } else {
    coreSection = content.slice(0, sessionLogIndex);
    sessionSection = content.slice(sessionLogIndex);
  }

  const insightCount = (coreSection.match(/^- .+/gm) ?? []).length;

  return {
    insightCount,
    coreSizeBytes: Buffer.byteLength(coreSection, 'utf-8'),
    sessionSizeBytes: Buffer.byteLength(sessionSection, 'utf-8'),
  };
}
```

**Step 4: Run tests to verify they pass**

Run: `cd "/Users/israelbitton/Desktop/Cleave Code/cleave-v6" && npx vitest run src/state/__tests__/knowledge.test.ts`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add src/state/knowledge.ts src/state/__tests__/knowledge.test.ts
git commit -m "feat: add parseKnowledgeMetrics for insight count and size breakdown"
```

---

### Task 2: Knowledge Metric — Update TUI state and footer

**Files:**
- Modify: `src/tui/useRelay.ts`
- Modify: `src/tui/Footer.tsx`
- Modify: `src/tui/App.tsx`

**Step 1: Update `RelayState` interface in `useRelay.ts`**

Replace `knowledgeBytes: number` with:

```typescript
knowledge: { insights: number; coreBytes: number; sessionBytes: number };
```

Update the initial state:

```typescript
knowledge: { insights: 0, coreBytes: 0, sessionBytes: 0 },
```

**Step 2: Update the 1-second poll in `useRelay.ts`**

Replace the `statSync` knowledge poll (lines 76-84) with:

```typescript
import { readFileSync } from 'node:fs';
import { parseKnowledgeMetrics } from '../state/knowledge.js';

// Inside the setInterval callback:
let knowledge: { insights: number; coreBytes: number; sessionBytes: number } | undefined;
try {
  const content = readFileSync(kPath, 'utf-8');
  const metrics = parseKnowledgeMetrics(content);
  knowledge = { insights: metrics.insightCount, coreBytes: metrics.coreSizeBytes, sessionBytes: metrics.sessionSizeBytes };
} catch { /* not created yet */ }
setState(s => ({
  ...s,
  elapsedMs: Date.now() - startTimeRef.current,
  ...(knowledge !== undefined ? { knowledge } : {}),
}));
```

Also update the `session_start` handler (lines 94-98) to use the same parsing instead of `statSync`.

**Step 3: Update `FooterProps` in `Footer.tsx`**

Replace `knowledgeSize: number` with:

```typescript
knowledge: { insights: number; coreBytes: number; sessionBytes: number };
```

Replace the knowledge display line (line 37) with:

```tsx
<Text>
  Knowledge: <Text bold>{knowledge.insights} insights</Text>
  <Text dimColor> · {(knowledge.coreBytes / 1024).toFixed(1)} KB core / {(knowledge.sessionBytes / 1024).toFixed(1)} KB session</Text>
</Text>
```

**Step 4: Update the `Footer` call in `App.tsx`**

Replace `knowledgeSize={state.knowledgeBytes}` (line 97) with:

```tsx
knowledge={state.knowledge}
```

**Step 5: Run all tests to verify nothing breaks**

Run: `cd "/Users/israelbitton/Desktop/Cleave Code/cleave-v6" && npx vitest run`
Expected: ALL PASS

**Step 6: Commit**

```bash
git add src/tui/useRelay.ts src/tui/Footer.tsx src/tui/App.tsx
git commit -m "feat: display knowledge as insight count with core/session size breakdown"
```

---

### Task 3: Remote Control — Config and session flag

**Files:**
- Modify: `src/relay/config.ts`
- Modify: `src/relay/session.ts`
- Test: `src/relay/__tests__/session.test.ts`

**Step 1: Write the failing test**

Add to `src/relay/__tests__/session.test.ts`:

```typescript
it('includes remote control flag when remoteControl is true', () => {
  const runner = new SessionRunner({
    projectDir: '/tmp/test',
    prompt: 'test',
    handoffInstructions: '',
    budget: 5,
    remoteControl: true,
  });
  const args = (runner as any).buildArgs();
  expect(args).toContain('--remote-control');
});

it('excludes remote control flag when remoteControl is false', () => {
  const runner = new SessionRunner({
    projectDir: '/tmp/test',
    prompt: 'test',
    handoffInstructions: '',
    budget: 5,
    remoteControl: false,
  });
  const args = (runner as any).buildArgs();
  expect(args).not.toContain('--remote-control');
});
```

**Step 2: Run tests to verify they fail**

Run: `cd "/Users/israelbitton/Desktop/Cleave Code/cleave-v6" && npx vitest run src/relay/__tests__/session.test.ts`
Expected: FAIL — `remoteControl` not recognized in SessionConfig

**Step 3: Add `remoteControl` to config and session**

In `src/relay/config.ts`, add to `RelayConfig`:

```typescript
remoteControl?: boolean;
```

Add to `DEFAULT_CONFIG`:

```typescript
remoteControl: false,
```

In `src/relay/session.ts`, add to `SessionConfig`:

```typescript
remoteControl?: boolean;
```

In `buildArgs()`, add before the `return args`:

```typescript
if (this.config.remoteControl) {
  args.push('--remote-control');
}
```

**Step 4: Run tests to verify they pass**

Run: `cd "/Users/israelbitton/Desktop/Cleave Code/cleave-v6" && npx vitest run src/relay/__tests__/session.test.ts`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add src/relay/config.ts src/relay/session.ts src/relay/__tests__/session.test.ts
git commit -m "feat: add remoteControl config flag and pass --remote-control to Claude CLI"
```

---

### Task 4: Remote Control — Startup wizard step

**Files:**
- Modify: `src/tui/StartupApp.tsx`

**Step 1: Add `'remote'` to the `SetupStep` type**

Change:

```typescript
type SetupStep = 'dir' | 'task' | 'clarify_loading' | 'clarify_ask' | 'sessions' | 'budget' | 'mode' | 'confirm';
```

To:

```typescript
type SetupStep = 'dir' | 'task' | 'clarify_loading' | 'clarify_ask' | 'sessions' | 'budget' | 'mode' | 'remote' | 'confirm';
```

**Step 2: Add state for remote control**

```typescript
const [remoteControl, setRemoteControl] = useState(false);
```

**Step 3: Update the `advance` callback**

In the `'mode'` case, change `setStep('confirm')` to `setStep('remote')`.

Add a new case:

```typescript
case 'remote':
  setStep('confirm');
  break;
```

**Step 4: Add keyboard handling for the remote step**

In the `useInput` callback, add handling for the `'remote'` step (same pattern as mode — `1` = Yes, `2` = No, Tab toggles):

```typescript
if (step === 'remote') {
  if (ch === '1') { setRemoteControl(true); return; }
  if (ch === '2') { setRemoteControl(false); return; }
  if (key.tab) { setRemoteControl(r => !r); return; }
  return;
}
```

**Step 5: Add the remote step to the render**

Between the mode section and the confirm section, add:

```tsx
{(step === 'remote' || step === 'confirm') && (
  <Box flexDirection="column">
    <Text color={step === 'remote' ? 'cyan' : 'green'}>
      {step === 'remote' ? '>' : '\u2713'} Remote control:{' '}
      {step !== 'remote' && <Text bold>{remoteControl ? 'Enabled (browser access)' : 'Disabled'}</Text>}
    </Text>
    {step === 'remote' && (
      <Box flexDirection="column" marginLeft={4}>
        <Text color={remoteControl ? 'cyan' : 'gray'}>
          {remoteControl ? '\u25B6' : ' '} [1] Yes — provide browser URL for mobile/remote access
        </Text>
        <Text color={!remoteControl ? 'cyan' : 'gray'}>
          {!remoteControl ? '\u25B6' : ' '} [2] No — terminal only
        </Text>
        <Text dimColor>  Press 1, 2, or Tab to switch. Enter to confirm.</Text>
      </Box>
    )}
  </Box>
)}
```

**Step 6: Pass `remoteControl` into the config**

In the `started` block where `config` is constructed, add:

```typescript
remoteControl,
```

**Step 7: Update `isPast` order array**

Update the `order` array to include `'remote'`:

```typescript
const order: SetupStep[] = ['dir', 'task', 'clarify_loading', 'clarify_ask', 'sessions', 'budget', 'mode', 'remote', 'confirm'];
```

**Step 8: Build and verify manually**

Run: `cd "/Users/israelbitton/Desktop/Cleave Code/cleave-v6" && npx tsc --noEmit`
Expected: No type errors

**Step 9: Commit**

```bash
git add src/tui/StartupApp.tsx
git commit -m "feat: add remote control toggle to startup wizard"
```

---

### Task 5: Remote Control — URL capture and header display

**Files:**
- Modify: `src/tui/useRelay.ts`
- Modify: `src/tui/Header.tsx`
- Modify: `src/relay/session.ts`

**Step 1: Capture remote URL from session stderr**

In `SessionRunner.run()` (session.ts), add stderr reading to capture the remote control URL. Claude CLI prints the URL to stderr when remote control is enabled:

```typescript
// After spawning the child process, add:
let remoteUrl = '';
if (this.config.remoteControl) {
  const stderrRl = createInterface({ input: this.child.stderr! });
  stderrRl.on('line', (line: string) => {
    // Claude CLI prints something like: "Remote control URL: https://..."
    const urlMatch = line.match(/https?:\/\/\S+/);
    if (urlMatch && !remoteUrl) {
      remoteUrl = urlMatch[0];
      this.emit('remote_url', remoteUrl);
    }
  });
}
```

Note: The exact format of Claude CLI's remote control URL output may vary. During implementation, run Claude with `--remote-control` manually to confirm the output format and adjust the regex accordingly.

**Step 2: Forward remote URL events from relay to TUI**

In `RelayLoop.run()`, after setting up `runner.on('event', ...)`, add:

```typescript
runner.on('remote_url', (url: string) => {
  this.emit('remote_url', url);
});
```

**Step 3: Track remote URL in `useRelay.ts`**

Add `remoteUrl: string` to `RelayState` (default `''`).

Add listener in the `useEffect`:

```typescript
loop.on('remote_url', (url: string) => {
  setState(s => ({ ...s, remoteUrl: url }));
});
```

Clear it on `session_start`:

```typescript
remoteUrl: '',
```

**Step 4: Display in `Header.tsx`**

Add `remoteUrl?: string` to `HeaderProps`.

After the context/cost row, add conditionally:

```tsx
{remoteUrl && (
  <Box>
    <Text>Remote: <Text bold color="cyan">{remoteUrl}</Text></Text>
  </Box>
)}
```

Update the `Header` call in `App.tsx` to pass `remoteUrl={state.remoteUrl}`.

**Step 5: Build and verify**

Run: `cd "/Users/israelbitton/Desktop/Cleave Code/cleave-v6" && npx tsc --noEmit`
Expected: No type errors

**Step 6: Commit**

```bash
git add src/relay/session.ts src/relay/loop.ts src/tui/useRelay.ts src/tui/Header.tsx src/tui/App.tsx
git commit -m "feat: capture and display remote control URL in TUI header"
```

---

### Task 6: Post-Completion Continuation — Restructure relay loop

**Files:**
- Modify: `src/relay/loop.ts`
- Test: `src/relay/__tests__/loop.test.ts`

**Step 1: Write the failing test**

Add to `src/relay/__tests__/loop.test.ts`:

```typescript
it('pauses on task completion and continues when user provides follow-up', async () => {
  const state = new CleaveState(tmpDir);
  await state.init();
  let callCount = 0;

  (SessionRunner as any).mockImplementation(function (this: any) {
    this.on = vi.fn();
    this.run = vi.fn(async () => {
      callCount++;
      if (callCount === 1) {
        await state.writeHandoffSignal('TASK_FULLY_COMPLETE');
        await state.writeProgress('## STATUS: ALL_COMPLETE\nDone');
      } else {
        // Second session: complete the follow-up
        await state.writeHandoffSignal('TASK_FULLY_COMPLETE');
        await state.writeProgress('## STATUS: ALL_COMPLETE\nFollow-up done');
      }
      return {
        exitCode: 0, costUsd: 1.0, totalCostUsd: 1.0,
        durationMs: 10000, numTurns: 3, toolUseCount: 5,
        fullText: '', rateLimited: false, sessionId: `s${callCount}`,
      };
    });
  });

  const loop = new RelayLoop({
    projectDir: tmpDir,
    initialTask: 'Initial task',
    maxSessions: 5,
    sessionBudget: 5,
    mode: 'auto',
    maxSessionLogEntries: 5,
  });

  // When completion event fires, provide a follow-up
  let completionCount = 0;
  loop.on('completion', () => {
    completionCount++;
    if (completionCount === 1) {
      // First completion: continue with follow-up
      loop.resolveTransition('Do the follow-up work');
    } else {
      // Second completion: quit
      loop.resolveTransition(undefined);
    }
  });

  const result = await loop.run();
  expect(callCount).toBe(2);
  expect(result.sessionsRun).toBe(2);
});

it('pauses on max sessions and continues when user adds sessions', async () => {
  const state = new CleaveState(tmpDir);
  await state.init();
  let callCount = 0;

  (SessionRunner as any).mockImplementation(function (this: any) {
    this.on = vi.fn();
    this.run = vi.fn(async () => {
      callCount++;
      if (callCount < 4) {
        await state.writeHandoffSignal('HANDOFF_COMPLETE');
        await state.writeNextPrompt('Continue');
        await state.writeProgress('## STATUS: IN_PROGRESS');
        await state.writeKnowledge('## Core Knowledge\n\n## Session Log\n');
      } else {
        await state.writeHandoffSignal('TASK_FULLY_COMPLETE');
        await state.writeProgress('## STATUS: ALL_COMPLETE');
      }
      return {
        exitCode: 0, costUsd: 1.0, totalCostUsd: 1.0,
        durationMs: 10000, numTurns: 3, toolUseCount: 5,
        fullText: '', rateLimited: false, sessionId: `s${callCount}`,
      };
    });
  });

  const loop = new RelayLoop({
    projectDir: tmpDir,
    initialTask: 'Task',
    maxSessions: 2,
    sessionBudget: 5,
    mode: 'auto',
    maxSessionLogEntries: 5,
  });

  // When max sessions hit, add more
  loop.on('completion', () => {
    if (callCount === 2) {
      loop.updateMaxSessions(5);
      loop.resolveTransition(undefined);
    } else {
      loop.resolveTransition(undefined);
    }
  });

  const result = await loop.run();
  expect(callCount).toBe(4);
  expect(result.completed).toBe(true);
});
```

**Step 2: Run tests to verify they fail**

Run: `cd "/Users/israelbitton/Desktop/Cleave Code/cleave-v6" && npx vitest run src/relay/__tests__/loop.test.ts`
Expected: FAIL — `completion` event never fires; loop returns immediately

**Step 3: Restructure `RelayLoop.run()`**

Replace the current `run()` method in `src/relay/loop.ts`:

```typescript
async run(): Promise<RelayResult> {
  await this.state.init();

  let sessionsRun = 0;
  let totalCost = 0;
  let totalDuration = 0;

  while (sessionsRun < this.config.maxSessions) {
    const i = sessionsRun + 1;
    sessionsRun = i;
    await this.state.setSessionCount(i);
    await this.state.clearHandoffSignal();
    await this.state.markSessionStart();

    // Compact knowledge before each session
    const rawKnowledge = await this.state.readKnowledge();
    if (rawKnowledge.trim()) {
      const compacted = compactKnowledge(rawKnowledge, this.config.maxSessionLogEntries);
      await this.state.writeKnowledge(compacted);
    }

    // Build the prompt
    const prompt = buildSessionPrompt({
      sessionNum: i,
      maxSessions: this.config.maxSessions,
      initialTask: this.config.initialTask,
      nextPrompt: await this.state.readNextPrompt(),
      knowledge: await this.state.readKnowledge(),
      progress: await this.state.readProgress(),
    });

    // Run the session
    const runner = new SessionRunner({
      projectDir: this.config.projectDir,
      prompt,
      handoffInstructions: buildHandoffInstructions(this.config.projectDir),
      budget: this.config.sessionBudget,
      model: this.config.model,
      verbose: this.config.verbose,
      skipPermissions: this.config.skipPermissions,
      allowedTools: this.config.allowedTools,
      remoteControl: this.config.remoteControl,
    });

    // Forward events from session to relay
    runner.on('event', (event: ParsedEvent) => {
      this.emit('event', event);
    });

    runner.on('remote_url', (url: string) => {
      this.emit('remote_url', url);
    });

    this.emit('session_start', { sessionNum: i, maxSessions: this.config.maxSessions });

    let sessionResult: SessionResult;
    try {
      sessionResult = await runner.run();
    } catch (err) {
      this.emit('session_error', { sessionNum: i, error: err });
      await generateRescueHandoff(this.state, i, this.config.initialTask);

      this.emit('transition', { sessionNum: i, type: 'rescue' });
      const userInput = await this.waitForTransition();
      if (userInput) {
        const existing = await this.state.readNextPrompt();
        await this.state.writeNextPrompt(
          `## User Instructions\n${userInput}\n\n${existing}`
        );
      }
      continue;
    }

    totalCost += sessionResult.totalCostUsd || sessionResult.costUsd;
    totalDuration += sessionResult.durationMs;

    // Archive session files
    await this.state.archiveSession(i);

    // Check for handoff
    const handoff = await detectHandoff(this.state);

    if (handoff === 'complete') {
      this.emit('session_end', { sessionNum: i, result: sessionResult, totalCost });

      // Emit completion and wait for user decision
      this.emit('completion', {
        reason: 'task_complete',
        sessionsRun,
        totalCostUsd: totalCost,
        totalDurationMs: totalDuration,
      });

      const userInput = await this.waitForTransition();
      if (!userInput) {
        // User chose to quit
        return {
          sessionsRun,
          completed: true,
          reason: 'task_complete',
          totalCostUsd: totalCost,
          totalDurationMs: totalDuration,
        };
      }

      // User provided follow-up — inject and continue
      await this.state.clearHandoffSignal();
      await this.state.writeNextPrompt(`## User Instructions\n${userInput}`);
      // Ensure we have room for at least one more session
      if (sessionsRun >= this.config.maxSessions) {
        this.updateMaxSessions(this.config.maxSessions + 1);
      }
      continue;
    }

    if (handoff === 'handoff' || handoff === null) {
      if (handoff === null) {
        this.emit('rescue', { sessionNum: i });
        await generateRescueHandoff(this.state, i, this.config.initialTask);
      }

      if (sessionsRun < this.config.maxSessions) {
        this.emit('session_end', { sessionNum: i, result: sessionResult, totalCost });

        const userInput = await this.waitForTransition();
        if (userInput) {
          const existing = await this.state.readNextPrompt();
          await this.state.writeNextPrompt(
            `## User Instructions\n${userInput}\n\n${existing}`
          );
        }
      }
    }
  }

  // Hit max sessions — emit completion, wait for user
  this.emit('completion', {
    reason: 'max_sessions',
    sessionsRun,
    totalCostUsd: totalCost,
    totalDurationMs: totalDuration,
  });

  const userInput = await this.waitForTransition();
  if (userInput) {
    // User provided follow-up or added sessions — continue
    await this.state.writeNextPrompt(`## User Instructions\n${userInput}`);
    if (sessionsRun >= this.config.maxSessions) {
      this.updateMaxSessions(this.config.maxSessions + 1);
    }
    // Recurse to continue the loop with extended limits
    const continued = await this.run();
    return {
      sessionsRun: sessionsRun + continued.sessionsRun,
      completed: continued.completed,
      reason: continued.reason,
      totalCostUsd: totalCost + continued.totalCostUsd,
      totalDurationMs: totalDuration + continued.totalDurationMs,
    };
  }

  return {
    sessionsRun,
    completed: false,
    reason: 'max_sessions',
    totalCostUsd: totalCost,
    totalDurationMs: totalDuration,
  };
}
```

**Step 4: Run tests to verify they pass**

Run: `cd "/Users/israelbitton/Desktop/Cleave Code/cleave-v6" && npx vitest run src/relay/__tests__/loop.test.ts`
Expected: ALL PASS (including existing tests — verify they still work with the while loop)

**Step 5: Commit**

```bash
git add src/relay/loop.ts src/relay/__tests__/loop.test.ts
git commit -m "feat: post-completion continuation — relay loop pauses on complete/max and awaits user input"
```

---

### Task 7: Post-Completion Continuation — CompletionTransition TUI component

**Files:**
- Create: `src/tui/CompletionTransition.tsx`
- Modify: `src/tui/App.tsx`
- Modify: `src/tui/useRelay.ts`

**Step 1: Create `CompletionTransition.tsx`**

```tsx
import React, { useState, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';

interface CompletionTransitionProps {
  completed: boolean;
  sessionsRun: number;
  totalCostUsd: number;
  progressSummary: string;
  onContinue: (userInput: string) => void;
  onAddSessions: () => void;
  onQuit: () => void;
}

export function CompletionTransition({
  completed,
  sessionsRun,
  totalCostUsd,
  progressSummary,
  onContinue,
  onAddSessions,
  onQuit,
}: CompletionTransitionProps) {
  const [userText, setUserText] = useState('');
  const [typing, setTyping] = useState(false);

  useInput(useCallback((input: string, key: { return?: boolean; backspace?: boolean; escape?: boolean }) => {
    if (key.escape || (!typing && (input === 'q' || input === 'Q'))) {
      onQuit();
      return;
    }

    if (!typing && (input === 's' || input === 'S')) {
      onAddSessions();
      return;
    }

    if (key.return) {
      if (typing && userText.trim()) {
        onContinue(userText.trim());
      }
      return;
    }

    if (key.backspace) {
      if (typing) {
        setUserText(t => t.slice(0, -1));
        if (userText.length <= 1) setTyping(false);
      }
      return;
    }

    if (input) {
      setTyping(true);
      setUserText(t => t + input);
    }
  }, [typing, userText, onContinue, onAddSessions, onQuit]));

  // Extract last few meaningful lines from progress
  const progressLines = progressSummary
    .split('\n')
    .filter(l => l.trim() && !l.startsWith('## STATUS'))
    .slice(0, 5);

  return (
    <Box flexDirection="column" alignItems="center" borderStyle="double" borderColor={completed ? 'green' : 'yellow'} padding={1}>
      <Text bold color={completed ? 'green' : 'yellow'}>
        {completed ? 'TASK COMPLETE' : 'SESSION LIMIT REACHED'}
      </Text>
      <Text> </Text>
      <Text>Sessions run: <Text bold>{sessionsRun}</Text></Text>
      <Text>Total cost: <Text bold>${totalCostUsd.toFixed(2)}</Text></Text>

      {progressLines.length > 0 && (
        <Box flexDirection="column" marginTop={1} paddingX={2}>
          <Text dimColor bold>Latest progress:</Text>
          {progressLines.map((line, i) => (
            <Text key={i} dimColor>  {line}</Text>
          ))}
        </Box>
      )}

      <Text> </Text>

      {typing ? (
        <Box flexDirection="column" alignItems="center">
          <Text color="cyan">Type your follow-up instructions:</Text>
          <Box borderStyle="round" borderColor="cyan" paddingX={1} minWidth={50}>
            <Text>{userText}<Text color="cyan">|</Text></Text>
          </Box>
          <Text dimColor>Enter to send, Esc to cancel</Text>
        </Box>
      ) : (
        <Box flexDirection="column" alignItems="center">
          <Text dimColor>Type to add follow-up instructions</Text>
          <Text dimColor>[S] Add more sessions   [Q] Quit (generate debrief)</Text>
        </Box>
      )}
    </Box>
  );
}
```

**Step 2: Update `useRelay.ts` to handle `completion` event**

Add `progressSummary: string` to `RelayState` (default `''`).

Add event handler in the `useEffect`:

```typescript
loop.on('completion', async ({ reason }: { reason: string; sessionsRun: number; totalCostUsd: number; totalDurationMs: number }) => {
  // Read current progress for display
  const progressFile = join(config.projectDir, '.cleave', 'PROGRESS.md');
  let progressSummary = '';
  try { progressSummary = readFileSync(progressFile, 'utf-8'); } catch { /* ok */ }

  setState(s => ({
    ...s,
    phase: 'complete',
    completed: reason === 'task_complete',
    progressSummary,
  }));
});
```

Add handlers for the three CompletionTransition callbacks:

```typescript
const continueWithFollowUp = useCallback((userInput: string) => {
  setState(s => ({ ...s, phase: 'running' }));
  loopRef.current?.resolveTransition(userInput);
}, []);

const addSessionsAtCompletion = useCallback(() => {
  openOverlay('sessions');
}, []);

const quitRelay = useCallback(() => {
  // Resolve transition with no input = quit
  loopRef.current?.resolveTransition(undefined);
}, []);
```

Return these from the hook.

**Step 3: Update `App.tsx` to use `CompletionTransition`**

Replace the static `complete` phase block (lines 30-42) with:

```tsx
if (state.phase === 'complete') {
  return (
    <Box flexDirection="column">
      {state.overlayMode ? (
        <LimitOverlay
          type={state.overlayMode}
          currentValue={state.overlayMode === 'sessions' ? state.maxSessions : state.budgetUsd}
          sessionNum={state.sessionNum}
          maxSessions={state.maxSessions}
          onConfirm={(n) => {
            if (state.overlayMode === 'sessions') {
              updateMaxSessions(n);
              // After adding sessions, resolve transition to continue
              advanceFromTransition(undefined);
            } else {
              updateSessionBudget(n);
            }
          }}
          onCancel={closeOverlay}
        />
      ) : (
        <CompletionTransition
          completed={state.completed}
          sessionsRun={state.totalSessions || state.sessionNum}
          totalCostUsd={state.totalCostUsd}
          progressSummary={state.progressSummary}
          onContinue={continueWithFollowUp}
          onAddSessions={addSessionsAtCompletion}
          onQuit={quitRelay}
        />
      )}
    </Box>
  );
}
```

**Step 4: Build and verify**

Run: `cd "/Users/israelbitton/Desktop/Cleave Code/cleave-v6" && npx tsc --noEmit`
Expected: No type errors

**Step 5: Commit**

```bash
git add src/tui/CompletionTransition.tsx src/tui/App.tsx src/tui/useRelay.ts
git commit -m "feat: add CompletionTransition component with follow-up, add sessions, and quit options"
```

---

### Task 8: Completion Debrief — Data collection and debrief prompt

**Files:**
- Create: `src/relay/debrief.ts`
- Test: `src/relay/__tests__/debrief.test.ts`

**Step 1: Write the failing test**

Create `src/relay/__tests__/debrief.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { collectToolStats, buildDebriefPrompt, type DebriefContext } from '../debrief.js';
import type { ParsedToolStart } from '../../stream/types.js';

describe('collectToolStats', () => {
  it('counts tool usage frequency', () => {
    const events: ParsedToolStart[] = [
      { kind: 'tool_start', name: 'Read', id: '1', input: {} },
      { kind: 'tool_start', name: 'Edit', id: '2', input: {} },
      { kind: 'tool_start', name: 'Read', id: '3', input: {} },
      { kind: 'tool_start', name: 'Bash', id: '4', input: {} },
      { kind: 'tool_start', name: 'Read', id: '5', input: {} },
    ];
    const stats = collectToolStats(events);
    expect(stats).toEqual({ Read: 3, Edit: 1, Bash: 1 });
  });

  it('extracts skill names from Skill tool calls', () => {
    const events: ParsedToolStart[] = [
      { kind: 'tool_start', name: 'Skill', id: '1', input: { skill: 'superpowers:brainstorming' } },
      { kind: 'tool_start', name: 'Skill', id: '2', input: { skill: 'superpowers:tdd' } },
    ];
    const stats = collectToolStats(events);
    expect(stats.skills).toEqual(['superpowers:brainstorming', 'superpowers:tdd']);
  });
});

describe('buildDebriefPrompt', () => {
  it('produces a prompt containing all context sections', () => {
    const ctx: DebriefContext = {
      sessionsRun: 5,
      totalCostUsd: 12.50,
      totalDurationMs: 180000,
      toolStats: { Read: 30, Edit: 15, Bash: 8 },
      skills: ['superpowers:tdd'],
      filesChanged: ['src/app.ts', 'src/utils.ts'],
      errors: [{ sessionNum: 3, message: 'Rate limited' }],
      finalProgress: '## STATUS: ALL_COMPLETE\nAll tasks done.',
      finalKnowledge: '## Core Knowledge\n- Key insight\n\n## Session Log\n',
      projectDir: '/tmp/test',
    };
    const prompt = buildDebriefPrompt(ctx);
    expect(prompt).toContain('5 sessions');
    expect(prompt).toContain('$12.50');
    expect(prompt).toContain('Read: 30');
    expect(prompt).toContain('src/app.ts');
    expect(prompt).toContain('DEBRIEF.md');
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd "/Users/israelbitton/Desktop/Cleave Code/cleave-v6" && npx vitest run src/relay/__tests__/debrief.test.ts`
Expected: FAIL — module not found

**Step 3: Implement `debrief.ts`**

Create `src/relay/debrief.ts`:

```typescript
import type { ParsedToolStart } from '../stream/types.js';

export interface DebriefContext {
  sessionsRun: number;
  totalCostUsd: number;
  totalDurationMs: number;
  toolStats: Record<string, number>;
  skills: string[];
  filesChanged: string[];
  errors: Array<{ sessionNum: number; message: string }>;
  finalProgress: string;
  finalKnowledge: string;
  projectDir: string;
}

export function collectToolStats(events: ParsedToolStart[]): Record<string, number> & { skills?: string[] } {
  const stats: Record<string, number> = {};
  const skills: string[] = [];

  for (const event of events) {
    if (event.name === 'Skill') {
      const skillName = String(event.input?.skill ?? '');
      if (skillName && !skills.includes(skillName)) {
        skills.push(skillName);
      }
    }
    stats[event.name] = (stats[event.name] ?? 0) + 1;
  }

  if (skills.length > 0) {
    (stats as any).skills = skills;
  }

  return stats;
}

function formatDuration(ms: number): string {
  const mins = Math.floor(ms / 60000);
  const secs = Math.floor((ms % 60000) / 1000);
  if (mins > 0) return `${mins}m ${secs}s`;
  return `${secs}s`;
}

export function buildDebriefPrompt(ctx: DebriefContext): string {
  const toolLines = Object.entries(ctx.toolStats)
    .filter(([k]) => k !== 'skills')
    .sort(([, a], [, b]) => b - a)
    .map(([name, count]) => `  - ${name}: ${count}`)
    .join('\n');

  const skillLines = ctx.skills.length > 0
    ? ctx.skills.map(s => `  - ${s}`).join('\n')
    : '  (none)';

  const fileLines = ctx.filesChanged.length > 0
    ? ctx.filesChanged.map(f => `  - ${f}`).join('\n')
    : '  (none detected)';

  const errorLines = ctx.errors.length > 0
    ? ctx.errors.map(e => `  - Session ${e.sessionNum}: ${e.message}`).join('\n')
    : '  (none)';

  return `# Debrief Request

You just completed a multi-session autonomous project. Write a detailed debrief report.

## Raw Data

- Sessions run: ${ctx.sessionsRun} sessions
- Total cost: $${ctx.totalCostUsd.toFixed(2)}
- Total duration: ${formatDuration(ctx.totalDurationMs)}

### Tools Used
${toolLines}

### Skills Used
${skillLines}

### Files Changed
${fileLines}

### Errors Encountered
${errorLines}

### Final Progress State
${ctx.finalProgress}

### Accumulated Knowledge
${ctx.finalKnowledge}

## Your Task

Write a file to \`.cleave/DEBRIEF.md\` with the following sections:

1. **Summary** — What was accomplished, in 2-3 sentences.
2. **Work Completed** — Each deliverable with file paths where it can be found.
3. **Tools & Skills Used** — What was used, frequency, which were most effective.
4. **What Worked** — Patterns, approaches, and decisions that went well.
5. **What Didn't Work** — Failures, retries, dead ends, wasted effort.
6. **Recommendations** — What to do differently next time, improvements for future runs.

Be specific and actionable. Reference actual file paths and concrete outcomes, not generalities.
Do NOT write any handoff files. Only write DEBRIEF.md.`;
}
```

**Step 4: Run tests to verify they pass**

Run: `cd "/Users/israelbitton/Desktop/Cleave Code/cleave-v6" && npx vitest run src/relay/__tests__/debrief.test.ts`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add src/relay/debrief.ts src/relay/__tests__/debrief.test.ts
git commit -m "feat: add debrief data collection and prompt builder"
```

---

### Task 9: Completion Debrief — Wire into relay loop and TUI

**Files:**
- Modify: `src/relay/loop.ts`
- Modify: `src/tui/useRelay.ts`
- Modify: `src/tui/App.tsx`

**Step 1: Track tool events for debrief in `RelayLoop`**

Add a private field to `RelayLoop`:

```typescript
private allToolEvents: ParsedToolStart[] = [];
private sessionErrors: Array<{ sessionNum: number; message: string }> = [];
private initialCommitHash: string = '';
```

At the start of `run()`, capture the initial git state:

```typescript
import { execSync } from 'node:child_process';

// Inside run(), after state.init():
try {
  this.initialCommitHash = execSync('git rev-parse HEAD', { cwd: this.config.projectDir, encoding: 'utf-8' }).trim();
} catch { /* not a git repo */ }
```

In the `runner.on('event', ...)` handler, accumulate tool starts:

```typescript
runner.on('event', (event: ParsedEvent) => {
  this.emit('event', event);
  if (event.kind === 'tool_start') {
    this.allToolEvents.push(event);
  }
});
```

In `session_error` handling, accumulate errors:

```typescript
this.sessionErrors.push({ sessionNum: i, message: String(err) });
```

**Step 2: Run debrief session on quit**

When the user quits (resolveTransition returns `undefined` from a completion event), run the debrief before returning:

```typescript
import { collectToolStats, buildDebriefPrompt, type DebriefContext } from './debrief.js';

// In the quit path (where return is about to happen):
private async runDebrief(sessionsRun: number, totalCost: number, totalDuration: number): Promise<void> {
  this.emit('debrief_start');

  // Collect files changed
  let filesChanged: string[] = [];
  if (this.initialCommitHash) {
    try {
      const diff = execSync(`git diff --name-only ${this.initialCommitHash}`, {
        cwd: this.config.projectDir,
        encoding: 'utf-8',
      });
      filesChanged = diff.trim().split('\n').filter(Boolean);
    } catch { /* ok */ }
  }

  const rawStats = collectToolStats(this.allToolEvents);
  const skills = (rawStats as any).skills ?? [];
  delete (rawStats as any).skills;

  const ctx: DebriefContext = {
    sessionsRun,
    totalCostUsd: totalCost,
    totalDurationMs: totalDuration,
    toolStats: rawStats,
    skills,
    filesChanged,
    errors: this.sessionErrors,
    finalProgress: await this.state.readProgress(),
    finalKnowledge: await this.state.readKnowledge(),
    projectDir: this.config.projectDir,
  };

  const debriefPrompt = buildDebriefPrompt(ctx);

  const runner = new SessionRunner({
    projectDir: this.config.projectDir,
    prompt: debriefPrompt,
    handoffInstructions: '',
    budget: 1.0,
    model: this.config.model,
    skipPermissions: this.config.skipPermissions,
  });

  runner.on('event', (event: ParsedEvent) => {
    this.emit('event', event);
  });

  try {
    await runner.run();
  } catch {
    // Debrief failure is non-fatal
  }

  this.emit('debrief_end');
}
```

Call `await this.runDebrief(...)` before each `return` in the quit paths.

**Step 3: Handle debrief phase in `useRelay.ts`**

Add `'debrief'` to `RelayPhase`:

```typescript
export type RelayPhase = 'running' | 'transition' | 'complete' | 'debrief' | 'done' | 'error';
```

Add listeners:

```typescript
loop.on('debrief_start', () => {
  setState(s => ({ ...s, phase: 'debrief' }));
});

loop.on('debrief_end', () => {
  setState(s => ({ ...s, phase: 'done' }));
});
```

**Step 4: Show debrief state in `App.tsx`**

Add a debrief phase render:

```tsx
if (state.phase === 'debrief') {
  return (
    <Box flexDirection="column" padding={1}>
      <Box borderStyle="double" borderColor="cyan" padding={1} flexDirection="column" alignItems="center">
        <Text bold color="cyan">Generating debrief report...</Text>
        <StreamView events={state.events} />
      </Box>
    </Box>
  );
}

if (state.phase === 'done') {
  return (
    <Box flexDirection="column" padding={1}>
      <Box borderStyle="double" borderColor="green" padding={1} flexDirection="column" alignItems="center">
        <Text bold color="green">DEBRIEF COMPLETE</Text>
        <Text>Report saved to <Text bold>.cleave/DEBRIEF.md</Text></Text>
        <Text> </Text>
        <Text>Sessions: <Text bold>{state.totalSessions}</Text></Text>
        <Text>Total cost: <Text bold>${state.totalCostUsd.toFixed(2)}</Text></Text>
      </Box>
    </Box>
  );
}
```

**Step 5: Build and verify**

Run: `cd "/Users/israelbitton/Desktop/Cleave Code/cleave-v6" && npx tsc --noEmit`
Expected: No type errors

Run: `cd "/Users/israelbitton/Desktop/Cleave Code/cleave-v6" && npx vitest run`
Expected: ALL PASS

**Step 6: Commit**

```bash
git add src/relay/loop.ts src/tui/useRelay.ts src/tui/App.tsx
git commit -m "feat: wire debrief into relay loop — generates report on quit"
```

---

### Task 10: Final integration verification

**Step 1: Run full test suite**

Run: `cd "/Users/israelbitton/Desktop/Cleave Code/cleave-v6" && npx vitest run`
Expected: ALL PASS

**Step 2: Build**

Run: `cd "/Users/israelbitton/Desktop/Cleave Code/cleave-v6" && npm run build`
Expected: Clean build, no errors

**Step 3: Verify type-checking**

Run: `cd "/Users/israelbitton/Desktop/Cleave Code/cleave-v6" && npx tsc --noEmit`
Expected: No type errors

**Step 4: Commit any remaining fixes**

If anything needed fixing, commit with appropriate message.
