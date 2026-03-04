import { useState, useEffect, useCallback, useRef } from 'react';
import { readFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { RelayLoop } from '../relay/loop.js';
import { parseKnowledgeMetrics } from '../state/knowledge.js';
export function useRelay(config) {
    const [state, setState] = useState({
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
    const timerRef = useRef(undefined);
    const cumulativeCostRef = useRef(0); // Track cost across sessions
    const loopRef = useRef(null);
    // Buffer tool_start events until their input is populated (Ink's <Static> can't re-render)
    const pendingToolsRef = useRef(new Map());
    useEffect(() => {
        // Set up event log file
        const logDir = join(config.projectDir, '.cleave', 'logs');
        try {
            mkdirSync(logDir, { recursive: true });
        }
        catch { /* exists */ }
        const logFile = join(logDir, 'events.log');
        function logEvent(label, data) {
            try {
                appendFileSync(logFile, `[${new Date().toISOString()}] ${label}: ${JSON.stringify(data)}\n`);
            }
            catch { /* ignore logging errors */ }
        }
        // Elapsed time ticker + knowledge file poll
        const kPath = join(config.projectDir, '.cleave', 'KNOWLEDGE.md');
        timerRef.current = setInterval(() => {
            let knowledge;
            try {
                const content = readFileSync(kPath, 'utf-8');
                const metrics = parseKnowledgeMetrics(content);
                knowledge = { insights: metrics.insightCount, coreBytes: metrics.coreSizeBytes, sessionBytes: metrics.sessionSizeBytes };
            }
            catch { /* not created yet */ }
            setState(s => ({
                ...s,
                elapsedMs: Date.now() - startTimeRef.current,
                ...(knowledge !== undefined ? { knowledge } : {}),
            }));
        }, 1000);
        const loop = new RelayLoop(config);
        loopRef.current = loop;
        loop.on('session_start', ({ sessionNum, maxSessions }) => {
            startTimeRef.current = Date.now();
            logEvent('session_start', { sessionNum, maxSessions });
            // Read knowledge metrics at session start
            let knowledge = { insights: 0, coreBytes: 0, sessionBytes: 0 };
            try {
                const content = readFileSync(kPath, 'utf-8');
                const metrics = parseKnowledgeMetrics(content);
                knowledge = { insights: metrics.insightCount, coreBytes: metrics.coreSizeBytes, sessionBytes: metrics.sessionSizeBytes };
            }
            catch { /* not created yet */ }
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
        loop.on('event', (event) => {
            // Log non-text events for debugging (text events are too noisy)
            if (event.kind !== 'text') {
                logEvent('event', event);
            }
            // --- Tool buffering: hold tool_start until input is known ---
            // Ink's <Static> renders items once and can't update them, so we must
            // wait for tool_input before adding tool_start to the events array.
            if (event.kind === 'tool_start') {
                const hasInput = event.input && Object.keys(event.input).length > 0;
                if (!hasInput) {
                    // Buffer — don't add to events yet, but track toolCount and agents
                    pendingToolsRef.current.set(event.id, event);
                    setState(s => {
                        const newState = { ...s, toolCount: s.toolCount + 1 };
                        if (event.name === 'Agent') {
                            newState.runningAgents = [...s.runningAgents, {
                                    id: event.id,
                                    description: 'agent',
                                    type: 'unknown',
                                    startedAt: Date.now(),
                                }];
                        }
                        return newState;
                    });
                    return;
                }
                // Has input already — add directly (also update agent info)
                setState(s => {
                    const newState = { ...s, events: [...s.events, event], toolCount: s.toolCount + 1 };
                    if (event.name === 'Agent') {
                        newState.runningAgents = [...s.runningAgents, {
                                id: event.id,
                                description: String(event.input.description ?? 'agent'),
                                type: String(event.input.subagent_type ?? 'unknown'),
                                startedAt: Date.now(),
                            }];
                    }
                    return newState;
                });
                return;
            }
            if (event.kind === 'tool_input') {
                const pending = pendingToolsRef.current.get(event.id);
                if (pending) {
                    // Merge input and flush buffered tool to events
                    pendingToolsRef.current.delete(event.id);
                    const merged = { ...pending, input: event.input };
                    setState(s => {
                        const newState = { ...s, events: [...s.events, merged] };
                        // Update agent info now that we have real input
                        if (pending.name === 'Agent') {
                            newState.runningAgents = s.runningAgents.map(a => a.id === event.id ? {
                                ...a,
                                description: String(event.input.description ?? a.description),
                                type: String(event.input.subagent_type ?? a.type),
                            } : a);
                        }
                        return newState;
                    });
                }
                else {
                    // Tool was already in events (had input from start), update in place
                    setState(s => ({
                        ...s,
                        events: s.events.map(e => e.kind === 'tool_start' && e.id === event.id
                            ? { ...e, input: event.input }
                            : e),
                    }));
                }
                return;
            }
            if (event.kind === 'tool_end') {
                // Flush any pending tool that never got its input
                const pending = pendingToolsRef.current.get(event.id);
                if (pending) {
                    pendingToolsRef.current.delete(event.id);
                    setState(s => ({
                        ...s,
                        events: [...s.events, pending],
                        runningAgents: s.runningAgents.filter(a => a.id !== event.id),
                    }));
                    return;
                }
                setState(s => ({
                    ...s,
                    events: [...s.events, event],
                    runningAgents: s.runningAgents.some(a => a.id === event.id)
                        ? s.runningAgents.filter(a => a.id !== event.id)
                        : s.runningAgents,
                }));
                return;
            }
            // All other events: append normally
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
        loop.on('session_end', ({ sessionNum }) => {
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
        loop.on('rescue', ({ sessionNum }) => {
            logEvent('rescue', { sessionNum });
            setState(s => ({ ...s, phase: 'transition' }));
            if (config.mode === 'auto' || config.mode === 'headless') {
                loop.resolveTransition();
            }
        });
        loop.on('session_error', ({ sessionNum, error }) => {
            logEvent('session_error', { sessionNum, error: String(error) });
        });
        loop.on('fatal_error', ({ message }) => {
            logEvent('fatal_error', { message });
            setState(s => ({ ...s, phase: 'error', error: message }));
            clearInterval(timerRef.current);
        });
        loop.on('config_change', ({ maxSessions, sessionBudget }) => {
            setState(s => ({
                ...s,
                maxSessions,
                budgetUsd: sessionBudget,
            }));
        });
        loop.on('completion', ({ reason }) => {
            // Read progress for display on the completion screen
            const progressFile = join(config.projectDir, '.cleave', 'PROGRESS.md');
            let progressSummary = '';
            try {
                progressSummary = readFileSync(progressFile, 'utf-8');
            }
            catch { /* ok */ }
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
    const advanceFromTransition = useCallback((userInput) => {
        setState(s => ({ ...s, phase: 'running' }));
        // Signal the relay loop to continue (may inject user input into next prompt)
        loopRef.current?.resolveTransition(userInput);
    }, []);
    const openOverlay = useCallback((type) => {
        setState(s => ({ ...s, overlayMode: type }));
    }, []);
    const closeOverlay = useCallback(() => {
        setState(s => ({ ...s, overlayMode: null }));
    }, []);
    const updateMaxSessions = useCallback((n) => {
        loopRef.current?.updateMaxSessions(n);
        setState(s => ({ ...s, overlayMode: null }));
    }, []);
    const updateSessionBudget = useCallback((n) => {
        loopRef.current?.updateSessionBudget(n);
        setState(s => ({ ...s, overlayMode: null }));
    }, []);
    const quitRelay = useCallback(() => {
        loopRef.current?.resolveTransition(undefined);
    }, []);
    return { state, advanceFromTransition, openOverlay, closeOverlay, updateMaxSessions, updateSessionBudget, quitRelay };
}
//# sourceMappingURL=useRelay.js.map