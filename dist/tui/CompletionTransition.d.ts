interface CompletionTransitionProps {
    completed: boolean;
    sessionsRun: number;
    totalCostUsd: number;
    progressSummary: string;
    onContinue: (userInput: string) => void;
    onAddSessions: () => void;
    onQuit: () => void;
}
export declare function CompletionTransition({ completed, sessionsRun, totalCostUsd, progressSummary, onContinue, onAddSessions, onQuit, }: CompletionTransitionProps): import("react/jsx-runtime").JSX.Element;
export {};
