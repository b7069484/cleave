import { EventEmitter } from 'node:events';
export interface SessionConfig {
    projectDir: string;
    prompt: string;
    handoffInstructions: string;
    budget: number;
    model?: string;
    verbose?: boolean;
    skipPermissions?: boolean;
    allowedTools?: string[];
}
export interface SessionResult {
    exitCode: number;
    costUsd: number;
    totalCostUsd: number;
    durationMs: number;
    numTurns: number;
    toolUseCount: number;
    fullText: string;
    rateLimited: boolean;
    rateLimitResetAt?: number;
    sessionId: string;
    stderr: string;
}
export declare class SessionRunner extends EventEmitter {
    private config;
    private child;
    constructor(config: SessionConfig);
    run(): Promise<SessionResult>;
    kill(): void;
    private buildArgs;
}
