import { useState, useEffect, useCallback, useRef } from 'react';
import { RelayLoop } from '../relay/loop.js';
import type { RelayConfig } from '../relay/config.js';
import type { ParsedEvent } from '../stream/types.js';

export type RelayPhase = 'running' | 'transition' | 'complete' | 'error';

export interface RelayState {
  phase: RelayPhase;
  sessionNum: number;
  maxSessions: number;
  events: ParsedEvent[];
  costUsd: number;
  budgetUsd: number;
  contextPercent: number;
  elapsedMs: number;
  toolCount: number;
  error?: string;
  completed: boolean;
  totalSessions: number;
}

export function useRelay(config: RelayConfig) {
  const [state, setState] = useState<RelayState>({
    phase: 'running',
    sessionNum: 1,
    maxSessions: config.maxSessions,
    events: [],
    costUsd: 0,
    budgetUsd: config.sessionBudget,
    contextPercent: 0,
    elapsedMs: 0,
    toolCount: 0,
    completed: false,
    totalSessions: 0,
  });

  const startTimeRef = useRef(Date.now());
  const timerRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  useEffect(() => {
    // Elapsed time ticker
    timerRef.current = setInterval(() => {
      setState(s => ({ ...s, elapsedMs: Date.now() - startTimeRef.current }));
    }, 1000);

    const loop = new RelayLoop(config);

    loop.on('session_start', ({ sessionNum, maxSessions }: { sessionNum: number; maxSessions: number }) => {
      startTimeRef.current = Date.now();
      setState(s => ({
        ...s,
        phase: 'running',
        sessionNum,
        maxSessions,
        events: [],
        costUsd: 0,
        contextPercent: 0,
        toolCount: 0,
      }));
    });

    loop.on('event', (event: ParsedEvent) => {
      setState(s => {
        const newState = { ...s, events: [...s.events, event] };
        if (event.kind === 'tool_start') {
          newState.toolCount = s.toolCount + 1;
        }
        if (event.kind === 'result') {
          newState.costUsd = event.costUsd;
          // Estimate context from cost ratio (cost/budget ≈ context usage)
          newState.contextPercent = Math.min(99, Math.round((event.costUsd / config.sessionBudget) * 100));
        }
        return newState;
      });
    });

    loop.on('session_end', ({ sessionNum }: { sessionNum: number; result: any; totalCost: number }) => {
      setState(s => ({
        ...s,
        phase: 'transition',
        totalSessions: sessionNum,
      }));
    });

    loop.on('rescue', () => {
      setState(s => ({ ...s, phase: 'transition' }));
    });

    loop.run().then(result => {
      setState(s => ({
        ...s,
        phase: 'complete',
        completed: result.completed,
        totalSessions: result.sessionsRun,
      }));
      clearInterval(timerRef.current);
    }).catch(err => {
      setState(s => ({ ...s, phase: 'error', error: String(err) }));
      clearInterval(timerRef.current);
    });

    return () => clearInterval(timerRef.current);
  }, []);

  const advanceFromTransition = useCallback(() => {
    setState(s => ({ ...s, phase: 'running' }));
  }, []);

  return { state, advanceFromTransition };
}
