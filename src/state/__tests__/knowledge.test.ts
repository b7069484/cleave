import { describe, it, expect } from 'vitest';
import { compactKnowledge, parseKnowledgeMetrics } from '../knowledge.js';

describe('compactKnowledge', () => {
  it('preserves Core Knowledge section', () => {
    const input = `## Core Knowledge\n- Important fact\n- Another fact\n\n## Session Log\n### Session 1\n- Did thing`;
    const result = compactKnowledge(input, 5);
    expect(result).toContain('## Core Knowledge');
    expect(result).toContain('- Important fact');
  });

  it('prunes Session Log to last N sessions', () => {
    const sessions = Array.from({ length: 8 }, (_, i) =>
      `### Session ${i + 1}\n- Completed task ${i + 1}`
    ).join('\n\n');
    const input = `## Core Knowledge\n- Fact\n\n## Session Log\n${sessions}`;
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

  it('handles knowledge with no Session Log', () => {
    const input = '## Core Knowledge\n- Fact';
    const result = compactKnowledge(input, 5);
    expect(result).toContain('## Core Knowledge');
    expect(result).toContain('- Fact');
    expect(result).toContain('## Session Log');
  });
});

describe('parseKnowledgeMetrics', () => {
  it('counts bullet points under Core Knowledge as insights', () => {
    const input = `## Core Knowledge\n- Fact one\n- Fact two\n- Fact three\n\n## Session Log\n### Session 1\n- Did stuff`;
    const result = parseKnowledgeMetrics(input);
    expect(result.insightCount).toBe(3);
  });

  it('measures core and session byte sizes separately', () => {
    const core = '## Core Knowledge\n- Fact one\n- Fact two\n';
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
    const input = '## Core Knowledge\n- Fact one\n- Fact two';
    const result = parseKnowledgeMetrics(input);
    expect(result.insightCount).toBe(2);
    expect(result.sessionSizeBytes).toBe(0);
  });
});
