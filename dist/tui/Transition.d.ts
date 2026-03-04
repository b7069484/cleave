import type { CleaveMode } from '../relay/config.js';
interface TransitionProps {
    sessionNum: number;
    maxSessions: number;
    contextPercent: number;
    costUsd: number;
    tasksCompleted: number;
    tasksTotal: number;
    knowledgePromoted: number;
    onComplete: (userInput?: string) => void;
    mode: CleaveMode;
    delayMs?: number;
}
export declare function Transition({ sessionNum, maxSessions, contextPercent, costUsd, tasksCompleted, tasksTotal, knowledgePromoted, onComplete, mode, delayMs, }: TransitionProps): import("react/jsx-runtime").JSX.Element;
export {};
