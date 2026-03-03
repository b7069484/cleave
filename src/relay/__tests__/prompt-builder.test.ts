import { describe, it, expect } from 'vitest';
import { buildSessionPrompt, buildHandoffInstructions } from '../prompt-builder.js';

describe('buildHandoffInstructions', () => {
  it('includes handoff file paths', () => {
    const instructions = buildHandoffInstructions('/project');
    expect(instructions).toContain('PROGRESS.md');
    expect(instructions).toContain('KNOWLEDGE.md');
    expect(instructions).toContain('NEXT_PROMPT.md');
    expect(instructions).toContain('.handoff_signal');
  });

  it('includes HANDOFF_COMPLETE signal', () => {
    const instructions = buildHandoffInstructions('/project');
    expect(instructions).toContain('HANDOFF_COMPLETE');
    expect(instructions).toContain('TASK_FULLY_COMPLETE');
  });
});

describe('buildSessionPrompt', () => {
  it('uses initial task for session 1', () => {
    const prompt = buildSessionPrompt({
      sessionNum: 1,
      maxSessions: 10,
      initialTask: 'Fix the bugs',
      nextPrompt: '',
      knowledge: '',
      progress: '',
    });
    expect(prompt).toContain('Fix the bugs');
  });

  it('uses NEXT_PROMPT.md for subsequent sessions', () => {
    const prompt = buildSessionPrompt({
      sessionNum: 3,
      maxSessions: 10,
      initialTask: 'Fix the bugs',
      nextPrompt: 'Continue from where session 2 left off',
      knowledge: '## Core Knowledge\n- Found the root cause',
      progress: '## STATUS: IN_PROGRESS\nFixed 2 of 5 bugs',
    });
    expect(prompt).toContain('Continue from where session 2 left off');
    expect(prompt).toContain('Session 3 of 10');
    expect(prompt).toContain('Found the root cause');
  });

  it('includes knowledge context when available', () => {
    const prompt = buildSessionPrompt({
      sessionNum: 2,
      maxSessions: 5,
      initialTask: '',
      nextPrompt: 'Next task',
      knowledge: '## Core Knowledge\n- Key insight',
      progress: '',
    });
    expect(prompt).toContain('Key insight');
  });
});
