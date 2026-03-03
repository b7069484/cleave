import { describe, it, expect } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { StreamView } from '../StreamView.js';
import type { ParsedEvent } from '../../stream/types.js';

describe('StreamView', () => {
  it('renders text events', () => {
    const events: ParsedEvent[] = [
      { kind: 'text', text: 'Let me analyze the code.' },
    ];
    const { lastFrame } = render(<StreamView events={events} />);
    expect(lastFrame()).toContain('Let me analyze the code.');
  });

  it('renders tool_start events as cards', () => {
    const events: ParsedEvent[] = [
      { kind: 'tool_start', name: 'Read', id: 't1', input: { file_path: '/src/index.ts' } },
    ];
    const { lastFrame } = render(<StreamView events={events} />);
    expect(lastFrame()).toContain('Read');
    expect(lastFrame()).toContain('/src/index.ts');
  });

  it('renders agent tool_start events', () => {
    const events: ParsedEvent[] = [
      {
        kind: 'tool_start',
        name: 'Agent',
        id: 't2',
        input: { subagent_type: 'Explore', description: 'Find utils' }
      },
    ];
    const { lastFrame } = render(<StreamView events={events} />);
    expect(lastFrame()).toContain('Agent');
    expect(lastFrame()).toContain('Explore');
  });
});
