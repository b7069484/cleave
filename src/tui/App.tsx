import React from 'react';
import { Box, Text } from 'ink';
import { Header } from './Header.js';
import { StreamView } from './StreamView.js';
import { Footer } from './Footer.js';
import { Transition } from './Transition.js';
import { useRelay } from './useRelay.js';
import type { RelayConfig } from '../relay/config.js';

interface AppProps {
  config: RelayConfig;
}

export function App({ config }: AppProps) {
  const { state, advanceFromTransition } = useRelay(config);

  if (state.phase === 'complete') {
    return (
      <Box flexDirection="column" padding={1}>
        <Box borderStyle="double" borderColor={state.completed ? 'green' : 'yellow'} padding={1} flexDirection="column" alignItems="center">
          <Text bold color={state.completed ? 'green' : 'yellow'}>
            {state.completed ? 'TASK COMPLETE' : 'SESSION LIMIT REACHED'}
          </Text>
          <Text>Sessions run: {state.totalSessions}</Text>
          <Text>Total cost: ${state.costUsd.toFixed(2)}</Text>
        </Box>
      </Box>
    );
  }

  if (state.phase === 'error') {
    return (
      <Box flexDirection="column" padding={1}>
        <Box borderStyle="double" borderColor="red" padding={1}>
          <Text bold color="red">Error: </Text>
          <Text>{state.error}</Text>
        </Box>
      </Box>
    );
  }

  if (state.phase === 'transition') {
    return (
      <Transition
        sessionNum={state.sessionNum}
        maxSessions={state.maxSessions}
        contextPercent={state.contextPercent}
        costUsd={state.costUsd}
        tasksCompleted={0}
        tasksTotal={0}
        knowledgePromoted={0}
        onComplete={advanceFromTransition}
      />
    );
  }

  // Running phase
  return (
    <Box flexDirection="column" height="100%">
      <Header
        sessionNum={state.sessionNum}
        maxSessions={state.maxSessions}
        projectDir={config.projectDir}
        elapsedMs={state.elapsedMs}
        costUsd={state.costUsd}
        budgetUsd={state.budgetUsd}
        contextPercent={state.contextPercent}
      />
      <StreamView events={state.events} />
      <Footer
        knowledgeSize={0}
        tasksCompleted={0}
        tasksTotal={0}
        handoffStatus="waiting"
      />
    </Box>
  );
}
