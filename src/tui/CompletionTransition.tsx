import React, { useState, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';

interface CompletionTransitionProps {
  completed: boolean;
  sessionsRun: number;
  totalCostUsd: number;
  progressSummary: string;
  onContinue: (userInput: string) => void;
  onAddSessions: () => void;
  onQuit: () => void;
}

export function CompletionTransition({
  completed,
  sessionsRun,
  totalCostUsd,
  progressSummary,
  onContinue,
  onAddSessions,
  onQuit,
}: CompletionTransitionProps) {
  const [userText, setUserText] = useState('');
  const [typing, setTyping] = useState(false);

  useInput(useCallback((input: string, key: { return?: boolean; backspace?: boolean; escape?: boolean }) => {
    if (key.escape || (!typing && (input === 'q' || input === 'Q'))) {
      onQuit();
      return;
    }

    if (!typing && (input === 's' || input === 'S')) {
      onAddSessions();
      return;
    }

    if (key.return) {
      if (typing && userText.trim()) {
        onContinue(userText.trim());
      }
      return;
    }

    if (key.backspace) {
      if (typing) {
        setUserText(t => t.slice(0, -1));
        if (userText.length <= 1) setTyping(false);
      }
      return;
    }

    if (input) {
      setTyping(true);
      setUserText(t => t + input);
    }
  }, [typing, userText, onContinue, onAddSessions, onQuit]));

  const progressLines = progressSummary
    .split('\n')
    .filter(l => l.trim() && !l.startsWith('## STATUS'))
    .slice(0, 5);

  return (
    <Box flexDirection="column" alignItems="center" borderStyle="double" borderColor={completed ? 'green' : 'yellow'} padding={1}>
      <Text bold color={completed ? 'green' : 'yellow'}>
        {completed ? 'TASK COMPLETE' : 'SESSION LIMIT REACHED'}
      </Text>
      <Text> </Text>
      <Text>Sessions run: <Text bold>{sessionsRun}</Text></Text>
      <Text>Total cost: <Text bold>${totalCostUsd.toFixed(2)}</Text></Text>

      {progressLines.length > 0 && (
        <Box flexDirection="column" marginTop={1} paddingX={2}>
          <Text dimColor bold>Latest progress:</Text>
          {progressLines.map((line, i) => (
            <Text key={i} dimColor>  {line}</Text>
          ))}
        </Box>
      )}

      <Text> </Text>

      {typing ? (
        <Box flexDirection="column" alignItems="center">
          <Text color="cyan">Type your follow-up instructions:</Text>
          <Box borderStyle="round" borderColor="cyan" paddingX={1} minWidth={50}>
            <Text>{userText}<Text color="cyan">|</Text></Text>
          </Box>
          <Text dimColor>Enter to send, Esc to cancel</Text>
        </Box>
      ) : (
        <Box flexDirection="column" alignItems="center">
          <Text dimColor>Type to add follow-up instructions</Text>
          <Text dimColor>[S] Add more sessions   [Q] Quit (generate debrief)</Text>
        </Box>
      )}
    </Box>
  );
}
