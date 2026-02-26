#!/usr/bin/env bash
# Cleave SDK — Stop hook enforcement (shell version for TUI mode)
#
# Prevents Claude from exiting until handoff files are written.
# Input:  JSON on stdin with session/tool info
# Output: JSON on stdout if blocking
# Exit:   0 = allow exit, 2 = block exit
#
# v5: Pure bash JSON parsing — no Python dependency.

INPUT=$(cat 2>/dev/null || true)

# Parse CWD from JSON using pure bash (extract "cwd" or "workingDir" value)
CWD=""
if [ -n "$INPUT" ]; then
  # Match "cwd":"<value>" or "cwd": "<value>" — handles JSON with/without spaces
  CWD=$(echo "$INPUT" | grep -oE '"cwd"\s*:\s*"[^"]*"' | head -1 | sed 's/.*"cwd"\s*:\s*"//;s/"$//')
  if [ -z "$CWD" ]; then
    CWD=$(echo "$INPUT" | grep -oE '"workingDir"\s*:\s*"[^"]*"' | head -1 | sed 's/.*"workingDir"\s*:\s*"//;s/"$//')
  fi
fi

# Fallback: env vars
if [ -z "$CWD" ]; then
  CWD="${CLEAVE_WORK_DIR:-${PWD:-}}"
fi

if [ -z "$CWD" ]; then
  # Can't determine cwd — allow exit to avoid deadlock
  exit 0
fi

CLEAVE_DIR="$CWD/.cleave"
PROGRESS="$CLEAVE_DIR/PROGRESS.md"
KNOWLEDGE="$CLEAVE_DIR/KNOWLEDGE.md"
NEXT_PROMPT="$CLEAVE_DIR/NEXT_PROMPT.md"
SESSION_START="$CLEAVE_DIR/.session_start"
ACTIVE_RELAY="$CLEAVE_DIR/.active_relay"

# If no active relay marker, this isn't a cleave-managed session — allow exit
if [ ! -f "$ACTIVE_RELAY" ]; then
  exit 0
fi

# Check if task is fully complete
if [ -f "$PROGRESS" ] && grep -qi "ALL_COMPLETE\|TASK_FULLY_COMPLETE" "$PROGRESS" 2>/dev/null; then
  exit 0
fi

# Check that all three handoff files exist and are newer than session start
MISSING=""
STALE=""

for FNAME in "PROGRESS.md" "KNOWLEDGE.md" "NEXT_PROMPT.md"; do
  FPATH="$CLEAVE_DIR/$FNAME"
  if [ ! -f "$FPATH" ]; then
    MISSING="$MISSING $FNAME"
  elif [ -f "$SESSION_START" ] && [ "$SESSION_START" -nt "$FPATH" ]; then
    STALE="$STALE $FNAME"
  fi
done

# If all files present and fresh, allow exit
if [ -z "$MISSING" ] && [ -z "$STALE" ]; then
  exit 0
fi

# Build block reason
REASON="CLEAVE HANDOFF INCOMPLETE. "

if [ -n "$MISSING" ]; then
  REASON="${REASON}Missing:${MISSING}. "
fi
if [ -n "$STALE" ]; then
  REASON="${REASON}Not updated this session:${STALE}. "
fi

REASON="${REASON}You MUST: 1) Update .cleave/PROGRESS.md with status and stop point. 2) Update .cleave/KNOWLEDGE.md with session notes. 3) Write .cleave/NEXT_PROMPT.md for next session. 4) Print RELAY_HANDOFF_COMPLETE. If ALL work is done, set STATUS: ALL_COMPLETE in PROGRESS.md."

# Output block decision and exit 2
echo "{\"decision\":\"block\",\"reason\":\"$REASON\"}"
exit 2
