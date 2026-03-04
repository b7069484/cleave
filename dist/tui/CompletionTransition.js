import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
export function CompletionTransition({ completed, sessionsRun, totalCostUsd, progressSummary, onContinue, onAddSessions, onQuit, }) {
    const [userText, setUserText] = useState('');
    const [typing, setTyping] = useState(false);
    useInput(useCallback((input, key) => {
        if (key.escape) {
            if (typing) {
                setUserText('');
                setTyping(false);
            }
            else {
                onQuit();
            }
            return;
        }
        if (!typing && (input === 'q' || input === 'Q')) {
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
        if (key.backspace || input === '\x7f') {
            if (typing) {
                setUserText(t => {
                    const next = t.slice(0, -1);
                    if (next.length === 0)
                        setTyping(false);
                    return next;
                });
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
    return (_jsxs(Box, { flexDirection: "column", alignItems: "center", borderStyle: "double", borderColor: completed ? 'green' : 'yellow', padding: 1, children: [_jsx(Text, { bold: true, color: completed ? 'green' : 'yellow', children: completed ? 'TASK COMPLETE' : 'SESSION LIMIT REACHED' }), _jsx(Text, { children: " " }), _jsxs(Text, { children: ["Sessions run: ", _jsx(Text, { bold: true, children: sessionsRun })] }), _jsxs(Text, { children: ["Total cost: ", _jsxs(Text, { bold: true, children: ["$", totalCostUsd.toFixed(2)] })] }), progressLines.length > 0 && (_jsxs(Box, { flexDirection: "column", marginTop: 1, paddingX: 2, children: [_jsx(Text, { dimColor: true, bold: true, children: "Latest progress:" }), progressLines.map((line, i) => (_jsxs(Text, { dimColor: true, children: ["  ", line] }, i)))] })), _jsx(Text, { children: " " }), typing ? (_jsxs(Box, { flexDirection: "column", alignItems: "center", children: [_jsx(Text, { color: "cyan", children: "Type your follow-up instructions:" }), _jsx(Box, { borderStyle: "round", borderColor: "cyan", paddingX: 1, minWidth: 50, children: _jsxs(Text, { children: [userText, _jsx(Text, { color: "cyan", children: "|" })] }) }), _jsx(Text, { dimColor: true, children: "Enter to send, Esc to cancel" })] })) : (_jsxs(Box, { flexDirection: "column", alignItems: "center", children: [_jsx(Text, { dimColor: true, children: "Type to add follow-up instructions" }), _jsx(Text, { dimColor: true, children: "[S] Add more sessions   [Q] Quit (generate debrief)" })] }))] }));
}
//# sourceMappingURL=CompletionTransition.js.map