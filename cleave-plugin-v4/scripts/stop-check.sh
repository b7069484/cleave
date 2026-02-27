#!/usr/bin/env bash
# Cleave SDK — Stop hook enforcement (shell version for TUI mode)
#
# This script runs as a Claude Code Stop hook via --settings.
# It prevents Claude from exiting until handoff files are written.
#
# Input:  JSON on stdin with session/tool info
# Output: JSON on stdout if blocking
# Exit:   0 = allow exit, 2 = block exit

INPUT=$(cat 2>/dev/null || true)

# Try to extract cwd from JSON input
CWD=""
if [ -n "$INPUT" ]; then
  CWD=$(echo "$INPUT" | python3 -c "
import json, sys
try:
    data = json.load(sys.stdin)
    if isinstance(data, dict):
        print(data.get('cwd', data.get('workingDir', '')))
    else:
        print('')
except:
    print('')
" 2>/dev/null || true)
fi

# Fallback: try env vars
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

# Check if task is fully complete (match STATUS lines only to avoid false positives)
if [ -f "$PROGRESS" ] && grep -qiE "STATUS[: *]+\s*(ALL_COMPLETE|TASK_FULLY_COMPLETE)" "$PROGRESS" 2>/dev/null; then
  exit 0
fi

# Check for handoff signal file (written by Claude as final handoff step)
HANDOFF_SIGNAL="$CLEAVE_DIR/.handoff_signal"
if [ -f "$HANDOFF_SIGNAL" ]; then
  if [ -f "$SESSION_START" ] && [ "$HANDOFF_SIGNAL" -nt "$SESSION_START" ]; then
    exit 0
  elif [ ! -f "$SESSION_START" ]; then
    exit 0
  fi
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
