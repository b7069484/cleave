import React, { useState, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';

export type LimitType = 'sessions' | 'budget';

interface LimitOverlayProps {
  type: LimitType;
  currentValue: number;
  sessionNum: number;
  maxSessions: number;
  onConfirm: (newValue: number) => void;
  onCancel: () => void;
}

export function LimitOverlay({
  type,
  currentValue,
  sessionNum,
  maxSessions,
  onConfirm,
  onCancel,
}: LimitOverlayProps) {
  const [inputText, setInputText] = useState('');
  const [error, setError] = useState('');

  const isSessions = type === 'sessions';
  const title = isSessions ? 'Adjust Session Limit' : 'Adjust Session Budget';

  useInput(useCallback((input: string, key: { return?: boolean; escape?: boolean; backspace?: boolean; delete?: boolean }) => {
    if (key.escape) {
      onCancel();
      return;
    }

    if (key.return) {
      const parsed = isSessions ? parseInt(inputText, 10) : parseFloat(inputText);
      if (isNaN(parsed) || parsed <= 0) {
        setError('Enter a valid positive number');
        return;
      }
      if (isSessions && parsed < sessionNum) {
        setError(`Must be >= current session (${sessionNum})`);
        return;
      }
      onConfirm(parsed);
      return;
    }

    if (key.backspace || key.delete) {
      setInputText(t => t.slice(0, -1));
      setError('');
      return;
    }

    // Only accept digits and decimal point (for budget)
    if (/^[\d.]$/.test(input)) {
      setInputText(t => t + input);
      setError('');
    }
  }, [inputText, isSessions, sessionNum, onConfirm, onCancel]));

  return (
    <Box
      flexDirection="column"
      borderStyle="double"
      borderColor="yellow"
      paddingX={2}
      paddingY={1}
      alignItems="center"
    >
      <Text bold color="yellow">{title}</Text>
      <Text> </Text>
      <Box justifyContent="space-between" width={40}>
        <Text>Current: <Text bold>{isSessions ? currentValue : `$${currentValue.toFixed(2)}`}</Text></Text>
        {isSessions && <Text>Session: <Text bold>{sessionNum} of {maxSessions}</Text></Text>}
      </Box>
      <Text> </Text>
      <Box>
        <Text>New {isSessions ? 'limit' : 'budget'}: </Text>
        <Box borderStyle="round" borderColor="cyan" paddingX={1} minWidth={10}>
          <Text>{isSessions ? '' : '$'}{inputText}<Text color="cyan">|</Text></Text>
        </Box>
      </Box>
      {error ? (
        <Text color="red">{error}</Text>
      ) : (
        <Text> </Text>
      )}
      {!isSessions && (
        <Text dimColor>Takes effect next session</Text>
      )}
      <Text dimColor>Enter to confirm · Esc to cancel</Text>
    </Box>
  );
}
