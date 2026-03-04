import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
export function LimitOverlay({ type, currentValue, sessionNum, maxSessions, onConfirm, onCancel, }) {
    const [inputText, setInputText] = useState('');
    const [error, setError] = useState('');
    const isSessions = type === 'sessions';
    const title = isSessions ? 'Adjust Session Limit' : 'Adjust Session Budget';
    useInput(useCallback((input, key) => {
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
    return (_jsxs(Box, { flexDirection: "column", borderStyle: "double", borderColor: "yellow", paddingX: 2, paddingY: 1, alignItems: "center", children: [_jsx(Text, { bold: true, color: "yellow", children: title }), _jsx(Text, { children: " " }), _jsxs(Box, { justifyContent: "space-between", width: 40, children: [_jsxs(Text, { children: ["Current: ", _jsx(Text, { bold: true, children: isSessions ? currentValue : `$${currentValue.toFixed(2)}` })] }), isSessions && _jsxs(Text, { children: ["Session: ", _jsxs(Text, { bold: true, children: [sessionNum, " of ", maxSessions] })] })] }), _jsx(Text, { children: " " }), _jsxs(Box, { children: [_jsxs(Text, { children: ["New ", isSessions ? 'limit' : 'budget', ": "] }), _jsx(Box, { borderStyle: "round", borderColor: "cyan", paddingX: 1, minWidth: 10, children: _jsxs(Text, { children: [isSessions ? '' : '$', inputText, _jsx(Text, { color: "cyan", children: "|" })] }) })] }), error ? (_jsx(Text, { color: "red", children: error })) : (_jsx(Text, { children: " " })), !isSessions && (_jsx(Text, { dimColor: true, children: "Takes effect next session" })), _jsx(Text, { dimColor: true, children: "Enter to confirm \u00B7 Esc to cancel" })] }));
}
//# sourceMappingURL=LimitOverlay.js.map