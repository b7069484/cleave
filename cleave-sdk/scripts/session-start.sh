#!/usr/bin/env bash
# Cleave SDK — SessionStart hook
#
# Touches the .session_start marker so the Stop hook knows which files
# were written THIS session vs a prior one.
#
# v5.1: Also touches .session_start in active pipeline stage directories.
# Input: JSON on stdin with session info
# Exit:  Always 0 (never block session start)

INPUT=$(cat 2>/dev/null || true)

# Parse CWD from JSON using pure bash
CWD=""
if [ -n "$INPUT" ]; then
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
  exit 0
fi

CLEAVE_DIR="$CWD/.cleave"

if [ -d "$CLEAVE_DIR" ]; then
  # Touch the root-level marker (for standard relays)
  touch "$CLEAVE_DIR/.session_start" 2>/dev/null || true

  # Also touch .session_start in any active pipeline stage directories
  # The pipeline loop creates these dirs before spawning sessions
  if [ -d "$CLEAVE_DIR/stages" ]; then
    for STAGE_DIR in "$CLEAVE_DIR/stages"/*/; do
      if [ -d "$STAGE_DIR" ] && [ -f "${STAGE_DIR}.active_relay" ]; then
        touch "${STAGE_DIR}.session_start" 2>/dev/null || true
      fi
    done
  fi
fi

exit 0
