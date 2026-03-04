import { useState, useEffect, useCallback, useRef } from 'react';
import { readFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { RelayLoop } from '../relay/loop.js';
import type { RelayConfig } from '../relay/config.js';
import type { ParsedEvent } from '../stream/types.js';
import type { LimitType } from './LimitOverlay.js';
import { parseKnowledgeMetrics } from '../state/knowledge.js';

export type RelayPhase = 'running' | 'transition' | 'complete' | 'debrief' | 'done' | 'error';

export interface RunningAgent {
  id: string;
  description: string;
  type: string;
  startedAt: number;
}

export interface RelayState {
  phase: RelayPhase;
  sessionNum: number;
  maxSessions: number;
  events: ParsedEvent[];
  sessionCostUsd: number;   // Cost for current session only
  totalCostUsd: number;     // Cumulative cost across all sessions
  budgetUsd: number;        // Per-session budget
  contextPercent: number;
  elapsedMs: number;
  toolCount: number;
  knowledge: { insights: number; coreBytes: number; sessionBytes: number };
  handoffsCompleted: number; // Successful handoffs (increments when new session starts)
  runningAgents: RunningAgent[];
  progressSummary: string;
  error?: string;
  completed: boolean;
  totalSessions: number;
  overlayMode: LimitType | null;
}

export function useRelay(config: RelayConfig) {
  const [state, setState] = useState<RelayState>({
    phase: 'running',
    sessionNum: 1,
    maxSessions: config.maxSessions,
    events: [],
    sessionCostUsd: 0,
    totalCostUsd: 0,
    budgetUsd: config.sessionBudget,
    contextPercent: 0,
    elapsedMs: 0,
    toolCount: 0,
    knowledge: { insights: 0, coreBytes: 0, sessionBytes: 0 },
    handoffsCompleted: 0,
    runningAgents: [],
    progressSummary: '',
    completed: false,
    totalSessions: 0,
    overlayMode: null,
  });

  const startTimeRef = useRef(Date.now());
  const timerRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const cumulativeCostRef = useRef(0);  // Track cost across sessions
  const loopRef = useRef<RelayLoop | null>(null);

  useEffect(() => {
    // Set up event log file
    const logDir = join(config.projectDir, '.cleave', 'logs');
    try { mkdirSync(logDir, { recursive: true }); } catch { /* exists */ }
    const logFile = join(logDir, 'events.log');

    function logEvent(label: string, data: unknown) {
      try {
        appendFileSync(logFile, `[${new Date().toISOString()}] ${label}: ${JSON.stringify(data)}\n`);
      } catch { /* ignore logging errors */ }
    }

    // Elapsed time ticker + knowledge file poll
    const kPath = join(config.projectDir, '.cleave', 'KNOWLEDGE.md');
    timerRef.current = setInterval(() => {
      let knowledge: { insights: number; coreBytes: number; sessionBytes: number } | undefined;
      try {
        const content = readFileSync(kPath, 'utf-8');
        const metrics = parseKnowledgeMetrics(content);
        knowledge = { insights: metrics.insightCount, coreBytes: metrics.coreSizeBytes, sessionBytes: metrics.sessionSizeBytes };
      } catch { /* not created yet */ }
      setState(s => ({
        ...s,
        elapsedMs: Date.now() - startTimeRef.current,
        ...(knowledge !== undefined ? { knowledge } : {}),
      }));
    }, 1000);

    const loop = new RelayLoop(config);
    loopRef.current = loop;

    loop.on('session_start', ({ sessionNum, maxSessions }: { sessionNum: number; maxSessions: number }) => {
      startTimeRef.current = Date.now();
      logEvent('session_start', { sessionNum, maxSessions });

      // Read knowledge metrics at session start
      let knowledge = { insights: 0, coreBytes: 0, sessionBytes: 0 };
      try {
        const content = readFileSync(kPath, 'utf-8');
        const metrics = parseKnowledgeMetrics(content);
        knowledge = { insights: metrics.insightCount, coreBytes: metrics.coreSizeBytes, sessionBytes: metrics.sessionSizeBytes };
      } catch { /* not created yet */ }

      setState(s => ({
        ...s,
        phase: 'running',
        sessionNum,
        maxSessions,
        events: [],
        sessionCostUsd: 0,
        totalCostUsd: cumulativeCostRef.current,
        contextPercent: 0,
        toolCount: 0,
        knowledge,
        // Session 2+ starting means a handoff succeeded
        handoffsCompleted: sessionNum > 1 ? sessionNum - 1 : 0,
        runningAgents: [],
      }));
    });

    loop.on('event', (event: ParsedEvent) => {
      if (event.kind !== 'text') {
        logEvent('event', event);
      }

      if (event.kind === 'tool_start') {
        setState(s => {
          const newState = { ...s, events: [...s.events, event], toolCount: s.toolCount + 1 };
          if (event.name === 'Agent') {
            newState.runningAgents = [...s.runningAgents, {
              id: event.id,
              description: String((event.input as Record<string, unknown>)?.description ?? 'agent'),
              type: String((event.input as Record<string, unknown>)?.subagent_type ?? 'unknown'),
              startedAt: Date.now(),
            }];
          }
          return newState;
        });
        return;
      }

      if (event.kind === 'tool_input') {
        // Update the matching tool_start event in place (re-renderable list will show it)
        setState(s => ({
          ...s,
          events: s.events.map(e =>
            e.kind === 'tool_start' && e.id === event.id
              ? { ...e, input: event.input }
              : e
          ),
          // Update agent info if applicable
          runningAgents: s.runningAgents.map(a =>
            a.id === event.id ? {
              ...a,
              description: String((event.input as Record<string, unknown>).description ?? a.description),
              type: String((event.input as Record<string, unknown>).subagent_type ?? a.type),
            } : a
          ),
        }));
        return;
      }

      if (event.kind === 'tool_end') {
        setState(s => ({
          ...s,
          events: [...s.events, event],
          runningAgents: s.runningAgents.filter(a => a.id !== event.id),
        }));
        return;
      }

      // All other events
      setState(s => {
        const newState = { ...s, events: [...s.events, event] };

        if (event.kind === 'usage') {
          const totalTokens = event.inputTokens + event.outputTokens;
          newState.contextPercent = Math.min(99, Math.round((totalTokens / 200_000) * 100));
          const estimatedCost = (event.inputTokens * 15 + event.outputTokens * 75) / 1_000_000;
          newState.sessionCostUsd = estimatedCost;
          newState.totalCostUsd = cumulativeCostRef.current + estimatedCost;
        }

        if (event.kind === 'result') {
          newState.sessionCostUsd = event.totalCostUsd;
          cumulativeCostRef.current += event.totalCostUsd;
          newState.totalCostUsd = cumulativeCostRef.current;
          if (event.inputTokens > 0 || event.outputTokens > 0) {
            const totalTokens = event.inputTokens + event.outputTokens;
            const ctxWindow = event.contextWindow || 200_000;
            newState.contextPercent = Math.min(99, Math.round((totalTokens / ctxWindow) * 100));
          }
        }

        return newState;
      });
    });

    loop.on('session_end', ({ sessionNum }: { sessionNum: number; result: any; totalCost: number }) => {
      logEvent('session_end', { sessionNum });
      setState(s => ({
        ...s,
        phase: 'transition',
        totalSessions: sessionNum,
      }));

      // In auto/headless mode, resolve transition immediately
      if (config.mode === 'auto' || config.mode === 'headless') {
        loop.resolveTransition();
      }
    });

    loop.on('rescue', ({ sessionNum }: { sessionNum: number }) => {
      logEvent('rescue', { sessionNum });
      setState(s => ({ ...s, phase: 'transition' }));

      if (config.mode === 'auto' || config.mode === 'headless') {
        loop.resolveTransition();
      }
    });

    loop.on('session_error', ({ sessionNum, error }: { sessionNum: number; error: unknown }) => {
      logEvent('session_error', { sessionNum, error: String(error) });
    });

    loop.on('fatal_error', ({ message }: { message: string }) => {
      logEvent('fatal_error', { message });
      setState(s => ({ ...s, phase: 'error', error: message }));
      clearInterval(timerRef.current);
    });

    loop.on('config_change', ({ maxSessions, sessionBudget }: { maxSessions: number; sessionBudget: number }) => {
      setState(s => ({
        ...s,
        maxSessions,
        budgetUsd: sessionBudget,
      }));
    });

    loop.on('completion', ({ reason }: { reason: string }) => {
      // Read progress for display on the completion screen
      const progressFile = join(config.projectDir, '.cleave', 'PROGRESS.md');
      let progressSummary = '';
      try { progressSummary = readFileSync(progressFile, 'utf-8'); } catch { /* ok */ }

      setState(s => ({
        ...s,
        phase: 'complete',
        completed: reason === 'task_complete',
        progressSummary,
      }));
    });

    loop.on('debrief_start', () => {
      setState(s => ({ ...s, phase: 'debrief', events: [] }));
    });

    loop.on('debrief_end', () => {
      // Don't set done here — loop.run().then() handles that
    });

    loop.run().then(result => {
      logEvent('relay_complete', result);
      setState(s => ({
        ...s,
        phase: 'done',
        completed: result.completed,
        totalSessions: result.sessionsRun,
        totalCostUsd: result.totalCostUsd || cumulativeCostRef.current,
      }));
      clearInterval(timerRef.current);
    }).catch(err => {
      logEvent('relay_error', { error: String(err) });
      setState(s => ({ ...s, phase: 'error', error: String(err) }));
      clearInterval(timerRef.current);
    });

    return () => clearInterval(timerRef.current);
  }, []);

  const advanceFromTransition = useCallback((userInput?: string) => {
    setState(s => ({ ...s, phase: 'running' }));
    // Signal the relay loop to continue (may inject user input into next prompt)
    loopRef.current?.resolveTransition(userInput);
  }, []);

  const openOverlay = useCallback((type: LimitType) => {
    setState(s => ({ ...s, overlayMode: type }));
  }, []);

  const closeOverlay = useCallback(() => {
    setState(s => ({ ...s, overlayMode: null }));
  }, []);

  const updateMaxSessions = useCallback((n: number) => {
    loopRef.current?.updateMaxSessions(n);
    setState(s => ({ ...s, overlayMode: null }));
  }, []);

  const updateSessionBudget = useCallback((n: number) => {
    loopRef.current?.updateSessionBudget(n);
    setState(s => ({ ...s, overlayMode: null }));
  }, []);

  const quitRelay = useCallback(() => {
    loopRef.current?.resolveTransition(undefined);
  }, []);

  return { state, advanceFromTransition, openOverlay, closeOverlay, updateMaxSessions, updateSessionBudget, quitRelay };
}
