#!/usr/bin/env bash
# Cleave SDK — SessionStart hook
#
# Touches the .session_start marker file so the Stop hook can check
# whether handoff files were written THIS session (not a prior one).
#
# Input: JSON on stdin with session info
# Exit:  Always 0 (never block session start)

# Don't use set -e — we must always exit 0
INPUT=$(cat 2>/dev/null || true)

# Try to extract cwd from JSON input
CWD=""
if [ -n "$INPUT" ]; then
  CWD=$(echo "$INPUT" | python3 -c "
import json, sys
try:
    data = json.load(sys.stdin)
    # Handle both possible structures
    if isinstance(data, dict):
        print(data.get('cwd', data.get('workingDir', '')))
    else:
        print('')
except:
    print('')
" 2>/dev/null || true)
fi

# Fallback: try PWD or CLEAVE_WORK_DIR env var
if [ -z "$CWD" ]; then
  CWD="${CLEAVE_WORK_DIR:-${PWD:-}}"
fi

if [ -z "$CWD" ]; then
  exit 0
fi

CLEAVE_DIR="$CWD/.cleave"

if [ -d "$CLEAVE_DIR" ]; then
  touch "$CLEAVE_DIR/.session_start" 2>/dev/null || true
  # Clean handoff signal from previous session
  rm -f "$CLEAVE_DIR/.handoff_signal" 2>/dev/null || true

  # Increment session counter
  COUNTER_FILE="$CLEAVE_DIR/.session_counter"
  if [ -f "$COUNTER_FILE" ]; then
    COUNT=$(cat "$COUNTER_FILE" 2>/dev/null || echo "0")
    echo $((COUNT + 1)) > "$COUNTER_FILE" 2>/dev/null || true
  else
    echo "1" > "$COUNTER_FILE" 2>/dev/null || true
  fi
fi

exit 0
