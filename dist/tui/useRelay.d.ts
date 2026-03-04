import type { RelayConfig } from '../relay/config.js';
import type { ParsedEvent } from '../stream/types.js';
import type { LimitType } from './LimitOverlay.js';
export type RelayPhase = 'running' | 'transition' | 'complete' | 'debrief' | 'done' | 'error';
export interface RunningAgent {
    id: string;
    description: string;
    type: string;
    startedAt: number;
}
export interface RelayState {
    phase: RelayPhase;
    sessionNum: number;
    maxSessions: number;
    events: ParsedEvent[];
    sessionCostUsd: number;
    totalCostUsd: number;
    budgetUsd: number;
    contextPercent: number;
    elapsedMs: number;
    toolCount: number;
    knowledge: {
        insights: number;
        coreBytes: number;
        sessionBytes: number;
    };
    handoffsCompleted: number;
    runningAgents: RunningAgent[];
    progressSummary: string;
    error?: string;
    completed: boolean;
    totalSessions: number;
    overlayMode: LimitType | null;
}
export declare function useRelay(config: RelayConfig): {
    state: RelayState;
    advanceFromTransition: (userInput?: string) => void;
    openOverlay: (type: LimitType) => void;
    closeOverlay: () => void;
    updateMaxSessions: (n: number) => void;
    updateSessionBudget: (n: number) => void;
    quitRelay: () => void;
};
