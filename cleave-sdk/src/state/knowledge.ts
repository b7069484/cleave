/**
 * Knowledge accumulation and compaction.
 *
 * KNOWLEDGE.md has two sections:
 *   ## Core Knowledge — permanent, never pruned
 *   ## Session Log — auto-pruned to last N entries
 *
 * Robust: handles missing headers, different heading formats, and
 * creates a backup before pruning.
 */

import * as fs from 'fs';

export function compactKnowledge(
  knowledgePath: string,
  keepSessions: number
): { pruned: boolean; oldLines: number; newLines: number } {
  if (!fs.existsSync(knowledgePath)) {
    return { pruned: false, oldLines: 0, newLines: 0 };
  }

  const content = fs.readFileSync(knowledgePath, 'utf8');
  const lines = content.split('\n');
  const oldLines = lines.length;

  // Find session entries — match both "### Session N" and "### Session #N"
  const sessionPattern = /^###\s+Session\s/i;
  const entryIndices: number[] = [];
  lines.forEach((line, i) => {
    if (sessionPattern.test(line)) entryIndices.push(i);
  });

  if (entryIndices.length <= keepSessions) {
    return { pruned: false, oldLines, newLines: oldLines };
  }

  // Find the Session Log header (flexible matching)
  const logHeaderIndex = lines.findIndex(l => /^##\s+Session\s+Log/i.test(l));
  if (logHeaderIndex === -1) {
    // No Session Log header found — don't prune, log warning
    return { pruned: false, oldLines, newLines: oldLines };
  }

  // Backup before pruning
  try {
    fs.writeFileSync(knowledgePath + '.bak', content);
  } catch { /* best effort */ }

  // Keep everything before Session Log section
  const headerSection = lines.slice(0, logHeaderIndex + 2); // header + description line

  // Find entries WITHIN the session log section only
  const logEntryIndices = entryIndices.filter(i => i > logHeaderIndex);
  if (logEntryIndices.length <= keepSessions) {
    return { pruned: false, oldLines, newLines: oldLines };
  }

  // Keep last N entries
  const keepFrom = logEntryIndices[logEntryIndices.length - keepSessions];
  const keptSection = lines.slice(keepFrom);
  const newContent = [...headerSection, ...keptSection].join('\n');
  const newLines = newContent.split('\n').length;

  // Validate: ensure Core Knowledge section survived
  if (!newContent.includes('## Core Knowledge')) {
    // Something went wrong — abort, restore from backup
    return { pruned: false, oldLines, newLines: oldLines };
  }

  fs.writeFileSync(knowledgePath, newContent);
  return { pruned: true, oldLines, newLines };
}
