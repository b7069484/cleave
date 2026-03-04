import React, { useMemo } from 'react';
import { Box, Text } from 'ink';
import { ToolCard } from './ToolCard.js';
import type { ParsedEvent, ParsedToolStart } from '../stream/types.js';

interface StreamViewProps {
  events: ParsedEvent[];
  maxVisible?: number;
}

export function StreamView({ events, maxVisible = 50 }: StreamViewProps) {
  // Only render the last N events for performance
  const visibleEvents = useMemo(() => {
    return events.slice(-maxVisible);
  }, [events, maxVisible]);

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1}>
      {visibleEvents.map((event, i) => {
        const key = events.length - visibleEvents.length + i;
        switch (event.kind) {
          case 'text':
            return <Text key={key}>{event.text}</Text>;
          case 'tool_start':
            return <ToolCard key={key} tool={event as ParsedToolStart} />;
          case 'error':
            return (
              <Box key={key} borderStyle="round" borderColor="red" paddingX={1}>
                <Text color="red" bold>Error: </Text>
                <Text>{event.message}</Text>
              </Box>
            );
          case 'rate_limit':
            if (!event.blocked) return null;
            return (
              <Box key={key} borderStyle="round" borderColor="red" paddingX={1}>
                <Text color="red" bold>Rate limited</Text>
                <Text dimColor> — resets at {new Date(event.resetsAt).toLocaleTimeString()}</Text>
              </Box>
            );
          default:
            return null;
        }
      })}
    </Box>
  );
}
