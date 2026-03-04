import React, { useState, useEffect, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import type { CleaveMode } from '../relay/config.js';

interface TransitionProps {
  sessionNum: number;
  maxSessions: number;
  contextPercent: number;
  costUsd: number;
  tasksCompleted: number;
  tasksTotal: number;
  knowledgePromoted: number;
  onComplete: (userInput?: string) => void;
  mode: CleaveMode;
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
  mode,
  delayMs,
}: TransitionProps) {
  const autoDelay = delayMs ?? (mode === 'auto' ? 3000 : 10000);
  const [countdown, setCountdown] = useState(Math.ceil(autoDelay / 1000));
  const [userText, setUserText] = useState('');
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused) return;

    const timer = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          clearInterval(timer);
          onComplete(userText || undefined);
          return 0;
        }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [paused, onComplete, userText]);

  // Handle keyboard input in guided mode
  useInput(useCallback((input: string, key: { return?: boolean; backspace?: boolean; escape?: boolean }) => {
    if (mode === 'auto') return;

    if (key.escape || input === 'q' || input === 'Q') {
      // Quit — exit the relay
      process.exit(0);
    }

    if (key.return) {
      if (paused && userText.trim()) {
        // User finished typing — advance with their input
        onComplete(userText.trim());
      } else if (paused) {
        // Just pressed enter with no text — continue normally
        onComplete(undefined);
      }
      return;
    }

    if (key.backspace || input === '\x7f') {
      if (!paused && userText.length === 0) return;
      setPaused(true);
      setUserText(t => t.slice(0, -1));
      return;
    }

    // Any other key starts typing — pause the countdown
    if (input && !key.return) {
      setPaused(true);
      setUserText(t => t + input);
    }
  }, [mode, paused, userText, onComplete]));

  return (
    <Box flexDirection="column" alignItems="center" borderStyle="double" borderColor="cyan" padding={1}>
      <Text bold color="cyan">SESSION {sessionNum} COMPLETE</Text>
      <Text> </Text>
      <Text>Context used: <Text bold>{contextPercent}%</Text></Text>
      <Text>Cost so far: <Text bold>${costUsd.toFixed(2)}</Text></Text>
      {tasksTotal > 0 && (
        <Text>Tasks completed: <Text bold>{tasksCompleted}/{tasksTotal}</Text></Text>
      )}
      {knowledgePromoted > 0 && (
        <Text>Knowledge promoted: <Text bold>{knowledgePromoted} new entries</Text></Text>
      )}
      <Text> </Text>

      {mode === 'auto' ? (
        <Text dimColor>
          Starting Session {sessionNum + 1}/{maxSessions} in {countdown}s...
        </Text>
      ) : (
        <>
          {paused ? (
            <Box flexDirection="column" alignItems="center">
              <Text color="yellow">Countdown paused — type your instructions:</Text>
              <Box borderStyle="round" borderColor="yellow" paddingX={1} minWidth={50}>
                <Text>{userText}<Text color="yellow">|</Text></Text>
              </Box>
              <Text dimColor>Enter to send, Esc/Q to quit</Text>
            </Box>
          ) : (
            <Box flexDirection="column" alignItems="center">
              <Text dimColor>
                Session {sessionNum + 1}/{maxSessions} in {countdown}s
              </Text>
              <Text dimColor>Type to add instructions, Q to quit, or wait to auto-continue</Text>
            </Box>
          )}
        </>
      )}
    </Box>
  );
}
