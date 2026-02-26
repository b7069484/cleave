#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# Knowledge Compaction — Prune Session Log to last N entries
# ─────────────────────────────────────────────────────────────────────────────
# Prevents KNOWLEDGE.md from growing unbounded. Keeps Core Knowledge intact,
# prunes Session Log to the last N entries.
#
# Usage: compact-knowledge.sh <knowledge-file> [keep-count]
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

KNOWLEDGE_FILE="${1:-.cleave/KNOWLEDGE.md}"
KEEP_SESSIONS="${2:-5}"

[ ! -f "$KNOWLEDGE_FILE" ] && exit 0

# Count session entries
ENTRY_COUNT=$(grep -c '^### Session' "$KNOWLEDGE_FILE" 2>/dev/null || echo 0)

if [ "$ENTRY_COUNT" -le "$KEEP_SESSIONS" ]; then
    exit 0  # Nothing to prune
fi

# Find the Session Log header line
LOG_HEADER_LINE=$(grep -n '^## Session Log' "$KNOWLEDGE_FILE" | head -1 | cut -d: -f1)

if [ -z "$LOG_HEADER_LINE" ]; then
    exit 0  # No structured sections, skip
fi

PRUNED=$(mktemp)
trap "rm -f $PRUNED" EXIT

# Keep header (everything up to and including Session Log header + 1 blank line)
head -n "$((LOG_HEADER_LINE + 1))" "$KNOWLEDGE_FILE" > "$PRUNED"

# Keep last N session entries
ENTRIES_TO_SKIP=$((ENTRY_COUNT - KEEP_SESSIONS))
awk -v skip="$ENTRIES_TO_SKIP" -v header_end="$LOG_HEADER_LINE" '
    NR <= header_end + 1 { next }
    /^### Session/ { entry_num++ }
    entry_num > skip { print }
' "$KNOWLEDGE_FILE" >> "$PRUNED"

OLD_LINES=$(wc -l < "$KNOWLEDGE_FILE" | tr -d ' ')
NEW_LINES=$(wc -l < "$PRUNED" | tr -d ' ')

mv "$PRUNED" "$KNOWLEDGE_FILE"
echo "Knowledge compacted: ${OLD_LINES} → ${NEW_LINES} lines (kept last ${KEEP_SESSIONS} session entries)"
