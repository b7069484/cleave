import type { ParsedToolStart } from '../stream/types.js';
export interface DebriefContext {
    sessionsRun: number;
    totalCostUsd: number;
    totalDurationMs: number;
    toolStats: Record<string, number>;
    skills: string[];
    filesChanged: string[];
    errors: Array<{
        sessionNum: number;
        message: string;
    }>;
    finalProgress: string;
    finalKnowledge: string;
    projectDir: string;
}
export declare function collectToolStats(events: ParsedToolStart[]): {
    tools: Record<string, number>;
    skills: string[];
};
export declare function buildDebriefPrompt(ctx: DebriefContext): string;
