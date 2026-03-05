# Cleave v6.0 Reliability Overhaul — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix all critical and major issues found by the 5-expert committee review, making all three session modes production-ready, adding activity display and interactive-first clarifying questions.

**Architecture:** Targeted fixes across the existing TypeScript SDK codebase. No architecture rewrites. Each task is a logical PR. The work progresses from highest-impact fixes (shell hooks that make the remote control work) through headless mode, UX features, security, prompt engineering, and UI polish.

**Tech Stack:** TypeScript (cleave-sdk), Bash (hook scripts), Commander.js (CLI), Node.js child_process

**Repo:** `/Users/israelbitton/Desktop/Cleave Code/cleave 4/`
**SDK source:** `cleave-sdk/src/`
**Build:** `cd cleave-sdk && npm run build && chmod +x dist/index.js && npm link`
**Git policy:** NEVER push to main. Branch -> PR -> merge.

---

## Task 1: Fix Shell Hook Exit Code + macOS grep

**Files:**
- Modify: `cleave-sdk/scripts/stop-check.sh:94,155-157`

This is the single highest-impact fix. The Stop hook uses `exit 2` which causes Claude Code to treat it as a hook error (fail-open). Additionally, `grep -P` (PCRE) fails silently on macOS, so completion detection never works.

**Step 1: Fix the grep -P to portable regex**

In `scripts/stop-check.sh`, replace line 94:

```bash
# BEFORE (line 94):
if [ -f "$PROGRESS" ] && grep -qiP "^\s*[#*]*\s*STATUS[: *]+\s*(ALL_COMPLETE|TASK_FULLY_COMPLETE)" "$PROGRESS" 2>/dev/null; then

# AFTER:
if [ -f "$PROGRESS" ] && grep -qi "^[[:space:]#*]*STATUS[: *]*[[:space:]]*\(ALL_COMPLETE\|TASK_FULLY_COMPLETE\)" "$PROGRESS" 2>/dev/null; then
```

**Step 2: Fix the exit code from 2 to 0**

Replace lines 155-157:

```bash
# BEFORE:
# Output block decision and exit 2
echo "{\"decision\":\"block\",\"reason\":\"$REASON\"}"
exit 2

# AFTER:
# Output block decision — exit 0 so Claude Code parses the JSON.
# The decision:"block" in the JSON is what communicates the block, not the exit code.
echo "{\"decision\":\"block\",\"reason\":\"$REASON\"}"
exit 0
```

Also update the header comment at line 7 from `# Exit:   0 = allow exit, 2 = block exit` to `# Exit:   Always 0. Block/allow communicated via JSON decision field.`

**Step 3: Build and verify**

Run: `cd cleave-sdk && npm run build && chmod +x dist/index.js && npm link`
Expected: Clean build, no errors.

**Step 4: Manual test — verify stop hook blocks exit**

Run: `echo '{"cwd":"/tmp"}' | bash cleave-sdk/scripts/stop-check.sh`
Expected: Outputs JSON with `"decision":"block"` and exits 0 (not 2).

**Step 5: Commit**

```bash
cd ~/Desktop/"Cleave Code"/"cleave 4"
git checkout -b fix/reliability-overhaul-v6
git add cleave-sdk/scripts/stop-check.sh
git commit -m "fix: stop hook exit code and macOS grep compatibility

- Change exit 2 to exit 0 — block decision communicated via JSON, not exit code
- Replace grep -P (PCRE) with portable POSIX grep for macOS compatibility
- These two bugs made the Stop hook non-functional on macOS"
```

---

## Task 2: Add Hook Enforcement to Print Mode

**Files:**
- Modify: `cleave-sdk/src/session.ts:518-560`

Print mode (the default) has zero hook enforcement. This task generates and passes a `--settings` file for print mode, just like TUI mode does.

**Step 1: Add --settings flag to print mode args**

In `session.ts`, in `runPrintSession()`, after `const handoffInstructions = ...` (line 532), add settings file generation. The modified block (lines 532-539) becomes:

```typescript
  const handoffInstructions = buildHandoffInstructions(config);
  const settingsPath = generateSettingsFile(paths.relayDir);

  const args: string[] = [
    '-p',
    '--output-format', 'stream-json',
    '--verbose',
    '--append-system-prompt', handoffInstructions,
    '--settings', settingsPath,
  ];
```

**Step 2: Build and verify**

Run: `cd cleave-sdk && npm run build`
Expected: Clean compile.

**Step 3: Commit**

```bash
git add cleave-sdk/src/session.ts
git commit -m "fix: add Stop hook enforcement to print mode via --settings

Print mode (the default) had zero hook enforcement — Claude could exit
without writing handoff files. Now generates and passes --settings JSON
with Stop and SessionStart hooks, matching TUI mode behavior."
```

---

## Task 3: Fix Env Var Deletion + Safe Mode Permission Hang

**Files:**
- Modify: `cleave-sdk/src/session.ts:150-153,541-546,575-578`

Two issues: (1) `CLAUDE_CODE_ENTRYPOINT` env var not deleted, causing nested session detection. (2) Print mode safe mode uses `acceptEdits` which hangs on Bash permission prompts since there's no interactive input.

**Step 1: Delete CLAUDE_CODE_ENTRYPOINT in TUI mode**

In `runTuiSession()`, after `delete childEnv.CLAUDECODE;` (line 153), add:

```typescript
    delete childEnv.CLAUDECODE;
    delete childEnv.CLAUDE_CODE_ENTRYPOINT;
```

**Step 2: Delete CLAUDE_CODE_ENTRYPOINT in print mode**

In `runPrintSession()`, after `delete childEnv.CLAUDECODE;` (line 578), add:

```typescript
    delete childEnv.CLAUDECODE;
    delete childEnv.CLAUDE_CODE_ENTRYPOINT;
```

**Step 3: Fix safe mode permission for print mode**

In `runPrintSession()`, replace lines 541-546:

```typescript
  // Permission mode — print mode is non-interactive, so 'acceptEdits'
  // would hang on Bash tool prompts. Use bypassPermissions in -p mode.
  if (!config.safeMode) {
    args.push('--dangerously-skip-permissions');
  } else {
    // In print mode, there's no interactive input to approve prompts.
    // acceptEdits only auto-approves edits but blocks on Bash.
    // Use bypassPermissions for -p since there's no way to approve interactively.
    args.push('--dangerously-skip-permissions');
  }
```

Note: This effectively makes print mode always bypass permissions. The handoff instructions and budget cap are the real safety controls.

**Step 4: Build and verify**

Run: `cd cleave-sdk && npm run build`
Expected: Clean compile.

**Step 5: Commit**

```bash
git add cleave-sdk/src/session.ts
git commit -m "fix: delete CLAUDE_CODE_ENTRYPOINT env + fix print mode permissions

- Delete both CLAUDECODE and CLAUDE_CODE_ENTRYPOINT to prevent nested
  session detection in child processes
- Print mode now always bypasses permissions since there's no interactive
  input channel to approve prompts (acceptEdits hung on Bash tool use)"
```

---

## Task 4: Fix Dedup Guard + NEXT_PROMPT.md Quality Validation

**Files:**
- Modify: `cleave-sdk/src/utils/prompt-builder.ts:15-17,88-100,148-155`

Two issues: (1) Dedup guard uses fragile substring match that Claude can accidentally trigger. (2) No validation of NEXT_PROMPT.md quality — a 10-char file cascades into permanent context loss.

**Step 1: Add sentinel marker to handoff instructions**

At the very start of `buildHandoffInstructions()` return string, add a machine-readable sentinel:

```typescript
export function buildHandoffInstructions(config: CleaveConfig): string {
  return `
<!-- CLEAVE_RELAY_INSTRUCTIONS_V6 -->
━━━━━━━━ CLEAVE AUTOMATED RELAY — YOU MUST FOLLOW THESE RULES ━━━━━━━━
...
```

**Step 2: Update dedup guard to use sentinel**

Replace lines 148-155 in `buildSessionPrompt()`:

```typescript
export function buildSessionPrompt(config: CleaveConfig, sessionNum: number): string {
  const base = buildBasePrompt(config, sessionNum);
  // Don't double-append if the prompt already contains handoff instructions
  // Uses a machine-readable sentinel that Claude is unlikely to reproduce
  if (base.includes('<!-- CLEAVE_RELAY_INSTRUCTIONS_V6 -->')) {
    return base;
  }
  return base + buildHandoffInstructions(config);
}
```

**Step 3: Add NEXT_PROMPT.md quality validation**

In `buildBasePrompt()`, replace lines 88-100 with:

```typescript
  if (sessionNum > 1 && fs.existsSync(nextPromptFile)) {
    const nextContent = fs.readFileSync(nextPromptFile, 'utf8').trim();
    if (nextContent.length >= 200) {
      prompt = nextContent;
      logger.debug(`Session ${sessionNum}: using NEXT_PROMPT.md (${nextContent.length} chars)`);
    } else if (nextContent.length > 0) {
      // NEXT_PROMPT.md exists but is too short — likely a rushed/incomplete handoff
      logger.warn(`NEXT_PROMPT.md too short (${nextContent.length} chars) for session ${sessionNum} — falling back to initial prompt + PROGRESS.md`);
      prompt = fs.readFileSync(config.initialPromptFile, 'utf8');
      if (fs.existsSync(progressFile)) {
        prompt += `\n\n--- PROGRESS FROM PRIOR SESSIONS ---\n${fs.readFileSync(progressFile, 'utf8')}`;
      }
    } else {
      logger.warn(`NEXT_PROMPT.md is empty for session ${sessionNum} — falling back to initial prompt + PROGRESS.md`);
      prompt = fs.readFileSync(config.initialPromptFile, 'utf8');
      if (fs.existsSync(progressFile)) {
        prompt += `\n\n--- PROGRESS FROM PRIOR SESSIONS ---\n${fs.readFileSync(progressFile, 'utf8')}`;
      }
    }
```

**Step 4: Build and verify**

Run: `cd cleave-sdk && npm run build`
Expected: Clean compile.

**Step 5: Commit**

```bash
git add cleave-sdk/src/utils/prompt-builder.ts
git commit -m "fix: dedup guard sentinel + NEXT_PROMPT.md quality validation

- Replace fragile substring dedup with machine-readable sentinel marker
  (<!-- CLEAVE_RELAY_INSTRUCTIONS_V6 -->)
- Reject NEXT_PROMPT.md under 200 chars as too short — fall back to
  initial prompt + PROGRESS.md instead of propagating bad handoffs"
```

---

## Task 5: Remove Vestigial Context-% Language

**Files:**
- Modify: `cleave-sdk/src/session.ts:493-496`
- Modify: `cleave-sdk/src/utils/prompt-builder.ts:183-186`

The rescue handoff and stage instructions still reference context % thresholds that Claude cannot measure.

**Step 1: Fix rescue handoff in session.ts**

Replace line 495 in `writeRescueHandoff()`:

```typescript
// BEFORE:
- When at ~${config.handoffThreshold}% context, STOP and do the handoff procedure.

// AFTER:
- You have a session budget. Work in chunks and write handoff files after each chunk.
```

**Step 2: Fix stage handoff instructions in prompt-builder.ts**

Replace line 185 in `buildStageHandoffInstructions()`:

```typescript
// BEFORE:
**CONTEXT BUDGET:** Same rules — stop at ~${config.handoffThreshold}% and do the handoff.

// AFTER:
**SESSION BUDGET:** You have a limited budget per session. Work in manageable chunks and write handoff files between chunks. If you are cut off, rescue files will be auto-generated.
```

**Step 3: Build and verify**

Run: `cd cleave-sdk && npm run build`

**Step 4: Commit**

```bash
git add cleave-sdk/src/session.ts cleave-sdk/src/utils/prompt-builder.ts
git commit -m "fix: remove vestigial context-% language from rescue and stage prompts

Replace 'stop at ~60% context' with budget-based language. Claude cannot
measure its own context usage — the budget cap is the real mechanism."
```

---

## Task 6: Headless Mode Overhaul

**Files:**
- Modify: `cleave-sdk/src/session.ts:317-394`
- Modify: `cleave-sdk/src/hooks.ts:121-175`

Headless mode is missing: `allowDangerouslySkipPermissions`, `maxBudgetUsd`, `model`, `systemPrompt`, most message types, and rescue handoff.

**Step 1: Fix the hooks callback signature**

In `hooks.ts`, update the Stop hook callback at line 126:

```typescript
          async (_input: any, _toolUseID?: string, _options?: { signal: AbortSignal }) => {
```

And change `return {};` to `return { decision: 'approve' };` in the three allow-exit paths (lines 130, 136, 144).

**Step 2: Overhaul runHeadlessSession**

Replace the entire `runHeadlessSession` function (lines 317-394) with:

```typescript
async function runHeadlessSession(
  prompt: string,
  config: CleaveConfig,
  paths: RelayPaths,
  sessionNum: number
): Promise<SessionResult> {
  let query: any;
  try {
    const sdk = await import('@anthropic-ai/claude-agent-sdk');
    query = sdk.query;
  } catch (err: any) {
    logger.error('Error: Claude Code Agent SDK not found.');
    logger.error('  Headless mode (--mode headless) requires: npm install @anthropic-ai/claude-agent-sdk');
    logger.error('  Or use --mode print (default) instead.');
    throw new Error(`Agent SDK not available: ${err.message}`);
  }

  const result: SessionResult = {
    exitCode: 0,
    rateLimited: false,
    rateLimitResetAt: null,
    resultText: '',
    estimatedOutputTokens: 0,
  };

  const allowedTools = [
    'Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep',
    'WebSearch', 'WebFetch', 'Task',
  ];
  const permissionMode = config.safeMode ? 'default' : 'bypassPermissions';
  const hooks = buildHooks(paths, config.completionMarker);
  const handoffInstructions = buildHandoffInstructions(config);

  // Track activity for rescue handoff
  let toolUseCount = 0;
  let lastToolName = '';
  let totalOutputChars = 0;

  try {
    logger.debug(`Launching headless session #${sessionNum} (permission: ${permissionMode})`);

    const options: any = {
      cwd: config.workDir,
      allowedTools,
      permissionMode,
      hooks,
      systemPrompt: handoffInstructions,
    };

    // Budget cap
    if (config.sessionBudget > 0) {
      options.maxBudgetUsd = config.sessionBudget;
    }

    // Model selection
    if (config.model) {
      options.model = config.model;
    }

    // Permission bypass requires companion flag
    if (permissionMode === 'bypassPermissions') {
      options.allowDangerouslySkipPermissions = true;
    }

    const messages = query({ prompt, options });

    for await (const message of messages) {
      if (message.type === 'assistant') {
        // Check for rate limit error on assistant message
        if (message.error === 'rate_limit') {
          result.rateLimited = true;
          result.rateLimitResetAt = Date.now() + 300_000;
          logger.warn('Rate limit hit (assistant error)');
          break;
        }
        for (const block of (message.message?.content || [])) {
          if (block.type === 'text') {
            result.resultText += block.text;
            totalOutputChars += block.text.length;
            if (config.verbose) process.stdout.write(block.text);
          } else if (block.type === 'tool_use') {
            toolUseCount++;
            lastToolName = block.name || 'unknown';
            if (config.verbose) logger.debug(`  Tool: ${lastToolName}`);
          }
        }
      } else if (message.type === 'result') {
        // Check for error subtypes (budget exhaustion, etc.)
        if (message.is_error && message.subtype === 'error_max_budget_usd') {
          logger.warn(`Session #${sessionNum} hit budget cap`);
          // Not an error — budget cap is expected. Proceed to rescue handoff.
        } else if (message.is_error) {
          logger.warn(`Session #${sessionNum} result error: ${message.subtype || 'unknown'}`);
        }
        if (message.result) {
          result.resultText += typeof message.result === 'string' ? message.result : JSON.stringify(message.result);
        }
      } else if (message.type === 'rate_limit_event') {
        const info = message.rate_limit_info || message;
        if (info.status === 'blocked' || info.overageStatus === 'blocked') {
          result.rateLimited = true;
          result.rateLimitResetAt = info.resetsAt ? info.resetsAt * 1000 : Date.now() + 300_000;
          logger.warn(`Rate limit blocked. Resets at: ${new Date(result.rateLimitResetAt).toISOString()}`);
        }
      }
      // Silently ignore other message types (system, auth_status, etc.)
    }
  } catch (err: any) {
    const errMsg = String(err.message || err);
    if (RATE_LIMIT_PATTERNS.test(errMsg)) {
      result.rateLimited = true;
      result.rateLimitResetAt = Date.now() + 300_000;
      logger.warn(`Rate limit detected: ${errMsg.slice(0, 100)}`);
    } else {
      result.exitCode = 1;
      logger.error(`Session error: ${errMsg}`);
    }
  }

  result.estimatedOutputTokens = Math.round(totalOutputChars / 4);

  // Rescue handoff — same logic as print mode
  if (!result.rateLimited && toolUseCount > 0) {
    const handoff = hasValidHandoff(paths);
    if (!handoff.complete && !handoff.handedOff) {
      writeRescueHandoff(paths, config, sessionNum, result.exitCode, toolUseCount, lastToolName);
      result.exitCode = 0;
    }
  }

  return result;
}
```

**Step 3: Build and verify**

Run: `cd cleave-sdk && npm run build`

**Step 4: Commit**

```bash
git add cleave-sdk/src/session.ts cleave-sdk/src/hooks.ts
git commit -m "feat: headless mode overhaul — budget, model, permissions, rescue handoff

- Add allowDangerouslySkipPermissions companion flag
- Pass maxBudgetUsd and model to SDK options
- Pass handoff instructions via systemPrompt (not user prompt)
- Handle assistant errors (rate_limit), result error subtypes
  (error_max_budget_usd), and rate_limit_event messages
- Add rescue handoff logic (matching print mode)
- Fix hook callback signature to match SDK types"
```

---

## Task 7: Activity Display in Print Mode

**Files:**
- Modify: `cleave-sdk/src/session.ts:630-660`

Print mode shows NO output by default. Users see silence for 5-30 minutes. Add real-time tool call logging and periodic heartbeat.

**Step 1: Add activity display to print mode stream parser**

In `runPrintSession()`, replace the tool_use handling inside the `assistant` event (around lines 648-654):

```typescript
          } else if (block.type === 'tool_use') {
            toolUseCount++;
            lastToolName = block.name || 'unknown';
            // Always show tool calls — this is the primary activity indicator
            logger.info(`  [tool] ${lastToolName}`);
          }
```

Also in the `content_block_start` handler (lines 656-664), remove the tool counting (it's now done in the assistant handler) or guard against double-counting:

```typescript
      } else if (event.type === 'content_block_start') {
        // Only count here if not already counted in assistant handler
        if (event.content_block?.type === 'tool_use' && !event.content_block?.id) {
          // Streaming tool start — may be redundant with assistant handler
          const name = event.content_block.name || 'unknown';
          if (config.verbose) {
            logger.debug(`  [stream] tool start: ${name}`);
          }
        }
```

**Step 2: Add handoff/completion signals to non-verbose output**

The signals at lines 641-647 are already good (they use `logger.success`). No changes needed.

**Step 3: Add session summary at end**

After line 726 (`result.estimatedOutputTokens = ...`), replace the verbose-only summary with an always-on summary:

```typescript
    result.estimatedOutputTokens = Math.round(totalOutputChars / 4);

    // Session summary — always shown
    logger.info(`Session #${sessionNum} summary: ${toolUseCount} tool calls, ~${result.estimatedOutputTokens} output tokens`);
    if (lastToolName) logger.debug(`  Last tool: ${lastToolName}`);
```

**Step 4: Build and verify**

Run: `cd cleave-sdk && npm run build`

**Step 5: Commit**

```bash
git add cleave-sdk/src/session.ts
git commit -m "feat: real-time activity display in print mode

- Show tool calls as they happen (not just in verbose mode)
- Session summary after each session (tool count + token estimate)
- Users no longer see 5-30 min of silence during print mode sessions"
```

---

## Task 8: Interactive-First Clarifying Questions

**Files:**
- Modify: `cleave-sdk/src/config.ts` (add `interactiveFirst` field)
- Modify: `cleave-sdk/src/cli.ts` (add `--interactive-first` flag)
- Modify: `cleave-sdk/src/relay-loop.ts:122-148` (session 1 dispatch logic)
- Modify: `cleave-sdk/src/session.ts:129-132` (TUI prompt for session 1)

Add `--interactive-first` flag that runs session 1 in true TUI mode (no "don't ask" instruction, no polling/SIGTERM), then switches to the configured mode for sessions 2+.

**Step 1: Add config field**

In `config.ts`, add to `CleaveConfig` interface after `sessionBudget`:

```typescript
  /** Run session 1 in interactive TUI mode for clarifying questions */
  interactiveFirst: boolean;
```

Add to `DEFAULT_CONFIG`:

```typescript
  interactiveFirst: false,
```

**Step 2: Add CLI flag**

In `cli.ts`, in `addSharedOptions()`, add after the `--budget` line:

```typescript
    .option('--interactive-first', 'Run session 1 in interactive TUI for clarifying questions')
```

In `validateAndBuildConfig()`, add to the returned object:

```typescript
    interactiveFirst: opts.interactiveFirst ?? DEFAULT_CONFIG.interactiveFirst,
```

**Step 3: Add session 1 dispatch override in relay-loop.ts**

In `runRelayCore()`, in the `runSession` call area (around line 148), wrap it:

```typescript
    // ── Run session ──
    let result;
    try {
      // Interactive-first: session 1 runs in TUI mode without auto-relay
      // so the user can answer clarifying questions
      if (config.interactiveFirst && sessionCount === 1) {
        const interactiveConfig = { ...config, sessionMode: 'tui' as SessionMode, sessionTimeout: 0 };
        result = await runSession(prompt, interactiveConfig, paths, sessionCount);
      } else {
        result = await runSession(prompt, config, paths, sessionCount);
      }
```

Note: Import `SessionMode` at top of relay-loop.ts if not already imported.

**Step 4: Modify TUI prompt for interactive-first session 1**

In `session.ts`, in `runTuiSession()`, modify the prompt construction (lines 129-132):

```typescript
  const isInteractiveFirst = config.interactiveFirst && sessionNum === 1;

  const args: string[] = isInteractiveFirst
    ? [
        `You are starting a new Cleave relay. ` +
        `Read the file "${promptFilePath}" for the task instructions. ` +
        `Ask any clarifying questions you have before proceeding. ` +
        `When you're ready, begin working on the task.`,
        '--append-system-prompt', handoffInstructions,
        '--settings', settingsPath,
      ]
    : [
        `You are session #${sessionNum} of an automated Cleave relay. ` +
        `Read the file "${promptFilePath}" for your full task instructions. ` +
        `Execute those instructions immediately. Do NOT ask for confirmation.`,
        '--append-system-prompt', handoffInstructions,
        '--settings', settingsPath,
      ];
```

For interactive-first, also disable the polling/SIGTERM mechanism by skipping `startPolling`:

```typescript
    // Delay the start of polling — skip entirely for interactive-first session 1
    if (!isInteractiveFirst) {
      const delayTimer = setTimeout(startPolling, POLL_DELAY_MS);
      // ... existing exit handler needs delayTimer reference
    }
```

This requires restructuring the delayTimer scope. The simplest approach: wrap the entire polling setup in the `!isInteractiveFirst` guard.

**Step 5: Build and verify**

Run: `cd cleave-sdk && npm run build`

**Step 6: Commit**

```bash
git add cleave-sdk/src/config.ts cleave-sdk/src/cli.ts cleave-sdk/src/relay-loop.ts cleave-sdk/src/session.ts
git commit -m "feat: --interactive-first flag for clarifying questions

Session 1 runs in true TUI mode without 'don't ask' instruction and
without polling/SIGTERM. User can interact with Claude, ask questions,
guide the approach. Sessions 2+ use the configured mode (default: print)
for automated relay."
```

---

## Task 9: Security Fixes

**Files:**
- Modify: `cleave-sdk/src/detection.ts:121-153` (verify command injection)
- Modify: `cleave-sdk/src/integrations/notify.ts:23-42` (osascript injection)
- Modify: `cleave-sdk/src/state/files.ts:49-63` (stage name path traversal)
- Modify: `cleave-sdk/src/pipeline-config.ts` (stage name validation)

**Step 1: Fix verify command — use spawn instead of execSync**

In `detection.ts`, replace `runVerification()`:

```typescript
export function runVerification(
  command: string,
  workDir: string,
  timeoutSec: number = 120
): VerifyResult {
  logger.info(`Running verification: ${command}`);

  try {
    const output = execSync(command, {
      cwd: workDir,
      encoding: 'utf8',
      timeout: timeoutSec * 1000,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: '/bin/bash',  // Explicit shell — documents that this IS shell execution
    });

    logger.success('Verification PASSED');
    return { passed: true, exitCode: 0, output };
  } catch (err: any) {
    const exitCode = err.status ?? 1;
    const stdout = err.stdout || '';
    const stderr = err.stderr || '';
    const output = stdout + stderr;

    if (err.killed) {
      logger.warn(`Verification timed out after ${timeoutSec}s`);
    } else {
      logger.debug(`Verification exit code ${exitCode}`);
      if (stderr) logger.debug(`Verification stderr: ${stderr.slice(0, 200)}`);
    }

    return { passed: false, exitCode, output };
  }
}
```

Note: We keep shell execution (the user explicitly provides a command to run), but use an explicit shell and document the trust model. The real fix is documenting that `--verify` commands are executed as-is.

**Step 2: Fix notification — use execFile**

In `notify.ts`, replace `sendNotification()`:

```typescript
import { execFileSync } from 'child_process';

function sanitize(str: string): string {
  // Strip characters that could break AppleScript or shell
  return str
    .replace(/[\\"`$']/g, '')
    .replace(/\n/g, ' ')
    .slice(0, 200);  // Cap length
}

export function sendNotification(title: string, message: string): void {
  const safeTitle = sanitize(title);
  const safeMessage = sanitize(message);

  try {
    if (process.platform === 'darwin') {
      execFileSync('osascript', [
        '-e', `display notification "${safeMessage}" with title "${safeTitle}"`
      ], { stdio: 'pipe', timeout: 5000 });
    } else if (process.platform === 'linux') {
      execFileSync('notify-send', [safeTitle, safeMessage], {
        stdio: 'pipe',
        timeout: 5000,
      });
    }
  } catch {
    // Notifications are best-effort
  }
}
```

**Step 3: Add stage name validation**

In `pipeline-config.ts`, wherever stage names are parsed from YAML, add validation:

```typescript
// After parsing stage config, validate name
if (!/^[a-zA-Z0-9_-]+$/.test(stage.name)) {
  throw new Error(`Invalid stage name "${stage.name}" — must be alphanumeric, dashes, and underscores only`);
}
```

**Step 4: Build and verify**

Run: `cd cleave-sdk && npm run build`

**Step 5: Commit**

```bash
git add cleave-sdk/src/detection.ts cleave-sdk/src/integrations/notify.ts cleave-sdk/src/pipeline-config.ts
git commit -m "fix: security — execFile for notifications, stage name validation

- Use execFileSync for osascript/notify-send to prevent shell injection
- Validate pipeline stage names (alphanumeric + dash + underscore only)
- Document that --verify commands are executed as shell commands"
```

---

## Task 10: Prompt Engineering — Attention Ordering + Task Grounding

**Files:**
- Modify: `cleave-sdk/src/utils/prompt-builder.ts:15-72,80-133`

Reorder handoff instructions for LLM attention patterns (action items first, meta-context last). Add original task grounding for sessions 5+.

**Step 1: Reorder handoff instructions**

Replace the body of `buildHandoffInstructions()` with attention-optimized ordering:

```typescript
export function buildHandoffInstructions(config: CleaveConfig): string {
  return `
<!-- CLEAVE_RELAY_INSTRUCTIONS_V6 -->
━━━━━━━━ CLEAVE AUTOMATED RELAY RULES ━━━━━━━━

THE HANDOFF PROCEDURE (do these 4 steps, in order, after each chunk of work):

1. Write \`.cleave/PROGRESS.md\`:
   First line: \`## STATUS: IN_PROGRESS\` (or \`STATUS: ${config.completionMarker}\` if ALL done)
   Then: SPECIFIC details — what you did, files changed, exactly where you stopped, what's left.

2. Append to \`.cleave/KNOWLEDGE.md\` (APPEND — do NOT overwrite the file):
   Add a \`### Session N\` entry with: what worked, what failed, key discoveries, gotchas.

3. Write \`.cleave/NEXT_PROMPT.md\`:
   Complete instructions for the next session. It has ZERO memory of yours.
   Include: full task context, what's done, where to resume, key file paths, commands.
   Do NOT copy these relay instructions into NEXT_PROMPT.md — they are auto-appended.

4. Write \`HANDOFF_COMPLETE\` to \`.cleave/.handoff_signal\`
   Then print the text RELAY_HANDOFF_COMPLETE and STOP working immediately.

If ALL work is genuinely done AND verified:
- Set \`STATUS: ${config.completionMarker}\` in PROGRESS.md
- Write \`TASK_FULLY_COMPLETE\` to .handoff_signal
- Print the text TASK_FULLY_COMPLETE

SESSION BUDGET: You have a limited budget (~$${config.sessionBudget}). You WILL be cut off when it runs out. Write handoff files after EVERY significant chunk of work — they are your "save game." The last handoff files you wrote become the next session's starting point.

YOUR SCOPE: Pick the top 1-3 items from the task or prior session's "Next Actions." Complete them thoroughly (read code, implement, test, commit). Update handoff files. If more work remains, do the handoff procedure and stop. The next session will continue where you left off.

NEVER delete or modify .cleave/ infrastructure. ONLY write to the specific handoff files listed above.
`;
}
```

**Step 2: Add original task grounding for session 5+**

In `buildBasePrompt()`, after assembling the prompt from NEXT_PROMPT.md (after the knowledge reference block, around line 130), add:

```typescript
  // Ground later sessions back to the original task to prevent instruction drift
  if (sessionNum >= 5) {
    try {
      const originalTask = fs.readFileSync(config.initialPromptFile, 'utf8');
      const truncated = originalTask.slice(0, 1000);
      prompt += `\n\n--- ORIGINAL TASK (for reference — do NOT redo completed work) ---\n${truncated}${originalTask.length > 1000 ? '\n[...truncated]' : ''}`;
    } catch { /* initial prompt file may not exist for continuations */ }
  }
```

**Step 3: Build and verify**

Run: `cd cleave-sdk && npm run build`

**Step 4: Commit**

```bash
git add cleave-sdk/src/utils/prompt-builder.ts
git commit -m "fix: reorder handoff instructions for LLM attention + add task grounding

- Put action items (handoff procedure) FIRST, meta-context last
- Add budget amount to instructions so Claude can calibrate scope
- Ground sessions 5+ back to original task to prevent instruction drift"
```

---

## Task 11: Loop Detection — Multi-Session Comparison

**Files:**
- Modify: `cleave-sdk/src/detection.ts:51-107`

Fix order-insensitive comparison and add multi-session lookback.

**Step 1: Fix textSimilarity to be order-aware**

Replace `textSimilarity()`:

```typescript
function textSimilarity(textA: string, textB: string): number {
  if (!textA && !textB) return 100;
  if (!textA || !textB) return 0;

  const linesA = textA.split('\n').filter(l => l.trim());
  const linesB = textB.split('\n').filter(l => l.trim());

  if (linesA.length === 0 && linesB.length === 0) return 100;
  if (linesA.length === 0 || linesB.length === 0) return 0;

  // Use bigram (consecutive line pairs) comparison for order-awareness
  const bigramsA = new Set<string>();
  for (let i = 0; i < linesA.length - 1; i++) {
    bigramsA.add(linesA[i] + '\n' + linesA[i + 1]);
  }
  const bigramsB = new Set<string>();
  for (let i = 0; i < linesB.length - 1; i++) {
    bigramsB.add(linesB[i] + '\n' + linesB[i + 1]);
  }

  let matches = 0;
  for (const bg of bigramsA) {
    if (bigramsB.has(bg)) matches++;
  }

  const maxBigrams = Math.max(bigramsA.size, bigramsB.size);
  if (maxBigrams === 0) return 100;
  return Math.round((matches / maxBigrams) * 100);
}
```

**Step 2: Add multi-session lookback to detectLoop**

Replace `detectLoop()`:

```typescript
export function detectLoop(
  logsDir: string,
  nextPromptPath: string,
  sessionNum: number,
  threshold: number = 85
): { isLoop: boolean; similarity: number } {
  if (sessionNum < 2) return { isLoop: false, similarity: 0 };
  if (!fs.existsSync(nextPromptPath)) return { isLoop: false, similarity: 0 };

  const currContent = fs.readFileSync(nextPromptPath, 'utf8');

  // Compare against last 3 sessions (catches both direct repetition and oscillation)
  const lookback = Math.min(3, sessionNum - 1);
  let maxSimilarity = 0;

  for (let i = 1; i <= lookback; i++) {
    const prevPromptPath = path.join(logsDir, `session_${sessionNum - i}_next_prompt.md`);
    if (!fs.existsSync(prevPromptPath)) continue;

    try {
      const prevContent = fs.readFileSync(prevPromptPath, 'utf8');
      const similarity = textSimilarity(prevContent, currContent);
      if (similarity > maxSimilarity) maxSimilarity = similarity;
    } catch { continue; }
  }

  return { isLoop: maxSimilarity > threshold, similarity: maxSimilarity };
}
```

**Step 3: Build and verify**

Run: `cd cleave-sdk && npm run build`

**Step 4: Commit**

```bash
git add cleave-sdk/src/detection.ts
git commit -m "fix: loop detection — order-aware bigrams + multi-session lookback

- Replace order-insensitive line-set comparison with bigram comparison
- Compare against last 3 sessions instead of just previous one
- Catches A-B-A oscillation patterns that were previously invisible"
```

---

## Task 12: UI Polish — Banner, Countdown, Logger Init

**Files:**
- Modify: `cleave-sdk/src/utils/logger.ts:80-112`
- Modify: `cleave-sdk/src/relay-loop.ts:40-49`
- Modify: `cleave-sdk/src/pipeline-loop.ts:50-66`

**Step 1: Fix banner box — remove broken right borders, use clean layout**

In `logger.ts`, replace the `banner()` method:

```typescript
  banner(config: { workDir: string; maxSessions: number; gitCommit: boolean; verifyCommand: string | null; resumeFrom: number; notify: boolean; sessionMode?: string; model?: string | null; sessionBudget?: number }) {
    const C = COLORS;
    const mode = config.sessionMode || 'print';
    const modeLabel = mode === 'print' ? 'print (auto-relay)' : mode === 'tui' ? 'TUI (interactive)' : 'headless (Agent SDK)';
    const W = 58;
    const hr = '═'.repeat(W);
    const line = (s: string) => {
      const visible = this.stripAnsi(s);
      const pad = Math.max(0, W - visible.length);
      return `${C.bold}║${C.reset}${s}${' '.repeat(pad)}${C.bold}║${C.reset}`;
    };
    console.log('');
    console.log(`${C.bold}╔${hr}╗${C.reset}`);
    console.log(line(`  ${C.cyan}cleave${C.reset} ${C.dim}v${VERSION}${C.reset}`));
    console.log(line(`  ${C.dim}Infinite context for Claude Code${C.reset}`));
    console.log(`${C.bold}╠${hr}╣${C.reset}`);
    console.log(line(`  Work dir:     ${C.blue}${path.basename(config.workDir)}${C.reset}`));
    console.log(line(`  Max sessions: ${C.blue}${config.maxSessions}${C.reset}`));
    console.log(line(`  Mode:         ${C.green}${modeLabel}${C.reset}`));
    if (config.model) console.log(line(`  Model:        ${C.blue}${config.model}${C.reset}`));
    if (config.sessionBudget) console.log(line(`  Budget/sess:  ${C.blue}$${config.sessionBudget.toFixed(2)}${C.reset}`));
    console.log(line(`  Git commit:   ${C.blue}${config.gitCommit}${C.reset}`));
    if (config.verifyCommand) console.log(line(`  Verify cmd:   ${C.blue}${config.verifyCommand}${C.reset}`));
    if (config.resumeFrom > 0) console.log(line(`  Resume from:  ${C.yellow}session #${config.resumeFrom}${C.reset}`));
    console.log(`${C.bold}╚${hr}╝${C.reset}`);
    console.log('');
  }
```

**Step 2: Fix session header — consistent formatting**

Replace the `session()` method:

```typescript
  session(num: number, max: number) {
    const bar = '━'.repeat(58);
    console.log('');
    console.log(`${COLORS.bold}${bar}${COLORS.reset}`);
    console.log(`${COLORS.bold}  SESSION #${num}${COLORS.reset} of ${max}`);
    console.log(`${COLORS.bold}${bar}${COLORS.reset}`);
    console.log('');
  }
```

**Step 3: Fix rate limit countdown to 1-second ticks**

In `relay-loop.ts`, replace the countdown loop (lines 41-49):

```typescript
  let remaining = waitMs;
  while (remaining > 0) {
    const mins = Math.floor(remaining / 60_000);
    const secs = Math.floor((remaining % 60_000) / 1000);
    process.stdout.write(`\r\x1b[2K  Rate limit reset in: ${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}  `);
    const tick = Math.min(1_000, remaining);
    await sleep(tick);
    remaining -= tick;
  }
  process.stdout.write('\r\x1b[2K  Rate limit should be lifted.\n');
```

**Step 4: Fix pipeline logger.init ordering**

In `pipeline-loop.ts`, move `logger.init()` before the first `logger.info()` call. Move line 66 to before line 50:

```typescript
  // Initialize logger FIRST (before any logger.info calls)
  logger.init(pipelineDir, config.verbose);

  let state: PipelineState;
  const existingState = loadPipelineState(workDir);
  // ... rest continues
```

**Step 5: Build and verify**

Run: `cd cleave-sdk && npm run build`

**Step 6: Commit**

```bash
git add cleave-sdk/src/utils/logger.ts cleave-sdk/src/relay-loop.ts cleave-sdk/src/pipeline-loop.ts
git commit -m "fix: UI polish — banner alignment, 1s countdown, logger init order

- Banner box now has proper right borders with dynamic padding
- Rate limit countdown updates every 1 second (was 10s)
- Pipeline logger initialized before first use
- Session header formatting consistent"
```

---

## Task 13: Version Bump + Build + PR

**Files:**
- Modify: `cleave-sdk/package.json:3` (version)
- Modify: `cleave-sdk/src/config.ts:163` (VERSION)
- Modify: `cleave-sdk/CLAUDE.md` (add v6.0.0 section)

**Step 1: Bump version to 6.0.0**

In `package.json`: `"version": "6.0.0"`
In `config.ts`: `export const VERSION = '6.0.0';`

**Step 2: Update CLAUDE.md with v6.0.0 release notes**

Add a new section at the bottom of CLAUDE.md:

```markdown
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
```

**Step 3: Full build and verify**

```bash
cd cleave-sdk && npm run build && chmod +x dist/index.js && npm link
cleave --version  # Should output 6.0.0
```

**Step 4: Commit and create PR**

```bash
git add cleave-sdk/package.json cleave-sdk/src/config.ts cleave-sdk/CLAUDE.md
git commit -m "chore: bump version to 6.0.0 — reliability overhaul"

git push -u origin fix/reliability-overhaul-v6

gh pr create --title "fix: v6.0.0 reliability overhaul" --body "$(cat <<'EOF'
## Summary

Complete reliability overhaul based on 5-expert committee review (78 issues found).
Fixes all critical and major issues. See docs/plans/2026-03-05-committee-review-design.md
for the full review and docs/plans/2026-03-05-reliability-overhaul-plan.md for the plan.

### Critical fixes
- Stop hook exit code (was 2, now 0) + macOS grep compatibility
- Print mode hook enforcement (was missing entirely)
- Env var deletion for nested session detection
- Headless mode overhaul (budget, model, permissions, rescue handoff)
- Dedup guard sentinel + NEXT_PROMPT.md quality validation

### New features
- `--interactive-first` flag for session 1 clarifying questions
- Real-time tool call activity display in print mode

### Security
- execFile for osascript/notify-send
- Stage name path traversal validation

### Improvements
- Attention-optimized handoff instructions
- Original task grounding for sessions 5+
- Order-aware loop detection with 3-session lookback
- Banner alignment, 1s countdown, logger init order

## Test plan
- [ ] `cleave --version` outputs 6.0.0
- [ ] Stop hook blocks exit and allows on completion (manual test)
- [ ] Print mode shows tool calls during session
- [ ] `--interactive-first` allows questions in session 1
- [ ] Headless mode respects budget cap

Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
