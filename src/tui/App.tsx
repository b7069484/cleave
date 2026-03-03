import React from 'react';
import { Box, Text, useInput } from 'ink';
import { Header } from './Header.js';
import { StreamView } from './StreamView.js';
import { Footer } from './Footer.js';
import { Transition } from './Transition.js';
import { LimitOverlay } from './LimitOverlay.js';
import { useRelay } from './useRelay.js';
import type { RelayConfig } from '../relay/config.js';

interface AppProps {
  config: RelayConfig;
}

export function App({ config }: AppProps) {
  const { state, advanceFromTransition, openOverlay, closeOverlay, updateMaxSessions, updateSessionBudget } = useRelay(config);

  // Global hotkeys for s/b (only when no overlay is active and not in transition text input)
  useInput((input, key) => {
    if (state.overlayMode) return;
    if (state.phase === 'complete' || state.phase === 'error') return;

    if (input === 's' || input === 'S') {
      openOverlay('sessions');
    } else if (input === 'b' || input === 'B') {
      openOverlay('budget');
    }
  }, { isActive: !state.overlayMode && state.phase !== 'transition' });

  if (state.phase === 'complete') {
    return (
      <Box flexDirection="column" padding={1}>
        <Box borderStyle="double" borderColor={state.completed ? 'green' : 'yellow'} padding={1} flexDirection="column" alignItems="center">
          <Text bold color={state.completed ? 'green' : 'yellow'}>
            {state.completed ? 'TASK COMPLETE' : 'SESSION LIMIT REACHED'}
          </Text>
          <Text>Sessions run: {state.totalSessions}</Text>
          <Text>Total cost: ${state.totalCostUsd.toFixed(2)}</Text>
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
        costUsd={state.totalCostUsd}
        tasksCompleted={0}
        tasksTotal={0}
        knowledgePromoted={0}
        onComplete={advanceFromTransition}
        mode={config.mode}
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
        sessionCostUsd={state.sessionCostUsd}
        totalCostUsd={state.totalCostUsd}
        budgetUsd={state.budgetUsd}
        contextPercent={state.contextPercent}
      />
      {state.overlayMode ? (
        <LimitOverlay
          type={state.overlayMode}
          currentValue={state.overlayMode === 'sessions' ? state.maxSessions : state.budgetUsd}
          sessionNum={state.sessionNum}
          maxSessions={state.maxSessions}
          onConfirm={state.overlayMode === 'sessions' ? updateMaxSessions : updateSessionBudget}
          onCancel={closeOverlay}
        />
      ) : (
        <StreamView events={state.events} />
      )}
      <Footer
        knowledge={state.knowledge}
        handoffsCompleted={state.handoffsCompleted}
        maxHandoffs={Math.max(0, state.maxSessions - 1)}
        runningAgents={state.runningAgents}
        sessionNum={state.sessionNum}
        maxSessions={state.maxSessions}
        sessionBudget={state.budgetUsd}
      />
    </Box>
  );
}
