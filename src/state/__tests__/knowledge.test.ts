import { describe, it, expect } from 'vitest';
import { compactKnowledge, parseKnowledgeMetrics } from '../knowledge.js';

describe('compactKnowledge', () => {
  it('preserves Core Knowledge section', () => {
    const input = `## Core Knowledge\n1. Important fact\n2. Another fact\n\n## Session Log\n### Session 1\n- Did thing`;
    const result = compactKnowledge(input, 5);
    expect(result).toContain('## Core Knowledge');
    expect(result).toContain('1. Important fact');
  });

  it('prunes Session Log to last N sessions', () => {
    const sessions = Array.from({ length: 8 }, (_, i) =>
      `### Session ${i + 1}\n- Completed task ${i + 1}`
    ).join('\n\n');
    const input = `## Core Knowledge\n1. Fact\n\n## Session Log\n${sessions}`;
    const result = compactKnowledge(input, 3);
    expect(result).not.toContain('Session 1');
    expect(result).not.toContain('Session 5');
    expect(result).toContain('Session 6');
    expect(result).toContain('Session 7');
    expect(result).toContain('Session 8');
  });

  it('handles empty knowledge', () => {
    const result = compactKnowledge('', 5);
    expect(result).toBe('## Core Knowledge\n\n## Session Log\n');
  });

  it('compaction preserves insight count (never decreases)', () => {
    const input = `## Core Knowledge\n1. Fact A\n2. Fact B\n3. Fact C\n\n## Session Log\n### Session 1\n- Work\n### Session 2\n- More work\n### Session 3\n- Even more`;
    const before = parseKnowledgeMetrics(input);
    const compacted = compactKnowledge(input, 2);
    const after = parseKnowledgeMetrics(compacted);
    expect(after.insightCount).toBeGreaterThanOrEqual(before.insightCount);
  });

  it('handles knowledge with no Session Log', () => {
    const input = '## Core Knowledge\n1. Fact';
    const result = compactKnowledge(input, 5);
    expect(result).toContain('## Core Knowledge');
    expect(result).toContain('1. Fact');
    expect(result).toContain('## Session Log');
  });
});

describe('parseKnowledgeMetrics', () => {
  it('counts numbered items under Core Knowledge as insights (basic)', () => {
    const input = `## Core Knowledge\n1. Fact one\n2. Fact two\n3. Fact three\n\n## Session Log\n### Session 1\n- Did stuff`;
    const result = parseKnowledgeMetrics(input);
    expect(result.insightCount).toBe(3);
  });

  it('measures core and session byte sizes separately', () => {
    const core = '## Core Knowledge\n1. Fact one\n2. Fact two\n';
    const session = '## Session Log\n### Session 1\n- Did stuff\n';
    const input = core + '\n' + session;
    const result = parseKnowledgeMetrics(input);
    expect(result.coreSizeBytes).toBeGreaterThan(0);
    expect(result.sessionSizeBytes).toBeGreaterThan(0);
    expect(result.coreSizeBytes).toBeLessThan(Buffer.byteLength(input));
  });

  it('returns zeros for empty content', () => {
    const result = parseKnowledgeMetrics('');
    expect(result.insightCount).toBe(0);
    expect(result.coreSizeBytes).toBe(0);
    expect(result.sessionSizeBytes).toBe(0);
  });

  it('handles content with no Session Log section', () => {
    const input = '## Core Knowledge\n1. Fact one\n2. Fact two';
    const result = parseKnowledgeMetrics(input);
    expect(result.insightCount).toBe(2);
    expect(result.sessionSizeBytes).toBe(0);
  });

  it('counts numbered items under Core Knowledge as insights', () => {
    const input = `## Core Knowledge\n1. Architecture uses MVC pattern\n2. Main entry is src/index.ts\n3. Tests use vitest\n\n## Session Log\n### Session 1\n- Did stuff`;
    const result = parseKnowledgeMetrics(input);
    expect(result.insightCount).toBe(3);
  });

  it('does not count bullet points as insights (only numbered items)', () => {
    const input = `## Core Knowledge\n- This is a bullet\n- Another bullet\n1. This is an insight\n\n## Session Log\n`;
    const result = parseKnowledgeMetrics(input);
    expect(result.insightCount).toBe(1);
  });

  it('does not count numbered items after Session Log as insights', () => {
    const input = `## Core Knowledge\n1. Insight one\n2. Insight two\n\n## Session Log\n### Session 1\n1. Did task one\n2. Did task two`;
    const result = parseKnowledgeMetrics(input);
    expect(result.insightCount).toBe(2);
  });

  it('handles sub-headers in Core Knowledge without miscounting', () => {
    const input = `## Core Knowledge\n### Architecture\n1. Uses MVC\n### Patterns\n1. Uses dependency injection\n2. Factory pattern\n\n## Session Log\n`;
    const result = parseKnowledgeMetrics(input);
    expect(result.insightCount).toBe(3);
  });
});
