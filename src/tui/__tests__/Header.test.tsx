import { describe, it, expect } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { Header } from '../Header.js';

describe('Header', () => {
  it('displays session info and costs', () => {
    const { lastFrame } = render(
      <Header
        sessionNum={3}
        maxSessions={20}
        projectDir="/Users/test/myproject"
        elapsedMs={252000}
        sessionCostUsd={2.30}
        totalCostUsd={7.50}
        budgetUsd={5.00}
        contextPercent={62}
      />
    );
    const output = lastFrame()!;
    expect(output).toContain('Session 3/20');
    expect(output).toContain('myproject');
    expect(output).toContain('$2.30');
    expect(output).toContain('$7.50');
    expect(output).toContain('62%');
  });
});
