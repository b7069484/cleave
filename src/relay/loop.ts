import { EventEmitter } from 'node:events';
import { SessionRunner, type SessionResult } from './session.js';
import { CleaveState } from '../state/files.js';
import { detectHandoff, generateRescueHandoff } from './handoff.js';
import { buildSessionPrompt, buildHandoffInstructions } from './prompt-builder.js';
import { compactKnowledge } from '../state/knowledge.js';
import type { RelayConfig } from './config.js';
import type { ParsedEvent } from '../stream/types.js';

export interface RelayResult {
  sessionsRun: number;
  completed: boolean;
  reason: 'task_complete' | 'max_sessions' | 'error';
  totalCostUsd: number;
  totalDurationMs: number;
}

export class RelayLoop extends EventEmitter {
  private config: RelayConfig;
  private state: CleaveState;

  constructor(config: RelayConfig) {
    super();
    this.config = config;
    this.state = new CleaveState(config.projectDir);
  }

  async run(): Promise<RelayResult> {
    await this.state.init();

    let sessionsRun = 0;
    let totalCost = 0;
    let totalDuration = 0;

    for (let i = 1; i <= this.config.maxSessions; i++) {
      sessionsRun = i;
      await this.state.setSessionCount(i);
      await this.state.clearHandoffSignal();
      await this.state.markSessionStart();

      // Compact knowledge before each session
      const rawKnowledge = await this.state.readKnowledge();
      if (rawKnowledge.trim()) {
        const compacted = compactKnowledge(rawKnowledge, this.config.maxSessionLogEntries);
        await this.state.writeKnowledge(compacted);
      }

      // Build the prompt
      const prompt = buildSessionPrompt({
        sessionNum: i,
        maxSessions: this.config.maxSessions,
        initialTask: this.config.initialTask,
        nextPrompt: await this.state.readNextPrompt(),
        knowledge: await this.state.readKnowledge(),
        progress: await this.state.readProgress(),
      });

      this.emit('session_start', { sessionNum: i, maxSessions: this.config.maxSessions });

      // Run the session
      const runner = new SessionRunner({
        projectDir: this.config.projectDir,
        prompt,
        handoffInstructions: buildHandoffInstructions(this.config.projectDir),
        budget: this.config.sessionBudget,
        model: this.config.model,
        verbose: this.config.verbose,
        skipPermissions: this.config.skipPermissions,
        allowedTools: this.config.allowedTools,
      });

      // Forward events from session to relay
      runner.on('event', (event: ParsedEvent) => {
        this.emit('event', event);
      });

      let sessionResult: SessionResult;
      try {
        sessionResult = await runner.run();
      } catch (err) {
        this.emit('session_error', { sessionNum: i, error: err });
        await generateRescueHandoff(this.state, i, this.config.initialTask);
        continue;
      }

      totalCost += sessionResult.costUsd;
      totalDuration += sessionResult.durationMs;

      this.emit('session_end', {
        sessionNum: i,
        result: sessionResult,
        totalCost,
      });

      // Archive session files
      await this.state.archiveSession(i);

      // Check for handoff
      const handoff = await detectHandoff(this.state);

      if (handoff === 'complete') {
        return {
          sessionsRun,
          completed: true,
          reason: 'task_complete',
          totalCostUsd: totalCost,
          totalDurationMs: totalDuration,
        };
      }

      if (handoff === 'handoff') {
        // Chain to next session
        continue;
      }

      // No handoff signal — generate rescue
      this.emit('rescue', { sessionNum: i });
      await generateRescueHandoff(this.state, i, this.config.initialTask);
    }

    return {
      sessionsRun,
      completed: false,
      reason: 'max_sessions',
      totalCostUsd: totalCost,
      totalDurationMs: totalDuration,
    };
  }
}
