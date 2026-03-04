import { EventEmitter } from 'node:events';
import type { RelayConfig } from './config.js';
export interface RelayResult {
    sessionsRun: number;
    completed: boolean;
    reason: 'task_complete' | 'max_sessions' | 'error';
    totalCostUsd: number;
    totalDurationMs: number;
}
export declare class RelayLoop extends EventEmitter {
    private config;
    private state;
    private transitionResolver;
    private allToolEvents;
    private sessionErrors;
    private consecutiveFailures;
    private initialCommitHash;
    constructor(config: RelayConfig);
    /**
     * Called by the TUI when the user advances from the transition screen.
     * @param userInput Optional instructions to inject into the next session
     */
    resolveTransition(userInput?: string): void;
    /**
     * Dynamically update the max sessions limit. Takes effect on the next loop iteration.
     * Persists to disk so `cleave resume` picks it up.
     */
    updateMaxSessions(n: number): void;
    /**
     * Dynamically update the per-session budget. Takes effect on the next session spawn.
     * Persists to disk so `cleave resume` picks it up.
     */
    updateSessionBudget(n: number): void;
    private waitForTransition;
    private runDebrief;
    run(): Promise<RelayResult>;
}
