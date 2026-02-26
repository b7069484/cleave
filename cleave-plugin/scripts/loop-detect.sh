#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# Loop Detection — Checks if consecutive handoff prompts are near-identical
# ─────────────────────────────────────────────────────────────────────────────
# Compares the current NEXT_PROMPT.md with the archived one from the previous
# session. Returns 0 if a loop is detected (>85% identical lines), 1 if not.
#
# Usage: loop-detect.sh <relay-dir> <session-num>
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

RELAY_DIR="${1:-.cleave}"
SESSION_NUM="${2:-1}"

if [ "$SESSION_NUM" -lt 3 ]; then
    exit 1  # Need at least 3 sessions to detect a loop
fi

PREV=$((SESSION_NUM - 1))
PREV_PROMPT="$RELAY_DIR/logs/session_${PREV}_next_prompt.md"
CURRENT_PROMPT="$RELAY_DIR/NEXT_PROMPT.md"

if [ ! -f "$PREV_PROMPT" ] || [ ! -f "$CURRENT_PROMPT" ]; then
    exit 1
fi

# Compare file sizes (quick check)
PREV_SIZE=$(wc -c < "$PREV_PROMPT" | tr -d ' ')
CURRENT_SIZE=$(wc -c < "$CURRENT_PROMPT" | tr -d ' ')

DIFF_THRESHOLD=$(( PREV_SIZE / 10 ))
SIZE_DIFF=$(( CURRENT_SIZE - PREV_SIZE ))
SIZE_DIFF=${SIZE_DIFF#-}  # absolute value

if [ "$SIZE_DIFF" -ge "$DIFF_THRESHOLD" ] 2>/dev/null; then
    exit 1  # Sizes differ significantly, not a loop
fi

# Deep comparison: line-by-line similarity
TOTAL_LINES=$(wc -l < "$CURRENT_PROMPT" | tr -d ' ')
if [ "$TOTAL_LINES" -eq 0 ]; then
    exit 1
fi

IDENTICAL_LINES=$(comm -12 <(sort "$PREV_PROMPT") <(sort "$CURRENT_PROMPT") | wc -l | tr -d ' ')
SIMILARITY=$(( (IDENTICAL_LINES * 100) / TOTAL_LINES ))

if [ "$SIMILARITY" -gt 85 ]; then
    echo "LOOP DETECTED: Session $SESSION_NUM handoff is ${SIMILARITY}% identical to session $PREV"
    exit 0  # Loop detected
fi

exit 1  # No loop
