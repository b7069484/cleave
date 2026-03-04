interface HeaderProps {
    sessionNum: number;
    maxSessions: number;
    projectDir: string;
    elapsedMs: number;
    sessionCostUsd: number;
    totalCostUsd: number;
    budgetUsd: number;
    contextPercent: number;
}
export declare function Header({ sessionNum, maxSessions, projectDir, elapsedMs, sessionCostUsd, totalCostUsd, budgetUsd, contextPercent, }: HeaderProps): import("react/jsx-runtime").JSX.Element;
export {};
