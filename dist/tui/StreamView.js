import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useMemo } from 'react';
import { Box, Text } from 'ink';
import { ToolCard } from './ToolCard.js';
export function StreamView({ events, maxVisible = 50 }) {
    // Only render the last N events for performance
    const visibleEvents = useMemo(() => {
        return events.slice(-maxVisible);
    }, [events, maxVisible]);
    return (_jsx(Box, { flexDirection: "column", flexGrow: 1, paddingX: 1, children: visibleEvents.map((event, i) => {
            const key = events.length - visibleEvents.length + i;
            switch (event.kind) {
                case 'text':
                    return _jsx(Text, { children: event.text }, key);
                case 'tool_start':
                    return _jsx(ToolCard, { tool: event }, key);
                case 'error':
                    return (_jsxs(Box, { borderStyle: "round", borderColor: "red", paddingX: 1, children: [_jsx(Text, { color: "red", bold: true, children: "Error: " }), _jsx(Text, { children: event.message })] }, key));
                case 'rate_limit':
                    if (!event.blocked)
                        return null;
                    return (_jsxs(Box, { borderStyle: "round", borderColor: "red", paddingX: 1, children: [_jsx(Text, { color: "red", bold: true, children: "Rate limited" }), _jsxs(Text, { dimColor: true, children: [" \u2014 resets at ", new Date(event.resetsAt).toLocaleTimeString()] })] }, key));
                default:
                    return null;
            }
        }) }));
}
//# sourceMappingURL=StreamView.js.map