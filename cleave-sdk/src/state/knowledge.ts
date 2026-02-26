/**
 * Knowledge accumulation and compaction.
 *
 * KNOWLEDGE.md has two sections:
 *   ## Core Knowledge — permanent, never pruned
 *   ## Session Log — auto-pruned to last N entries
 */

import * as fs from 'fs';

/**
 * Compact the knowledge file by pruning old Session Log entries.
 * Keeps the Core Knowledge section intact and only the last N session entries.
 */
export function compactKnowledge(knowledgePath: string, keepSessions: number): { pruned: boolean; oldLines: number; newLines: number } {
  if (!fs.existsSync(knowledgePath)) {
    return { pruned: false, oldLines: 0, newLines: 0 };
  }

  const content = fs.readFileSync(knowledgePath, 'utf8');
  const lines = content.split('\n');

  // Count session entries
  const sessionEntries = lines.filter(l => l.startsWith('### Session'));
  const entryCount = sessionEntries.length;

  if (entryCount <= keepSessions) {
    return { pruned: false, oldLines: lines.length, newLines: lines.length };
  }

  // Find the Session Log header
  const logHeaderIndex = lines.findIndex(l => l.startsWith('## Session Log'));
  if (logHeaderIndex === -1) {
    return { pruned: false, oldLines: lines.length, newLines: lines.length };
  }

  // Keep everything up to and including the Session Log header + blank line
  const headerSection = lines.slice(0, logHeaderIndex + 2); // +2 for header + blank line

  // Extract session entries from after the header
  const logSection = lines.slice(logHeaderIndex + 2);

  // Find entry boundaries (each starts with "### Session")
  const entryStarts: number[] = [];
  logSection.forEach((line, i) => {
    if (line.startsWith('### Session')) {
      entryStarts.push(i);
    }
  });

  // Keep only the last N entries
  const entriesToKeep = entryStarts.slice(-keepSessions);
  if (entriesToKeep.length === 0) {
    return { pruned: false, oldLines: lines.length, newLines: lines.length };
  }

  const keptSection = logSection.slice(entriesToKeep[0]);
  const newContent = [...headerSection, ...keptSection].join('\n');

  const oldLines = lines.length;
  const newLines = newContent.split('\n').length;

  fs.writeFileSync(knowledgePath, newContent);

  return { pruned: true, oldLines, newLines };
}
