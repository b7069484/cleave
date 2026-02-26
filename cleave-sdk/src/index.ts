#!/usr/bin/env node
/**
 * cleave v4 — Infinite context for Claude Code (Agent SDK Edition)
 *
 * Chain sessions together automatically. Each session writes its own
 * continuation prompt. The SDK enforces handoff behavior through
 * programmatic hooks. Knowledge compounds across sessions.
 *
 * Usage: cleave [options] <initial-prompt-file>
 */

import { parseArgs } from './cli';
import { runRelayLoop } from './relay-loop';

async function main() {
  const config = parseArgs(process.argv);

  try {
    await runRelayLoop(config);
  } catch (err: any) {
    console.error(`\nFatal error: ${err.message}`);
    if (err.stack && process.argv.includes('-v')) {
      console.error(err.stack);
    }
    process.exit(1);
  }
}

main();
