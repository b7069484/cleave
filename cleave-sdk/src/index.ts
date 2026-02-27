#!/usr/bin/env node
/**
 * cleave v5 — Infinite context for Claude Code (Agent SDK Edition)
 *
 * Chain sessions together automatically. Each session writes its own
 * continuation prompt. The SDK enforces handoff behavior through
 * programmatic hooks. Knowledge compounds across sessions.
 *
 * Now with staged pipelines — define multi-stage workflows in YAML.
 *
 * Usage:
 *   cleave run <prompt-file>
 *   cleave continue "new task"
 *   cleave pipeline <config.yaml>
 */

import { parseArgs } from './cli';
import { runRelayLoop } from './relay-loop';
import { runPipelineLoop } from './pipeline-loop';

// Catch unhandled errors so the pipeline doesn't silently die
process.on('uncaughtException', (err) => {
  console.error(`\n[CLEAVE FATAL] Uncaught exception: ${err.message}`);
  console.error(err.stack || '(no stack)');
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  console.error(`\n[CLEAVE FATAL] Unhandled promise rejection: ${reason}`);
  if (reason instanceof Error && reason.stack) console.error(reason.stack);
  process.exit(1);
});

async function main() {
  const config = parseArgs(process.argv);

  try {
    if (config.isPipeline) {
      await runPipelineLoop(config);
    } else {
      await runRelayLoop(config);
    }
  } catch (err: any) {
    console.error(`\n[CLEAVE FATAL] ${err.message}`);
    console.error(err.stack || '(no stack)');
    process.exit(1);
  }
}

main();
