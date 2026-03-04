import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Box, Text, useInput } from 'ink';
import { Header } from './Header.js';
import { StreamView } from './StreamView.js';
import { Footer } from './Footer.js';
import { Transition } from './Transition.js';
import { LimitOverlay } from './LimitOverlay.js';
import { CompletionTransition } from './CompletionTransition.js';
import { useRelay } from './useRelay.js';
export function App({ config }) {
    const { state, advanceFromTransition, openOverlay, closeOverlay, updateMaxSessions, updateSessionBudget, quitRelay } = useRelay(config);
    // Global hotkeys for s/b (only when no overlay is active and not in transition text input)
    useInput((input, key) => {
        if (state.overlayMode)
            return;
        if (state.phase === 'complete' || state.phase === 'debrief' || state.phase === 'done' || state.phase === 'error')
            return;
        if (input === 's' || input === 'S') {
            openOverlay('sessions');
        }
        else if (input === 'b' || input === 'B') {
            openOverlay('budget');
        }
    }, { isActive: !state.overlayMode && state.phase !== 'transition' });
    if (state.phase === 'complete') {
        if (state.overlayMode) {
            return (_jsx(LimitOverlay, { type: state.overlayMode, currentValue: state.overlayMode === 'sessions' ? state.maxSessions : state.budgetUsd, sessionNum: state.sessionNum, maxSessions: state.maxSessions, onConfirm: (n) => {
                    updateMaxSessions(n);
                    closeOverlay();
                    advanceFromTransition('Continue with extended session limit');
                }, onCancel: closeOverlay }));
        }
        return (_jsx(CompletionTransition, { completed: state.completed, sessionsRun: state.totalSessions || state.sessionNum, totalCostUsd: state.totalCostUsd, progressSummary: state.progressSummary ?? '', onContinue: advanceFromTransition, onAddSessions: () => openOverlay('sessions'), onQuit: quitRelay }));
    }
    if (state.phase === 'debrief') {
        return (_jsx(Box, { flexDirection: "column", padding: 1, children: _jsxs(Box, { borderStyle: "double", borderColor: "cyan", padding: 1, flexDirection: "column", children: [_jsx(Box, { justifyContent: "center", children: _jsx(Text, { bold: true, color: "cyan", children: "Generating Debrief Report..." }) }), _jsx(StreamView, { events: state.events })] }) }));
    }
    if (state.phase === 'done') {
        return (_jsx(Box, { flexDirection: "column", padding: 1, children: _jsxs(Box, { borderStyle: "double", borderColor: "green", padding: 1, flexDirection: "column", alignItems: "center", children: [_jsx(Text, { bold: true, color: "green", children: state.completed ? 'TASK COMPLETE' : 'SESSION LIMIT REACHED' }), _jsxs(Text, { children: ["Sessions: ", state.totalSessions] }), _jsxs(Text, { children: ["Total cost: $", state.totalCostUsd.toFixed(2)] })] }) }));
    }
    if (state.phase === 'error') {
        return (_jsx(Box, { flexDirection: "column", padding: 1, children: _jsxs(Box, { borderStyle: "double", borderColor: "red", padding: 1, children: [_jsx(Text, { bold: true, color: "red", children: "Error: " }), _jsx(Text, { children: state.error })] }) }));
    }
    if (state.phase === 'transition') {
        return (_jsx(Transition, { sessionNum: state.sessionNum, maxSessions: state.maxSessions, contextPercent: state.contextPercent, costUsd: state.totalCostUsd, tasksCompleted: 0, tasksTotal: 0, knowledgePromoted: 0, onComplete: advanceFromTransition, mode: config.mode }));
    }
    // Running phase
    return (_jsxs(Box, { flexDirection: "column", height: "100%", children: [_jsx(Header, { sessionNum: state.sessionNum, maxSessions: state.maxSessions, projectDir: config.projectDir, elapsedMs: state.elapsedMs, sessionCostUsd: state.sessionCostUsd, totalCostUsd: state.totalCostUsd, budgetUsd: state.budgetUsd, contextPercent: state.contextPercent }), state.overlayMode ? (_jsx(LimitOverlay, { type: state.overlayMode, currentValue: state.overlayMode === 'sessions' ? state.maxSessions : state.budgetUsd, sessionNum: state.sessionNum, maxSessions: state.maxSessions, onConfirm: state.overlayMode === 'sessions' ? updateMaxSessions : updateSessionBudget, onCancel: closeOverlay })) : (_jsx(StreamView, { events: state.events })), _jsx(Footer, { knowledge: state.knowledge, handoffsCompleted: state.handoffsCompleted, maxHandoffs: Math.max(0, state.maxSessions - 1), runningAgents: state.runningAgents, sessionNum: state.sessionNum, maxSessions: state.maxSessions, sessionBudget: state.budgetUsd })] }));
}
//# sourceMappingURL=App.js.map