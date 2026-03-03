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

  /**
   * Dynamically update the max sessions limit. Takes effect on the next loop iteration.
   * Persists to disk so `cleave resume` picks it up.
   */
  updateMaxSessions(n: number): void {
    this.config.maxSessions = n;
    this.state.setMaxSessions(n);
    this.emit('config_change', { maxSessions: n, sessionBudget: this.config.sessionBudget });
  }

  /**
   * Dynamically update the per-session budget. Takes effect on the next session spawn.
   * Persists to disk so `cleave resume` picks it up.
   */
  updateSessionBudget(n: number): void {
    this.config.sessionBudget = n;
    this.state.setSessionBudget(n);
    this.emit('config_change', { maxSessions: this.config.maxSessions, sessionBudget: n });
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

    // Outer loop allows continuation after max sessions or completion
    while (true) {
      while (sessionsRun < this.config.maxSessions) {
        sessionsRun++;
        const i = sessionsRun;
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
          remoteControl: this.config.remoteControl,
        });

        // Forward events from session to relay
        runner.on('event', (event: ParsedEvent) => {
          this.emit('event', event);
        });

        runner.on('remote_url', (url: string) => {
          this.emit('remote_url', url);
        });

        this.emit('session_start', { sessionNum: i, maxSessions: this.config.maxSessions });

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

          // In auto/headless mode, return immediately (no pause)
          if (this.config.mode === 'auto' || this.config.mode === 'headless') {
            return {
              sessionsRun,
              completed: true,
              reason: 'task_complete',
              totalCostUsd: totalCost,
              totalDurationMs: totalDuration,
            };
          }

          // Guided mode: emit completion and wait for user decision
          this.emit('completion', {
            reason: 'task_complete',
            sessionsRun,
            totalCostUsd: totalCost,
            totalDurationMs: totalDuration,
          });

          const userInput = await this.waitForTransition();
          if (!userInput) {
            // User chose to quit
            return {
              sessionsRun,
              completed: true,
              reason: 'task_complete',
              totalCostUsd: totalCost,
              totalDurationMs: totalDuration,
            };
          }

          // User provided follow-up — inject and continue
          await this.state.clearHandoffSignal();
          await this.state.writeNextPrompt(`## User Instructions\n${userInput}`);
          if (sessionsRun >= this.config.maxSessions) {
            this.updateMaxSessions(this.config.maxSessions + 1);
          }
          continue;
        }

        if (handoff === 'handoff' || handoff === null) {
          if (handoff === null) {
            // No handoff signal — generate rescue
            this.emit('rescue', { sessionNum: i });
            await generateRescueHandoff(this.state, i, this.config.initialTask);
          }

          // Don't emit transition for the last session (handled by outer loop)
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

      // Max sessions reached
      // In auto/headless mode, return immediately
      if (this.config.mode === 'auto' || this.config.mode === 'headless') {
        return {
          sessionsRun,
          completed: false,
          reason: 'max_sessions',
          totalCostUsd: totalCost,
          totalDurationMs: totalDuration,
        };
      }

      // Guided mode: emit completion and wait for user decision
      this.emit('completion', {
        reason: 'max_sessions',
        sessionsRun,
        totalCostUsd: totalCost,
        totalDurationMs: totalDuration,
      });

      const userInput = await this.waitForTransition();
      if (!userInput) {
        // User chose to quit
        return {
          sessionsRun,
          completed: false,
          reason: 'max_sessions',
          totalCostUsd: totalCost,
          totalDurationMs: totalDuration,
        };
      }

      // User provided follow-up — inject prompt and extend sessions
      await this.state.writeNextPrompt(`## User Instructions\n${userInput}`);
      if (sessionsRun >= this.config.maxSessions) {
        this.updateMaxSessions(this.config.maxSessions + 1);
      }
      // Continue outer loop — inner while will now have room
    }
  }
}
