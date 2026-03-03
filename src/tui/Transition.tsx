import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';

interface TransitionProps {
  sessionNum: number;
  maxSessions: number;
  contextPercent: number;
  costUsd: number;
  tasksCompleted: number;
  tasksTotal: number;
  knowledgePromoted: number;
  onComplete: () => void;
  delayMs?: number;
}

export function Transition({
  sessionNum,
  maxSessions,
  contextPercent,
  costUsd,
  tasksCompleted,
  tasksTotal,
  knowledgePromoted,
  onComplete,
  delayMs = 3000,
}: TransitionProps) {
  const [countdown, setCountdown] = useState(Math.ceil(delayMs / 1000));

  useEffect(() => {
    const timer = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          clearInterval(timer);
          onComplete();
          return 0;
        }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [delayMs, onComplete]);

  return (
    <Box flexDirection="column" alignItems="center" borderStyle="double" borderColor="cyan" padding={1}>
      <Text bold color="cyan">SESSION {sessionNum} COMPLETE</Text>
      <Text> </Text>
      <Text>Context used: <Text bold>{contextPercent}%</Text></Text>
      <Text>Cost: <Text bold>${costUsd.toFixed(2)}</Text></Text>
      {tasksTotal > 0 && (
        <Text>Tasks completed: <Text bold>{tasksCompleted}/{tasksTotal}</Text></Text>
      )}
      {knowledgePromoted > 0 && (
        <Text>Knowledge promoted: <Text bold>{knowledgePromoted} new entries</Text></Text>
      )}
      <Text> </Text>
      <Text dimColor>
        Starting Session {sessionNum + 1}/{maxSessions} in {countdown}s...
      </Text>
    </Box>
  );
}
