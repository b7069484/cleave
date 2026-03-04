import { jsxs as _jsxs, jsx as _jsx, Fragment as _Fragment } from "react/jsx-runtime";
import { useState, useEffect, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
export function Transition({ sessionNum, maxSessions, contextPercent, costUsd, tasksCompleted, tasksTotal, knowledgePromoted, onComplete, mode, delayMs, }) {
    const autoDelay = delayMs ?? (mode === 'auto' ? 3000 : 10000);
    const [countdown, setCountdown] = useState(Math.ceil(autoDelay / 1000));
    const [userText, setUserText] = useState('');
    const [paused, setPaused] = useState(false);
    useEffect(() => {
        if (paused)
            return;
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
    useInput(useCallback((input, key) => {
        if (mode === 'auto')
            return;
        if (key.escape || input === 'q' || input === 'Q') {
            // Quit — exit the relay
            process.exit(0);
        }
        if (key.return) {
            if (paused && userText.trim()) {
                // User finished typing — advance with their input
                onComplete(userText.trim());
            }
            else if (paused) {
                // Just pressed enter with no text — continue normally
                onComplete(undefined);
            }
            return;
        }
        if (key.backspace || key.delete) {
            if (!paused && userText.length === 0)
                return;
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
    return (_jsxs(Box, { flexDirection: "column", alignItems: "center", borderStyle: "double", borderColor: "cyan", padding: 1, children: [_jsxs(Text, { bold: true, color: "cyan", children: ["SESSION ", sessionNum, " COMPLETE"] }), _jsx(Text, { children: " " }), _jsxs(Text, { children: ["Context used: ", _jsxs(Text, { bold: true, children: [contextPercent, "%"] })] }), _jsxs(Text, { children: ["Cost so far: ", _jsxs(Text, { bold: true, children: ["$", costUsd.toFixed(2)] })] }), tasksTotal > 0 && (_jsxs(Text, { children: ["Tasks completed: ", _jsxs(Text, { bold: true, children: [tasksCompleted, "/", tasksTotal] })] })), knowledgePromoted > 0 && (_jsxs(Text, { children: ["Knowledge promoted: ", _jsxs(Text, { bold: true, children: [knowledgePromoted, " new entries"] })] })), _jsx(Text, { children: " " }), mode === 'auto' ? (_jsxs(Text, { dimColor: true, children: ["Starting Session ", sessionNum + 1, "/", maxSessions, " in ", countdown, "s..."] })) : (_jsx(_Fragment, { children: paused ? (_jsxs(Box, { flexDirection: "column", alignItems: "center", children: [_jsx(Text, { color: "yellow", children: "Countdown paused \u2014 type your instructions:" }), _jsx(Box, { borderStyle: "round", borderColor: "yellow", paddingX: 1, minWidth: 50, children: _jsxs(Text, { children: [userText, _jsx(Text, { color: "yellow", children: "|" })] }) }), _jsx(Text, { dimColor: true, children: "Enter to send, Esc/Q to quit" })] })) : (_jsxs(Box, { flexDirection: "column", alignItems: "center", children: [_jsxs(Text, { dimColor: true, children: ["Session ", sessionNum + 1, "/", maxSessions, " in ", countdown, "s"] }), _jsx(Text, { dimColor: true, children: "Type to add instructions, Q to quit, or wait to auto-continue" })] })) }))] }));
}
//# sourceMappingURL=Transition.js.map