import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Box, Text } from 'ink';
function summarizeInput(name, input) {
    switch (name) {
        case 'Read':
            return String(input.file_path ?? '');
        case 'Edit':
            return String(input.file_path ?? '');
        case 'Write':
            return String(input.file_path ?? '');
        case 'Bash':
            return String(input.command ?? '').slice(0, 80);
        case 'Glob':
            return String(input.pattern ?? '');
        case 'Grep':
            return String(input.pattern ?? '');
        case 'Agent': {
            const type = String(input.subagent_type ?? 'unknown');
            const desc = String(input.description ?? '');
            return `${type}: ${desc}`.slice(0, 80);
        }
        case 'TaskCreate':
            return String(input.subject ?? '');
        default:
            return Object.keys(input).join(', ');
    }
}
const TOOL_COLORS = {
    Read: 'blue',
    Edit: 'yellow',
    Write: 'green',
    Bash: 'magenta',
    Agent: 'cyan',
    Glob: 'blue',
    Grep: 'blue',
    TaskCreate: 'green',
    TaskUpdate: 'green',
};
export function ToolCard({ tool }) {
    const color = TOOL_COLORS[tool.name] ?? 'white';
    const summary = summarizeInput(tool.name, tool.input);
    return (_jsxs(Box, { borderStyle: "round", borderColor: color, paddingX: 1, marginY: 0, children: [_jsx(Text, { bold: true, color: color, children: tool.name }), _jsxs(Text, { dimColor: true, children: [" ", summary] })] }));
}
//# sourceMappingURL=ToolCard.js.map