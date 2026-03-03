import React from 'react';
import { Box, Text } from 'ink';

interface FooterProps {
  knowledgeSize: number;  // bytes
  tasksCompleted: number;
  tasksTotal: number;
  handoffStatus: 'waiting' | 'ready' | 'complete';
}

export function Footer({ knowledgeSize, tasksCompleted, tasksTotal, handoffStatus }: FooterProps) {
  const kbSize = (knowledgeSize / 1024).toFixed(1);

  const statusColor = {
    waiting: 'yellow',
    ready: 'green',
    complete: 'cyan',
  }[handoffStatus];

  return (
    <Box borderStyle="single" borderColor="gray" paddingX={1} justifyContent="space-between">
      <Text>Knowledge: <Text bold>{kbSize}KB</Text></Text>
      {tasksTotal > 0 && (
        <Text>Tasks: <Text bold>{tasksCompleted}/{tasksTotal}</Text></Text>
      )}
      <Text>Handoff: <Text bold color={statusColor}>{handoffStatus}</Text></Text>
    </Box>
  );
}
