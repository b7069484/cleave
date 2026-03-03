export function compactKnowledge(content: string, maxSessions: number): string {
  if (!content.trim()) {
    return '## Core Knowledge\n\n## Session Log\n';
  }

  const sessionLogIndex = content.indexOf('## Session Log');

  let coreSection: string;
  let sessionSection: string;

  if (sessionLogIndex === -1) {
    coreSection = content.trim();
    sessionSection = '';
  } else {
    coreSection = content.slice(0, sessionLogIndex).trim();
    sessionSection = content.slice(sessionLogIndex + '## Session Log'.length).trim();
  }

  // Split session entries by ### headers
  const sessionEntries: string[] = [];
  const lines = sessionSection.split('\n');
  let currentEntry = '';

  for (const line of lines) {
    if (line.startsWith('### Session ')) {
      if (currentEntry.trim()) {
        sessionEntries.push(currentEntry.trim());
      }
      currentEntry = line + '\n';
    } else {
      currentEntry += line + '\n';
    }
  }
  if (currentEntry.trim()) {
    sessionEntries.push(currentEntry.trim());
  }

  // Keep only last N sessions
  const kept = sessionEntries.slice(-maxSessions);

  return `${coreSection}\n\n## Session Log\n${kept.length ? kept.join('\n\n') + '\n' : ''}`;
}
