import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Box, Text } from 'ink';
import { basename } from 'node:path';
function formatDuration(ms) {
    const totalSecs = Math.floor(ms / 1000);
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;
    return `${mins}m ${secs.toString().padStart(2, '0')}s`;
}
function contextBar(percent, width = 20) {
    const filled = Math.round((percent / 100) * width);
    const empty = width - filled;
    return '\u2588'.repeat(filled) + '\u2591'.repeat(empty);
}
export function Header({ sessionNum, maxSessions, projectDir, elapsedMs, sessionCostUsd, totalCostUsd, budgetUsd, contextPercent, }) {
    const dir = basename(projectDir);
    const barColor = contextPercent > 80 ? 'red' : contextPercent > 60 ? 'yellow' : 'green';
    return (_jsxs(Box, { flexDirection: "column", borderStyle: "single", borderColor: "cyan", paddingX: 1, children: [_jsxs(Box, { justifyContent: "space-between", children: [_jsx(Text, { bold: true, color: "cyan", children: "CLEAVE" }), _jsxs(Text, { children: ["Session ", _jsxs(Text, { bold: true, children: [sessionNum, "/", maxSessions] })] }), _jsxs(Text, { dimColor: true, children: ["~/", dir] }), _jsx(Text, { dimColor: true, children: formatDuration(elapsedMs) })] }), _jsxs(Box, { justifyContent: "space-between", children: [_jsxs(Text, { children: ["Context: ", _jsx(Text, { color: barColor, children: contextBar(contextPercent) }), ' ', _jsxs(Text, { bold: true, children: [contextPercent, "%"] })] }), _jsxs(Text, { children: ["Session: ", _jsxs(Text, { bold: true, color: sessionCostUsd > budgetUsd * 0.8 ? 'yellow' : 'green', children: ["$", sessionCostUsd.toFixed(2)] }), "/$", budgetUsd.toFixed(2), ' ', "Total: ", _jsxs(Text, { bold: true, children: ["$", totalCostUsd.toFixed(2)] })] })] })] }));
}
//# sourceMappingURL=Header.js.map