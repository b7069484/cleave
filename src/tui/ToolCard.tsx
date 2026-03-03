import React from 'react';
import { Box, Text } from 'ink';
import type { ParsedToolStart } from '../stream/types.js';

interface ToolCardProps {
  tool: ParsedToolStart;
}

function summarizeInput(name: string, input: Record<string, unknown>): string {
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

const TOOL_COLORS: Record<string, string> = {
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

export function ToolCard({ tool }: ToolCardProps) {
  const color = TOOL_COLORS[tool.name] ?? 'white';
  const summary = summarizeInput(tool.name, tool.input);

  return (
    <Box borderStyle="round" borderColor={color} paddingX={1} marginY={0}>
      <Text bold color={color}>{tool.name}</Text>
      <Text dimColor> {summary}</Text>
    </Box>
  );
}
