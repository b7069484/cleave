# Fix Autorelay Between Sessions — Phase 1 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the root cause of TUI mode autorelay failure — sessions don't chain because the handoff poller can never detect a normal (IN_PROGRESS) handoff completion.

**Architecture:** Add a `.handoff_signal` file that Claude writes as the final handoff step. The TUI poller detects this file instead of scanning PROGRESS.md for strings Claude only prints to stdout. Add session timeout, file stability checks, and fix recursive instruction bloat.

**Tech Stack:** TypeScript (cleave-sdk), Bash (shell edition + hook scripts)

**Repo:** `/Users/israelbitton/Desktop/Cleave Code/cleave 4/`
**Branch policy:** NEVER push to `main`. Create `fix/autorelay-handoff-signal` branch.

---

### Task 1: Create feature branch

**Step 1: Create and switch to feature branch**

```bash
cd "/Users/israelbitton/Desktop/Cleave Code/cleave 4"
git checkout -b fix/autorelay-handoff-signal
```

**Step 2: Verify**

```bash
git branch --show-current
```
Expected: `fix/autorelay-handoff-signal`

---

### Task 2: Add `.handoff_signal` to RelayPaths and cleanup logic

**Files:**
- Modify: `cleave-sdk/src/state/files.ts`

**Step 1: Add `handoffSignalFile` to the `RelayPaths` interface**

In `cleave-sdk/src/state/files.ts:9-19`, add `handoffSignalFile` to the interface:

```typescript
export interface RelayPaths {
  relayDir: string;
  progressFile: string;
  nextPromptFile: string;
  knowledgeFile: string;
  statusFile: string;
  logsDir: string;
  sessionStartMarker: string;
  activeRelayMarker: string;
  sessionCountFile: string;
  handoffSignalFile: string;   // <-- ADD THIS
}
```

**Step 2: Add to `resolvePaths()`**

In `resolvePaths()` (~line 31-44), add the new path:

```typescript
export function resolvePaths(workDir: string): RelayPaths {
  const relayDir = path.join(workDir, '.cleave');
  return {
    relayDir,
    progressFile: path.join(relayDir, 'PROGRESS.md'),
    nextPromptFile: path.join(relayDir, 'NEXT_PROMPT.md'),
    knowledgeFile: path.join(relayDir, 'KNOWLEDGE.md'),
    statusFile: path.join(relayDir, 'status.json'),
    logsDir: path.join(relayDir, 'logs'),
    sessionStartMarker: path.join(relayDir, '.session_start'),
    activeRelayMarker: path.join(relayDir, '.active_relay'),
    sessionCountFile: path.join(relayDir, '.session_count'),
    handoffSignalFile: path.join(relayDir, '.handoff_signal'),   // <-- ADD
  };
}
```

**Step 3: Add to `resolveStagePaths()`**

In `resolveStagePaths()` (~line 47-60), add the same:

```typescript
export function resolveStagePaths(workDir: string, stageName: string): RelayPaths {
  const stageDir = path.join(workDir, '.cleave', 'stages', stageName);
  return {
    relayDir: stageDir,
    progressFile: path.join(stageDir, 'PROGRESS.md'),
    nextPromptFile: path.join(stageDir, 'NEXT_PROMPT.md'),
    knowledgeFile: path.join(stageDir, 'KNOWLEDGE.md'),
    statusFile: path.join(stageDir, 'status.json'),
    logsDir: path.join(stageDir, 'logs'),
    sessionStartMarker: path.join(stageDir, '.session_start'),
    activeRelayMarker: path.join(stageDir, '.active_relay'),
    sessionCountFile: path.join(stageDir, '.session_count'),
    handoffSignalFile: path.join(stageDir, '.handoff_signal'),   // <-- ADD
  };
}
```

**Step 4: Clear signal file at session start**

In `touchSessionStart()` (~line 148-151), add cleanup of the previous session's signal:

```typescript
export function touchSessionStart(paths: RelayPaths, sessionNum: number): void {
  fs.writeFileSync(paths.sessionStartMarker, new Date().toISOString());
  fs.writeFileSync(paths.sessionCountFile, String(sessionNum));
  // Clear handoff signal from previous session so the poller starts fresh
  try { if (fs.existsSync(paths.handoffSignalFile)) fs.unlinkSync(paths.handoffSignalFile); } catch { /* best effort */ }
}
```

**Step 5: Add signal file to cleanupRelay()**

In `cleanupRelay()` (~line 317-321), add `handoffSignalFile` to cleanup list:

```typescript
export function cleanupRelay(paths: RelayPaths): void {
  for (const f of [paths.activeRelayMarker, paths.sessionStartMarker, paths.handoffSignalFile]) {
    try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch { /* best effort */ }
  }
}
```

**Step 6: Build and verify compilation**

```bash
cd "/Users/israelbitton/Desktop/Cleave Code/cleave 4/cleave-sdk"
npm run build
```
Expected: No TypeScript errors. (Downstream files that use `RelayPaths` will now require the new field, but since we're changing `resolvePaths` and `resolveStagePaths` which construct the object, no other files need changes for this field.)

**Step 7: Commit**

```bash
cd "/Users/israelbitton/Desktop/Cleave Code/cleave 4"
git add cleave-sdk/src/state/files.ts
git commit -m "feat: add .handoff_signal to RelayPaths for autorelay detection"
```

---

### Task 3: Rewrite `isHandoffReady()` to use the signal file

**Files:**
- Modify: `cleave-sdk/src/session.ts`

This is THE core fix. Replace the broken detection logic.

**Step 1: Rewrite `isHandoffReady()`**

Replace the entire `isHandoffReady()` function (lines 48-100 of `session.ts`) with:

```typescript
/**
 * Check if handoff files are complete and ready for relay.
 *
 * Detection strategy (in order):
 * 1. Completion marker in PROGRESS.md — task is fully done
 * 2. .handoff_signal file exists and is fresh — Claude wrote it as Step 4
 *
 * IMPORTANT: We do NOT infer handoff from file presence alone.
 * KNOWLEDGE.md is initialized with boilerplate (always non-empty), so
 * checking "all files present + fresh + non-empty" would SIGTERM Claude
 * mid-session the moment it touches PROGRESS.md + NEXT_PROMPT.md.
 * An explicit signal is required.
 */
function isHandoffReady(paths: RelayPaths, completionMarker: string): boolean {
  try {
    // 1. Check for completion marker (task fully done)
    if (fs.existsSync(paths.progressFile)) {
      const content = fs.readFileSync(paths.progressFile, 'utf8').toLowerCase();
      const marker = completionMarker.toLowerCase();
      if (content.includes(marker) || content.includes('task_fully_complete')) {
        return true;
      }
    }

    // 2. Check for explicit handoff signal file
    if (fs.existsSync(paths.handoffSignalFile)) {
      // Verify it was written during THIS session (not leftover from a previous one)
      if (fs.existsSync(paths.sessionStartMarker)) {
        const startTime = fs.statSync(paths.sessionStartMarker).mtimeMs;
        const signalTime = fs.statSync(paths.handoffSignalFile).mtimeMs;
        if (signalTime > startTime) {
          return true;
        }
        // Signal file is stale (from a prior session) — ignore it
        return false;
      }
      // No session start marker — trust the signal file
      return true;
    }

    return false;
  } catch {
    return false;
  }
}
```

**Step 2: Build and verify**

```bash
cd "/Users/israelbitton/Desktop/Cleave Code/cleave 4/cleave-sdk"
npm run build
```
Expected: Clean build, no errors.

**Step 3: Commit**

```bash
cd "/Users/israelbitton/Desktop/Cleave Code/cleave 4"
git add cleave-sdk/src/session.ts
git commit -m "fix: rewrite isHandoffReady() to use .handoff_signal file

The old logic looked for RELAY_HANDOFF_COMPLETE in PROGRESS.md, but
the handoff instructions told Claude to print it to stdout. In TUI mode
stdout is not captured, so the poller never detected handoffs.

Now Claude writes a .handoff_signal file as Step 4, which the poller
detects reliably."
```

---

### Task 4: Update handoff instructions to write the signal file

**Files:**
- Modify: `cleave-sdk/src/utils/prompt-builder.ts`

**Step 1: Update Step 4 in `buildHandoffInstructions()`**

In `prompt-builder.ts`, find the Step 4 block (~lines 75-76):

```
**STEP 4 — Print exactly:** \`RELAY_HANDOFF_COMPLETE\`
Then stop immediately.
```

Replace with:

```
**STEP 4 — Signal completion:**
Write the text \`HANDOFF_COMPLETE\` to the file \`.cleave/.handoff_signal\` (create or overwrite).
Then print \`RELAY_HANDOFF_COMPLETE\` to confirm, and stop immediately.
```

**Step 2: Update the completion case too**

The line just after Step 4 says:
```
If ALL work is done, write \`STATUS: ${config.completionMarker}\` in PROGRESS.md
and print \`TASK_FULLY_COMPLETE\` instead.
```

Replace with:
```
If ALL work is done, write \`STATUS: ${config.completionMarker}\` in PROGRESS.md,
write \`TASK_FULLY_COMPLETE\` to \`.cleave/.handoff_signal\`,
and print \`TASK_FULLY_COMPLETE\` to confirm.
```

**Step 3: Add deduplication guard for recursive instructions**

At the top of `buildHandoffInstructions()`, this function is called every session. But Claude is told to include "these same handoff instructions" in NEXT_PROMPT.md, leading to duplicated instructions compounding across sessions. Fix this by adding a note to the instructions.

Find the line in the STEP 3 block:
```
- These same handoff instructions
```

Replace with:
```
- Do NOT copy these relay instructions into NEXT_PROMPT.md — they are appended automatically by the relay system
```

**Step 4: Add deduplication in the callers**

In `buildSessionPrompt()` (~line 155-157), add a dedup check:

```typescript
export function buildSessionPrompt(config: CleaveConfig, sessionNum: number): string {
  const base = buildBasePrompt(config, sessionNum);
  // Don't double-append if the prompt already contains handoff instructions
  // (happens when NEXT_PROMPT.md from prior session included them)
  if (base.includes('AUTOMATED SESSION RELAY')) {
    return base;
  }
  return base + buildHandoffInstructions(config);
}
```

Do the same check in `buildTaskPrompt()` is NOT needed — TUI mode appends via `--append-system-prompt` which is always separate. But for safety, document why.

**Step 5: Update the stage handoff instructions too**

In `buildStageHandoffInstructions()` (~line 162-189), add the same signal file instruction. After the line about context budget, add:

```
**HANDOFF SIGNAL:** When you complete the handoff procedure, write \`HANDOFF_COMPLETE\`
to \`.cleave/stages/${stageName}/.handoff_signal\` as your final action.
```

**Step 6: Build and verify**

```bash
cd "/Users/israelbitton/Desktop/Cleave Code/cleave 4/cleave-sdk"
npm run build
```

**Step 7: Commit**

```bash
cd "/Users/israelbitton/Desktop/Cleave Code/cleave 4"
git add cleave-sdk/src/utils/prompt-builder.ts
git commit -m "fix: update handoff instructions — write .handoff_signal file, no recursive include

Step 4 now tells Claude to write a .handoff_signal file that the TUI
poller can detect. Also tells Claude NOT to copy relay instructions
into NEXT_PROMPT.md (they're auto-appended), fixing context bloat."
```

---

### Task 5: Add session timeout

**Files:**
- Modify: `cleave-sdk/src/config.ts`
- Modify: `cleave-sdk/src/cli.ts`
- Modify: `cleave-sdk/src/session.ts`

**Step 1: Add `sessionTimeout` to config**

In `config.ts`, add to the `CleaveConfig` interface (~after line 75):

```typescript
  /** Maximum seconds for a single session before forced SIGTERM (0 = no limit) */
  sessionTimeout: number;
```

Add to `DEFAULT_CONFIG` (~after line 113):

```typescript
  sessionTimeout: 1800,   // 30 minutes
```

Add validation in `validateConfig()`:

```typescript
  if (config.sessionTimeout < 0 || config.sessionTimeout > 86400) {
    throw new Error('sessionTimeout must be between 0 and 86400 (24 hours)');
  }
```

**Step 2: Add CLI option**

In `cli.ts`, in the `addSharedOptions()` function, add:

```typescript
    .option('--session-timeout <seconds>', 'Max seconds per session (0=unlimited)', String(DEFAULT_CONFIG.sessionTimeout))
```

In `validateAndBuildConfig()`, add parsing:

```typescript
  const sessionTimeout = parseInt(opts.sessionTimeout || String(DEFAULT_CONFIG.sessionTimeout), 10);
  if (isNaN(sessionTimeout) || sessionTimeout < 0 || sessionTimeout > 86400) {
    program.error('Error: --session-timeout must be between 0 and 86400');
  }
```

And include it in the return object:

```typescript
  return {
    ...existing fields...,
    sessionTimeout,
  };
```

**Step 3: Add timeout to TUI session runner**

In `session.ts:runTuiSession()`, after spawning the child process and setting up the polling delay, add:

```typescript
    // ── Session timeout ──
    // If the session runs longer than sessionTimeout, force-kill it.
    // Prevents infinite hangs if Claude never triggers a handoff.
    let timeoutTimer: ReturnType<typeof setTimeout> | null = null;
    if (config.sessionTimeout > 0) {
      timeoutTimer = setTimeout(() => {
        if (!killedByRelay) {
          logger.warn(`Session #${sessionNum} exceeded timeout (${config.sessionTimeout}s) — forcing SIGTERM`);
          killedByRelay = true;  // Treat timeout kill same as relay kill (non-crash)
          if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
          try { child.kill('SIGTERM'); } catch { /* already exited */ }
        }
      }, config.sessionTimeout * 1000);
    }
```

In the `child.on('exit')` callback, clear the timeout:

```typescript
      child.on('exit', (code) => {
        clearTimeout(delayTimer);
        if (pollTimer) clearInterval(pollTimer);
        if (timeoutTimer) clearTimeout(timeoutTimer);
        resolve(killedByRelay ? 0 : (code ?? 1));
      });
```

And in the `finally` block:

```typescript
  } finally {
    if (pollTimer) clearInterval(pollTimer);
    if (timeoutTimer) clearTimeout(timeoutTimer);
  }
```

**Step 4: Build and verify**

```bash
cd "/Users/israelbitton/Desktop/Cleave Code/cleave 4/cleave-sdk"
npm run build
```

**Step 5: Commit**

```bash
cd "/Users/israelbitton/Desktop/Cleave Code/cleave 4"
git add cleave-sdk/src/config.ts cleave-sdk/src/cli.ts cleave-sdk/src/session.ts
git commit -m "feat: add --session-timeout to prevent infinite TUI hangs

Default 30 minutes. If Claude never completes a handoff within this
window, the TUI is SIGTERMed and the session is treated as a crash
(triggers retry or stops after 3 consecutive failures)."
```

---

### Task 6: Add file stability check before SIGTERM

**Files:**
- Modify: `cleave-sdk/src/session.ts`

The poller should verify files aren't still being written before killing Claude.

**Step 1: Add stability tracking to the poller**

In `runTuiSession()`, replace the polling logic (the `startPolling` function) with:

```typescript
    let lastSignalSize = -1;  // Track .handoff_signal size for stability check

    const startPolling = () => {
      pollTimer = setInterval(() => {
        if (isHandoffReady(paths, config.completionMarker)) {
          // Stability check: ensure NEXT_PROMPT.md size is stable between polls
          // (protects against SIGTERMing while Claude is mid-write)
          const currentSize = fs.existsSync(paths.nextPromptFile)
            ? fs.statSync(paths.nextPromptFile).size : 0;

          if (currentSize === lastSignalSize && lastSignalSize >= 0) {
            // Files stable for 2 consecutive polls — safe to kill
            logger.debug(`Handoff detected + files stable — terminating TUI session #${sessionNum}`);
            killedByRelay = true;
            if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
            // Grace period: 2 seconds for any final I/O
            setTimeout(() => {
              try { child.kill('SIGTERM'); } catch { /* already exited */ }
            }, 2_000);
          } else {
            // First detection or files still changing — wait for next poll
            lastSignalSize = currentSize;
            logger.debug(`Handoff detected but files may still be writing (${currentSize} bytes) — waiting for stability`);
          }
        } else {
          lastSignalSize = -1;  // Reset if handoff not ready
        }
      }, POLL_INTERVAL_MS);
    };
```

**Step 2: Build and verify**

```bash
cd "/Users/israelbitton/Desktop/Cleave Code/cleave 4/cleave-sdk"
npm run build
```

**Step 3: Commit**

```bash
cd "/Users/israelbitton/Desktop/Cleave Code/cleave 4"
git add cleave-sdk/src/session.ts
git commit -m "fix: add file stability check before SIGTERMing TUI

Wait for NEXT_PROMPT.md size to be stable across two consecutive
polls (10 seconds) before killing the TUI. Prevents corruption
from killing Claude mid-file-write."
```

---

### Task 7: Update shell hook scripts for signal file

**Files:**
- Modify: `cleave-sdk/scripts/stop-check.sh`
- Modify: `cleave-sdk/scripts/session-start.sh`

**Step 1: Update stop-check.sh**

Add the handoff signal file as a valid exit condition. After the completion marker check (~line 94) and before the file freshness check (~line 98), add:

```bash
# Check for handoff signal file (written by Claude as final handoff step)
HANDOFF_SIGNAL="$HANDOFF_DIR/.handoff_signal"
if [ -f "$HANDOFF_SIGNAL" ]; then
  # Verify it was written this session
  if [ -f "$SESSION_START" ] && [ "$HANDOFF_SIGNAL" -nt "$SESSION_START" ]; then
    exit 0
  elif [ ! -f "$SESSION_START" ]; then
    exit 0
  fi
fi
```

Also clean up the hardcoded project-specific markers on line 94. Replace:
```bash
if [ -f "$PROGRESS" ] && grep -qi "ALL_COMPLETE\|TASK_FULLY_COMPLETE\|IMAGE_AUDIT_COMPLETE\|MAPPINGS_FIXED\|LOADER_FIXED\|VIDEOS_FIXED\|PREVIEWS_FIXED\|ALL_VERIFIED" "$PROGRESS" 2>/dev/null; then
```
With:
```bash
if [ -f "$PROGRESS" ] && grep -qi "ALL_COMPLETE\|TASK_FULLY_COMPLETE" "$PROGRESS" 2>/dev/null; then
```

**Step 2: Update session-start.sh**

After the `touch "$CLEAVE_DIR/.session_start"` line (~line 35), add:

```bash
  # Clean handoff signal from previous session
  rm -f "$CLEAVE_DIR/.handoff_signal" 2>/dev/null || true
```

In the pipeline stage loop, also clean stage signal files:

```bash
    for STAGE_DIR in "$CLEAVE_DIR/stages"/*/; do
      if [ -d "$STAGE_DIR" ] && [ -f "${STAGE_DIR}.active_relay" ]; then
        touch "${STAGE_DIR}.session_start" 2>/dev/null || true
        rm -f "${STAGE_DIR}.handoff_signal" 2>/dev/null || true
      fi
    done
```

**Step 3: Build and verify**

```bash
cd "/Users/israelbitton/Desktop/Cleave Code/cleave 4/cleave-sdk"
npm run build
```

**Step 4: Commit**

```bash
cd "/Users/israelbitton/Desktop/Cleave Code/cleave 4"
git add cleave-sdk/scripts/stop-check.sh cleave-sdk/scripts/session-start.sh
git commit -m "fix: update shell hooks for .handoff_signal detection

Stop hook now allows exit when .handoff_signal is fresh.
SessionStart hook cleans stale signal files.
Removed hardcoded project-specific completion markers."
```

---

### Task 8: Update plugin hook scripts to match

**Files:**
- Modify: `cleave-plugin-v4/scripts/stop-check.sh`
- Modify: `cleave-plugin-v4/scripts/session-start.sh`

Apply the same changes from Task 7 to the plugin copies of these scripts.

**Step 1: Apply identical signal file check to plugin stop-check.sh**

Same changes as Task 7 Step 1, applied to `cleave-plugin-v4/scripts/stop-check.sh`.

**Step 2: Apply identical signal cleanup to plugin session-start.sh**

Same changes as Task 7 Step 2, applied to `cleave-plugin-v4/scripts/session-start.sh`.

**Step 3: Commit**

```bash
cd "/Users/israelbitton/Desktop/Cleave Code/cleave 4"
git add cleave-plugin-v4/scripts/stop-check.sh cleave-plugin-v4/scripts/session-start.sh
git commit -m "fix: sync plugin hook scripts with SDK signal file changes"
```

---

### Task 9: Update plugin skill with signal file instruction

**Files:**
- Modify: `cleave-plugin-v4/skills/session-relay/SKILL.md`

**Step 1: Update Step 4 in the SKILL.md handoff procedure**

Find the Step 4 section:
```
### Step 4 — Signal Completion
Print exactly one:
- **RELAY_HANDOFF_COMPLETE** — handing off to next session
- **TASK_FULLY_COMPLETE** — entire task is done

Then stop immediately.
```

Replace with:
```
### Step 4 — Signal Completion
Write a signal file and print confirmation:
- **Handoff:** Write `HANDOFF_COMPLETE` to `.cleave/.handoff_signal`, then print `RELAY_HANDOFF_COMPLETE`
- **Task done:** Write `TASK_FULLY_COMPLETE` to `.cleave/.handoff_signal`, then print `TASK_FULLY_COMPLETE`

Then stop immediately. The `.handoff_signal` file is what the relay system detects to start the next session.
```

**Step 2: Commit**

```bash
cd "/Users/israelbitton/Desktop/Cleave Code/cleave 4"
git add cleave-plugin-v4/skills/session-relay/SKILL.md
git commit -m "fix: update session-relay skill with .handoff_signal instruction"
```

---

### Task 10: Update bash shell edition handoff instructions

**Files:**
- Modify: `cleave-sdk/../cleave` (the bash script at repo root)

**Step 1: Update `build_handoff_instructions()` in the bash script**

In the root `cleave` bash script, find the Step 4 line (~line 240):
```
**STEP 4 — Print exactly:** \`RELAY_HANDOFF_COMPLETE\`
Then stop immediately.
```

Replace with:
```
**STEP 4 — Signal completion:**
Write the text \`HANDOFF_COMPLETE\` to \`.cleave/.handoff_signal\` (create or overwrite it).
Then print \`RELAY_HANDOFF_COMPLETE\` to confirm, and stop immediately.
```

Also update the completion case:
```
If ALL work is done, write \`STATUS: $COMPLETION_MARKER\` in PROGRESS.md
and print \`TASK_FULLY_COMPLETE\` instead.
```
Replace with:
```
If ALL work is done, write \`STATUS: $COMPLETION_MARKER\` in PROGRESS.md,
write \`TASK_FULLY_COMPLETE\` to \`.cleave/.handoff_signal\`,
and print \`TASK_FULLY_COMPLETE\` to confirm.
```

Also find the STEP 3 line:
```
- These same handoff instructions
```
Replace with:
```
- Do NOT copy these relay instructions into NEXT_PROMPT.md — they are appended automatically
```

**Step 2: Add signal file detection to the bash relay loop**

In the bash `is_complete()` function (~line 391), it only checks PROGRESS.md. The bash edition uses pipe mode (not TUI), so the autorelay issue is less severe (Claude exits naturally). But for consistency, add signal file detection to the session output check.

After the `is_complete` function, add:

```bash
has_handoff_signal() {
    [ -f "$RELAY_DIR/.handoff_signal" ]
}
```

**Step 3: Clean signal file at session start**

In the main relay loop, just before launching Claude Code (~line 522), add:

```bash
    # Clean handoff signal from previous session
    rm -f "$RELAY_DIR/.handoff_signal" 2>/dev/null
```

**Step 4: Commit**

```bash
cd "/Users/israelbitton/Desktop/Cleave Code/cleave 4"
git add cleave
git commit -m "fix: update bash edition with .handoff_signal and instruction dedup"
```

---

### Task 11: Update headless mode hooks for signal file

**Files:**
- Modify: `cleave-sdk/src/hooks.ts`

**Step 1: Add signal file check to programmatic Stop hook**

In `buildHooks()`, after the line that checks `checkHandoffFiles()` (~line 133), add a signal file check:

```typescript
            // Also check for handoff signal file
            if (fs.existsSync(paths.handoffSignalFile)) {
              logger.debug('Stop hook: handoff signal file found, allowing exit');
              return {};
            }
```

Place this BEFORE the missing/stale check so the signal file takes priority.

The updated hook function body should be:

```typescript
          async (_input: any) => {
            // If task is fully complete, allow exit
            if (isComplete(paths.progressFile, completionMarker)) {
              logger.debug('Stop hook: task complete, allowing exit');
              return {};
            }

            // Check for handoff signal file
            if (fs.existsSync(paths.handoffSignalFile)) {
              logger.debug('Stop hook: handoff signal file found, allowing exit');
              return {};
            }

            // Check if handoff files were written this session
            const { missing, stale } = checkHandoffFiles(paths);

            if (missing.length === 0 && stale.length === 0) {
              logger.debug('Stop hook: handoff files verified, allowing exit');
              return {};
            }

            // ... rest of blocking logic unchanged ...
          },
```

**Step 2: Build and verify**

```bash
cd "/Users/israelbitton/Desktop/Cleave Code/cleave 4/cleave-sdk"
npm run build
```

**Step 3: Commit**

```bash
cd "/Users/israelbitton/Desktop/Cleave Code/cleave 4"
git add cleave-sdk/src/hooks.ts
git commit -m "fix: add .handoff_signal check to headless mode Stop hook"
```

---

### Task 12: Bump version and final build

**Files:**
- Modify: `cleave-sdk/src/config.ts`
- Modify: `cleave-sdk/package.json`

**Step 1: Bump SDK version**

In `config.ts`, change:
```typescript
export const VERSION = '5.1.0';
```
To:
```typescript
export const VERSION = '5.2.0';
```

In `package.json`, change:
```json
"version": "5.1.0",
```
To:
```json
"version": "5.2.0",
```

**Step 2: Full build**

```bash
cd "/Users/israelbitton/Desktop/Cleave Code/cleave 4/cleave-sdk"
npm run build && chmod +x dist/index.js
```
Expected: Clean build, no errors.

**Step 3: Verify the built artifacts**

```bash
node dist/index.js --version
```
Expected: Output includes `5.2.0`

**Step 4: Commit**

```bash
cd "/Users/israelbitton/Desktop/Cleave Code/cleave 4"
git add cleave-sdk/src/config.ts cleave-sdk/package.json
git commit -m "chore: bump version to 5.2.0 — autorelay handoff signal fix"
```

---

### Task 13: Create pull request

**Step 1: Push branch**

```bash
cd "/Users/israelbitton/Desktop/Cleave Code/cleave 4"
git push -u origin fix/autorelay-handoff-signal
```

**Step 2: Create PR**

```bash
gh pr create --title "fix: autorelay handoff signal detection" --body "$(cat <<'EOF'
## Summary

- Adds `.handoff_signal` file as the explicit handoff detection mechanism
- The old poller looked for `RELAY_HANDOFF_COMPLETE` in PROGRESS.md, but Claude prints it to stdout (not captured in TUI mode) — so intermediate sessions never chained
- Now Claude writes `.cleave/.handoff_signal` as Step 4 of the handoff, and the TUI poller detects this file
- Adds session timeout (default 30 min) to prevent infinite TUI hangs
- Adds file stability check (two consecutive stable polls) before SIGTERMing
- Removes recursive handoff instruction bloat in NEXT_PROMPT.md
- Removes hardcoded project-specific completion markers from stop-check.sh
- Syncs all three editions (SDK, Plugin, Shell) with the new protocol

## Files Changed

- `cleave-sdk/src/session.ts` — Rewritten `isHandoffReady()`, added timeout + stability check
- `cleave-sdk/src/state/files.ts` — Added `handoffSignalFile` to RelayPaths
- `cleave-sdk/src/utils/prompt-builder.ts` — Updated handoff instructions, added dedup
- `cleave-sdk/src/hooks.ts` — Signal file check in headless Stop hook
- `cleave-sdk/src/config.ts` — Added `sessionTimeout`, version bump
- `cleave-sdk/src/cli.ts` — Added `--session-timeout` flag
- `cleave-sdk/scripts/stop-check.sh` — Signal file detection
- `cleave-sdk/scripts/session-start.sh` — Signal file cleanup
- `cleave-plugin-v4/scripts/stop-check.sh` — Synced with SDK
- `cleave-plugin-v4/scripts/session-start.sh` — Synced with SDK
- `cleave-plugin-v4/skills/session-relay/SKILL.md` — Updated Step 4
- `cleave` (bash edition) — Updated instructions + signal file

## Test plan

- [ ] Run `cleave run test-prompt.md` in TUI mode — verify sessions chain automatically
- [ ] Verify `.cleave/.handoff_signal` is created by Claude during handoff
- [ ] Verify `.handoff_signal` is cleaned at start of each new session
- [ ] Test session timeout by setting `--session-timeout 60` with a prompt that loops
- [ ] Run `cleave run test-prompt.md --no-tui` — verify headless mode still works
- [ ] Verify NEXT_PROMPT.md does NOT contain duplicated relay instructions
EOF
)"
```

---

## Summary of Changes

| What | Why | Where |
|------|-----|-------|
| `.handoff_signal` file | Explicit signal the poller can detect (stdout isn't captured) | files.ts, session.ts |
| Rewritten `isHandoffReady()` | Old version checked wrong file for a string Claude only printed | session.ts |
| Updated handoff instructions Step 4 | Tell Claude to write the signal file | prompt-builder.ts, SKILL.md, bash `cleave` |
| Session timeout | Prevent infinite TUI hangs if handoff never triggers | config.ts, cli.ts, session.ts |
| File stability check | Don't SIGTERM while Claude is mid-file-write | session.ts |
| Instruction dedup | Stop NEXT_PROMPT.md from containing exponentially growing instructions | prompt-builder.ts |
| Removed hardcoded markers | `IMAGE_AUDIT_COMPLETE` etc. are project-specific | stop-check.sh |
