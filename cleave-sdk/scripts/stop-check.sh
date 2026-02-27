#!/usr/bin/env bash
# Cleave SDK — Stop hook enforcement (shell version for TUI mode)
#
# Prevents Claude from exiting until handoff files are written.
# Input:  JSON on stdin with session/tool info
# Output: JSON on stdout if blocking
# Exit:   0 = allow exit, 2 = block exit
#
# v5.1: Supports both standard relay (.cleave/) and pipeline stages
#       (.cleave/stages/<name>/). Auto-detects which one is active.
#       Also validates that NEXT_PROMPT.md is not empty.

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

# If no .cleave directory at all, allow exit
if [ ! -d "$CLEAVE_DIR" ]; then
  exit 0
fi

# ── Determine the active handoff directory ──
# Pipeline stages use .cleave/stages/<name>/, standard relays use .cleave/
# Check for active pipeline stage first (most recently modified .session_start)
HANDOFF_DIR=""

if [ -d "$CLEAVE_DIR/stages" ]; then
  # Find the stage directory with the most recent .session_start marker
  LATEST_STAGE=""
  LATEST_TIME=0
  for STAGE_DIR in "$CLEAVE_DIR/stages"/*/; do
    if [ -f "${STAGE_DIR}.session_start" ]; then
      # Get modification time as epoch seconds (works on macOS and Linux)
      if stat -f %m "${STAGE_DIR}.session_start" >/dev/null 2>&1; then
        MTIME=$(stat -f %m "${STAGE_DIR}.session_start")
      else
        MTIME=$(stat -c %Y "${STAGE_DIR}.session_start" 2>/dev/null || echo 0)
      fi
      if [ "$MTIME" -gt "$LATEST_TIME" ] 2>/dev/null; then
        LATEST_TIME="$MTIME"
        LATEST_STAGE="$STAGE_DIR"
      fi
    fi
  done

  if [ -n "$LATEST_STAGE" ]; then
    HANDOFF_DIR="$LATEST_STAGE"
  fi
fi

# Fallback to standard relay directory
if [ -z "$HANDOFF_DIR" ]; then
  HANDOFF_DIR="$CLEAVE_DIR"
fi

# Remove trailing slash for consistency
HANDOFF_DIR="${HANDOFF_DIR%/}"

PROGRESS="$HANDOFF_DIR/PROGRESS.md"
KNOWLEDGE="$HANDOFF_DIR/KNOWLEDGE.md"
NEXT_PROMPT="$HANDOFF_DIR/NEXT_PROMPT.md"
SESSION_START="$HANDOFF_DIR/.session_start"
ACTIVE_RELAY="$CLEAVE_DIR/.active_relay"

# If no active relay marker, this isn't a cleave-managed session — allow exit
if [ ! -f "$ACTIVE_RELAY" ]; then
  # Also check for active pipeline marker
  if [ ! -f "$CLEAVE_DIR/.active_pipeline" ]; then
    exit 0
  fi
fi

# Check if task is fully complete (match STATUS lines only to avoid false positives)
if [ -f "$PROGRESS" ] && grep -qiE "STATUS[: *]+\s*(ALL_COMPLETE|TASK_FULLY_COMPLETE)" "$PROGRESS" 2>/dev/null; then
  exit 0
fi

# Check for handoff signal file (written by Claude as final handoff step)
HANDOFF_SIGNAL="$HANDOFF_DIR/.handoff_signal"
if [ -f "$HANDOFF_SIGNAL" ]; then
  # Verify it was written this session (not leftover from a previous one)
  if [ -f "$SESSION_START" ] && [ "$HANDOFF_SIGNAL" -nt "$SESSION_START" ]; then
    exit 0
  elif [ ! -f "$SESSION_START" ]; then
    exit 0
  fi
fi

# Check that all three handoff files exist, are newer than session start, and are non-empty
MISSING=""
STALE=""
EMPTY=""

for FNAME in "PROGRESS.md" "KNOWLEDGE.md" "NEXT_PROMPT.md"; do
  FPATH="$HANDOFF_DIR/$FNAME"
  if [ ! -f "$FPATH" ]; then
    MISSING="$MISSING $FNAME"
  elif [ -f "$SESSION_START" ] && [ "$SESSION_START" -nt "$FPATH" ]; then
    STALE="$STALE $FNAME"
  elif [ ! -s "$FPATH" ]; then
    # File exists but is empty (0 bytes)
    EMPTY="$EMPTY $FNAME"
  fi
done

# If all files present, fresh, and non-empty, allow exit
if [ -z "$MISSING" ] && [ -z "$STALE" ] && [ -z "$EMPTY" ]; then
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
if [ -n "$EMPTY" ]; then
  REASON="${REASON}Empty (must have content):${EMPTY}. "
fi

# Determine the correct path prefix for instructions
if [ "$HANDOFF_DIR" != "$CLEAVE_DIR" ]; then
  # Pipeline stage — extract stage name
  STAGE_NAME=$(basename "$HANDOFF_DIR")
  FILE_PREFIX=".cleave/stages/$STAGE_NAME"
else
  FILE_PREFIX=".cleave"
fi

REASON="${REASON}You MUST: 1) Update ${FILE_PREFIX}/PROGRESS.md with status and stop point. 2) Update ${FILE_PREFIX}/KNOWLEDGE.md with session notes. 3) Write ${FILE_PREFIX}/NEXT_PROMPT.md for next session (must not be empty). 4) Print RELAY_HANDOFF_COMPLETE. If ALL work is done, set STATUS: ALL_COMPLETE in PROGRESS.md."

# Output block decision and exit 2
echo "{\"decision\":\"block\",\"reason\":\"$REASON\"}"
exit 2
