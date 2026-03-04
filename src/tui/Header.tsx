import React from 'react';
import { Box, Text } from 'ink';
import { basename } from 'node:path';

interface HeaderProps {
  sessionNum: number;
  maxSessions: number;
  projectDir: string;
  elapsedMs: number;
  sessionCostUsd: number;
  totalCostUsd: number;
  budgetUsd: number;
  contextPercent: number;
}

function formatDuration(ms: number): string {
  const totalSecs = Math.floor(ms / 1000);
  const mins = Math.floor(totalSecs / 60);
  const secs = totalSecs % 60;
  return `${mins}m ${secs.toString().padStart(2, '0')}s`;
}

function contextBar(percent: number, width: number = 20): string {
  const filled = Math.round((percent / 100) * width);
  const empty = width - filled;
  return '\u2588'.repeat(filled) + '\u2591'.repeat(empty);
}

export function Header({
  sessionNum,
  maxSessions,
  projectDir,
  elapsedMs,
  sessionCostUsd,
  totalCostUsd,
  budgetUsd,
  contextPercent,
}: HeaderProps) {
  const dir = basename(projectDir);
  const barColor = contextPercent > 80 ? 'red' : contextPercent > 60 ? 'yellow' : 'green';

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="cyan" paddingX={1}>
      <Box justifyContent="space-between">
        <Text bold color="cyan">CLEAVE</Text>
        <Text>Session <Text bold>{sessionNum}/{maxSessions}</Text></Text>
        <Text dimColor>~/{dir}</Text>
        <Text dimColor>{formatDuration(elapsedMs)}</Text>
      </Box>
      <Box justifyContent="space-between">
        <Text>
          Context: <Text color={barColor}>{contextBar(contextPercent)}</Text>{' '}
          <Text bold>{contextPercent}%</Text>
        </Text>
        <Text>
          Session: <Text bold color={sessionCostUsd > budgetUsd * 0.8 ? 'yellow' : 'green'}>
            ${sessionCostUsd.toFixed(2)}
          </Text>/${budgetUsd.toFixed(2)}
          {' '}Total: <Text bold>${totalCostUsd.toFixed(2)}</Text>
        </Text>
      </Box>
    </Box>
  );
}
