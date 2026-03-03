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
  private transitionResolver: ((userInput?: string) => void) | null = null;

  constructor(config: RelayConfig) {
    super();
    this.config = config;
    this.state = new CleaveState(config.projectDir);
  }

  /**
   * Called by the TUI when the user advances from the transition screen.
   * @param userInput Optional instructions to inject into the next session
   */
  resolveTransition(userInput?: string): void {
    if (this.transitionResolver) {
      this.transitionResolver(userInput);
      this.transitionResolver = null;
    }
  }

  private async waitForTransition(): Promise<string | undefined> {
    if (this.config.mode === 'auto' || this.config.mode === 'headless') {
      // Auto/headless: no pause, continue immediately
      return undefined;
    }

    // Guided mode: wait for TUI to call resolveTransition
    return new Promise<string | undefined>((resolve) => {
      this.transitionResolver = resolve;
    });
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

        // Emit transition and wait (in guided mode)
        this.emit('transition', { sessionNum: i, type: 'rescue' });
        const userInput = await this.waitForTransition();
        if (userInput) {
          const existing = await this.state.readNextPrompt();
          await this.state.writeNextPrompt(
            `## User Instructions\n${userInput}\n\n${existing}`
          );
        }
        continue;
      }

      totalCost += sessionResult.totalCostUsd || sessionResult.costUsd;
      totalDuration += sessionResult.durationMs;

      // Archive session files
      await this.state.archiveSession(i);

      // Check for handoff
      const handoff = await detectHandoff(this.state);

      if (handoff === 'complete') {
        this.emit('session_end', { sessionNum: i, result: sessionResult, totalCost });
        return {
          sessionsRun,
          completed: true,
          reason: 'task_complete',
          totalCostUsd: totalCost,
          totalDurationMs: totalDuration,
        };
      }

      if (handoff === 'handoff' || handoff === null) {
        if (handoff === null) {
          // No handoff signal — generate rescue
          this.emit('rescue', { sessionNum: i });
          await generateRescueHandoff(this.state, i, this.config.initialTask);
        }

        // Don't emit transition for the last session
        if (i < this.config.maxSessions) {
          this.emit('session_end', { sessionNum: i, result: sessionResult, totalCost });

          // Wait for transition (guided mode pauses here)
          const userInput = await this.waitForTransition();
          if (userInput) {
            const existing = await this.state.readNextPrompt();
            await this.state.writeNextPrompt(
              `## User Instructions\n${userInput}\n\n${existing}`
            );
          }
        }
      }
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
