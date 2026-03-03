import React from 'react';
import { Box, Text } from 'ink';
import type { RunningAgent } from './useRelay.js';

interface FooterProps {
  knowledge: { insights: number; coreBytes: number; sessionBytes: number };
  handoffsCompleted: number;
  maxHandoffs: number;
  runningAgents: RunningAgent[];
  sessionNum: number;
  maxSessions: number;
  sessionBudget: number;
}

export function Footer({ knowledge, handoffsCompleted, maxHandoffs, runningAgents, sessionNum, maxSessions, sessionBudget }: FooterProps) {

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
      <Box borderStyle="single" borderColor="gray" paddingX={1} flexDirection="column">
        <Box justifyContent="space-between">
          <Text>
            Knowledge: <Text bold>{knowledge.insights} insights</Text>
            <Text dimColor> · {(knowledge.coreBytes / 1024).toFixed(1)} KB core / {(knowledge.sessionBytes / 1024).toFixed(1)} KB session</Text>
          </Text>
          <Text>Handoffs: <Text bold color={handoffsCompleted > 0 ? 'green' : 'gray'}>{handoffsCompleted}/{maxHandoffs}</Text></Text>
        </Box>
        <Box justifyContent="space-between">
          <Text dimColor>[s]</Text>
          <Text> Sessions: <Text bold>{sessionNum}/{maxSessions}</Text></Text>
          <Text>  </Text>
          <Text dimColor>[b]</Text>
          <Text> Budget: <Text bold>${sessionBudget.toFixed(2)}</Text>/session</Text>
        </Box>
      </Box>
    </Box>
  );
}
