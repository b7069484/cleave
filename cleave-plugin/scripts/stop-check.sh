#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# Cleave Stop Hook — Enforces handoff file writing before session exit
# ─────────────────────────────────────────────────────────────────────────────
#
# This hook fires when Claude tries to finish responding. It checks whether
# the session is a cleave relay session and whether the required handoff
# files have been written. If not, it blocks the exit (exit code 2) and
# tells Claude to complete the handoff procedure.
#
# Exit codes:
#   0 — Allow exit (not a relay session, or handoff complete, or task done)
#   2 — Block exit (handoff files missing, Claude must write them)
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

# Read hook input from stdin
INPUT=$(cat)

# Extract working directory from hook input
CWD=$(echo "$INPUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('cwd',''))" 2>/dev/null || echo "")

if [ -z "$CWD" ]; then
    # Can't determine working directory — allow exit
    exit 0
fi

RELAY_DIR="$CWD/.cleave"

# ── Not a cleave session? Allow exit. ──
if [ ! -d "$RELAY_DIR" ]; then
    exit 0
fi

# Check for the relay marker file (created by the launcher or /resume command)
if [ ! -f "$RELAY_DIR/.active_relay" ]; then
    exit 0
fi

PROGRESS_FILE="$RELAY_DIR/PROGRESS.md"
NEXT_PROMPT_FILE="$RELAY_DIR/NEXT_PROMPT.md"
KNOWLEDGE_FILE="$RELAY_DIR/KNOWLEDGE.md"

# ── Task fully complete? Allow exit. ──
if [ -f "$PROGRESS_FILE" ]; then
    if head -10 "$PROGRESS_FILE" | grep -qi "ALL_COMPLETE"; then
        # Task is done — clean up the active marker and allow exit
        rm -f "$RELAY_DIR/.active_relay"
        exit 0
    fi
fi

# ── Check if handoff files were updated this session ──
# We check modification times against the session start marker
SESSION_START_MARKER="$RELAY_DIR/.session_start"

if [ ! -f "$SESSION_START_MARKER" ]; then
    # No session start marker — can't verify, allow exit
    exit 0
fi

MISSING_FILES=""
STALE_FILES=""

# Check each required file exists and was modified after session start
for filepath in "$PROGRESS_FILE" "$NEXT_PROMPT_FILE" "$KNOWLEDGE_FILE"; do
    filename=$(basename "$filepath")
    if [ ! -f "$filepath" ]; then
        MISSING_FILES="$MISSING_FILES $filename"
    elif [ "$filepath" -ot "$SESSION_START_MARKER" ]; then
        STALE_FILES="$STALE_FILES $filename"
    fi
done

# ── All files present and fresh? Allow exit. ──
if [ -z "$MISSING_FILES" ] && [ -z "$STALE_FILES" ]; then
    exit 0
fi

# ── Handoff incomplete — block exit ──
ERROR_MSG="CLEAVE HANDOFF INCOMPLETE — You cannot exit yet.\n\n"

if [ -n "$MISSING_FILES" ]; then
    ERROR_MSG="${ERROR_MSG}Missing files:${MISSING_FILES}\n"
fi

if [ -n "$STALE_FILES" ]; then
    ERROR_MSG="${ERROR_MSG}Not updated this session:${STALE_FILES}\n"
fi

ERROR_MSG="${ERROR_MSG}\nYou MUST complete the handoff procedure before exiting:\n"
ERROR_MSG="${ERROR_MSG}1. Update .cleave/PROGRESS.md with current status and exact stop point\n"
ERROR_MSG="${ERROR_MSG}2. Update .cleave/KNOWLEDGE.md — promote insights to Core, append session notes\n"
ERROR_MSG="${ERROR_MSG}3. Write .cleave/NEXT_PROMPT.md — complete prompt for next session\n"
ERROR_MSG="${ERROR_MSG}4. Print RELAY_HANDOFF_COMPLETE or TASK_FULLY_COMPLETE\n"
ERROR_MSG="${ERROR_MSG}\nIf the task is fully done, set STATUS: ALL_COMPLETE in PROGRESS.md."

echo -e "$ERROR_MSG" >&2
exit 2
