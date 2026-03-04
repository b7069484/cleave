import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Box, Text, Static } from 'ink';
import { ToolCard } from './ToolCard.js';
export function StreamView({ events }) {
    return (_jsx(Box, { flexDirection: "column", flexGrow: 1, paddingX: 1, children: _jsx(Static, { items: events.map((e, i) => ({ ...e, key: i })), children: (event) => {
                switch (event.kind) {
                    case 'text':
                        return _jsx(Text, { children: event.text }, event.key);
                    case 'tool_start':
                        return _jsx(ToolCard, { tool: event }, event.key);
                    case 'error':
                        return (_jsxs(Box, { borderStyle: "round", borderColor: "red", paddingX: 1, children: [_jsx(Text, { color: "red", bold: true, children: "Error: " }), _jsx(Text, { children: event.message })] }, event.key));
                    case 'rate_limit':
                        if (!event.blocked)
                            return null; // Skip warnings, only show actual blocks
                        return (_jsxs(Box, { borderStyle: "round", borderColor: "red", paddingX: 1, children: [_jsx(Text, { color: "red", bold: true, children: "Rate limited" }), _jsxs(Text, { dimColor: true, children: [" \u2014 resets at ", new Date(event.resetsAt).toLocaleTimeString()] })] }, event.key));
                    default:
                        return null;
                }
            } }) }));
}
//# sourceMappingURL=StreamView.js.map