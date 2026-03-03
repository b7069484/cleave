import React from 'react';
import { Box, Text, Static } from 'ink';
import { ToolCard } from './ToolCard.js';
import type { ParsedEvent, ParsedToolStart } from '../stream/types.js';

interface StreamViewProps {
  events: ParsedEvent[];
}

export function StreamView({ events }: StreamViewProps) {
  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1}>
      <Static items={events.map((e, i) => ({ ...e, key: i }))}>
        {(event) => {
          switch (event.kind) {
            case 'text':
              return <Text key={event.key}>{event.text}</Text>;
            case 'tool_start':
              return <ToolCard key={event.key} tool={event as ParsedToolStart} />;
            case 'error':
              return (
                <Box key={event.key} borderStyle="round" borderColor="red" paddingX={1}>
                  <Text color="red" bold>Error: </Text>
                  <Text>{event.message}</Text>
                </Box>
              );
            case 'rate_limit':
              if (!event.blocked) return null;  // Skip warnings, only show actual blocks
              return (
                <Box key={event.key} borderStyle="round" borderColor="red" paddingX={1}>
                  <Text color="red" bold>Rate limited</Text>
                  <Text dimColor> — resets at {new Date(event.resetsAt).toLocaleTimeString()}</Text>
                </Box>
              );
            default:
              return null;
          }
        }}
      </Static>
    </Box>
  );
}
