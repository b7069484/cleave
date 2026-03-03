import { describe, it, expect } from 'vitest';
import { collectToolStats, buildDebriefPrompt, type DebriefContext } from '../debrief.js';
import type { ParsedToolStart } from '../../stream/types.js';

describe('collectToolStats', () => {
  it('counts tool usage frequency', () => {
    const events: ParsedToolStart[] = [
      { kind: 'tool_start', name: 'Read', id: '1', input: {} },
      { kind: 'tool_start', name: 'Edit', id: '2', input: {} },
      { kind: 'tool_start', name: 'Read', id: '3', input: {} },
      { kind: 'tool_start', name: 'Bash', id: '4', input: {} },
      { kind: 'tool_start', name: 'Read', id: '5', input: {} },
    ];
    const result = collectToolStats(events);
    expect(result.tools).toEqual({ Read: 3, Edit: 1, Bash: 1 });
  });

  it('extracts skill names from Skill tool calls', () => {
    const events: ParsedToolStart[] = [
      { kind: 'tool_start', name: 'Skill', id: '1', input: { skill: 'superpowers:brainstorming' } },
      { kind: 'tool_start', name: 'Skill', id: '2', input: { skill: 'superpowers:tdd' } },
      { kind: 'tool_start', name: 'Read', id: '3', input: {} },
    ];
    const result = collectToolStats(events);
    expect(result.skills).toEqual(['superpowers:brainstorming', 'superpowers:tdd']);
    expect(result.tools.Skill).toBe(2);
    expect(result.tools.Read).toBe(1);
  });

  it('returns empty skills for events with no Skill calls', () => {
    const events: ParsedToolStart[] = [
      { kind: 'tool_start', name: 'Read', id: '1', input: {} },
    ];
    const result = collectToolStats(events);
    expect(result.skills).toEqual([]);
  });

  it('deduplicates skill names', () => {
    const events: ParsedToolStart[] = [
      { kind: 'tool_start', name: 'Skill', id: '1', input: { skill: 'tdd' } },
      { kind: 'tool_start', name: 'Skill', id: '2', input: { skill: 'tdd' } },
    ];
    const result = collectToolStats(events);
    expect(result.skills).toEqual(['tdd']);
  });
});

describe('buildDebriefPrompt', () => {
  it('produces a prompt containing all context sections', () => {
    const ctx: DebriefContext = {
      sessionsRun: 5,
      totalCostUsd: 12.50,
      totalDurationMs: 180000,
      toolStats: { Read: 30, Edit: 15, Bash: 8 },
      skills: ['superpowers:tdd'],
      filesChanged: ['src/app.ts', 'src/utils.ts'],
      errors: [{ sessionNum: 3, message: 'Rate limited' }],
      finalProgress: '## STATUS: ALL_COMPLETE\nAll tasks done.',
      finalKnowledge: '## Core Knowledge\n- Key insight\n\n## Session Log\n',
      projectDir: '/tmp/test',
    };
    const prompt = buildDebriefPrompt(ctx);
    expect(prompt).toContain('5 sessions');
    expect(prompt).toContain('$12.50');
    expect(prompt).toContain('Read: 30');
    expect(prompt).toContain('src/app.ts');
    expect(prompt).toContain('DEBRIEF.md');
    expect(prompt).toContain('Session 3: Rate limited');
    expect(prompt).toContain('superpowers:tdd');
  });

  it('handles empty data gracefully', () => {
    const ctx: DebriefContext = {
      sessionsRun: 1,
      totalCostUsd: 0,
      totalDurationMs: 0,
      toolStats: {},
      skills: [],
      filesChanged: [],
      errors: [],
      finalProgress: '',
      finalKnowledge: '',
      projectDir: '/tmp/test',
    };
    const prompt = buildDebriefPrompt(ctx);
    expect(prompt).toContain('1 session');
    expect(prompt).toContain('(none)');
    expect(prompt).toContain('(none detected)');
  });
});
