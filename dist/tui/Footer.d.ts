import type { RunningAgent } from './useRelay.js';
interface FooterProps {
    knowledge: {
        insights: number;
        coreBytes: number;
        sessionBytes: number;
    };
    handoffsCompleted: number;
    maxHandoffs: number;
    runningAgents: RunningAgent[];
    sessionNum: number;
    maxSessions: number;
    sessionBudget: number;
}
export declare function Footer({ knowledge, handoffsCompleted, maxHandoffs, runningAgents, sessionNum, maxSessions, sessionBudget }: FooterProps): import("react/jsx-runtime").JSX.Element;
export {};
