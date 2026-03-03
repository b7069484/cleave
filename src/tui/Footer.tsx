import React from 'react';
import { Box, Text } from 'ink';
import type { RunningAgent } from './useRelay.js';

interface FooterProps {
  knowledgeSize: number;  // bytes
  handoffsCompleted: number;
  maxHandoffs: number;    // maxSessions - 1
  runningAgents: RunningAgent[];
}

export function Footer({ knowledgeSize, handoffsCompleted, maxHandoffs, runningAgents }: FooterProps) {
  const kbSize = (knowledgeSize / 1024).toFixed(1);

  return (
    <Box flexDirection="column">
      {runningAgents.length > 0 && (
        <Box borderStyle="round" borderColor="cyan" paddingX={1} flexDirection="column">
          <Text bold color="cyan">Agents ({runningAgents.length} running)</Text>
          {runningAgents.map(agent => {
            const elapsed = Math.round((Date.now() - agent.startedAt) / 1000);
            return (
              <Box key={agent.id}>
                <Text color="cyan">  {'\u25B6'} </Text>
                <Text>{agent.description}</Text>
                <Text dimColor> ({agent.type}) {elapsed}s</Text>
              </Box>
            );
          })}
        </Box>
      )}
      <Box borderStyle="single" borderColor="gray" paddingX={1} justifyContent="space-between">
        <Text>Knowledge: <Text bold>{kbSize} KB</Text></Text>
        <Text>Handoffs: <Text bold color={handoffsCompleted > 0 ? 'green' : 'gray'}>{handoffsCompleted}/{maxHandoffs}</Text></Text>
      </Box>
    </Box>
  );
}
