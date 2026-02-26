#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# Cleave Session Start Hook — Timestamps session start for handoff verification
# ─────────────────────────────────────────────────────────────────────────────
#
# Creates a timestamp marker so the Stop hook can verify that handoff files
# were actually updated during this session (not leftover from a prior one).
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

INPUT=$(cat)
CWD=$(echo "$INPUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('cwd',''))" 2>/dev/null || echo "")

if [ -z "$CWD" ]; then
    exit 0
fi

RELAY_DIR="$CWD/.cleave"

# Only act if this is a cleave relay session
if [ -d "$RELAY_DIR" ] && [ -f "$RELAY_DIR/.active_relay" ]; then
    # Touch the session start marker
    touch "$RELAY_DIR/.session_start"

    # Increment session counter
    COUNTER_FILE="$RELAY_DIR/.session_count"
    if [ -f "$COUNTER_FILE" ]; then
        COUNT=$(cat "$COUNTER_FILE" 2>/dev/null || echo "0")
        echo $((COUNT + 1)) > "$COUNTER_FILE"
    fi
fi

exit 0
