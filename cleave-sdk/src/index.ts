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

async function main() {
  const config = parseArgs(process.argv);

  try {
    if (config.isPipeline) {
      await runPipelineLoop(config);
    } else {
      await runRelayLoop(config);
    }
  } catch (err: any) {
    console.error(`\nFatal error: ${err.message}`);
    if (err.stack && process.argv.includes('-v')) {
      console.error(err.stack);
    }
    process.exit(1);
  }
}

main();
