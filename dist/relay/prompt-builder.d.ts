export declare function buildHandoffInstructions(projectDir: string): string;
export interface SessionPromptInput {
    sessionNum: number;
    maxSessions: number;
    initialTask: string;
    nextPrompt: string;
    knowledge: string;
    progress: string;
}
export declare function buildSessionPrompt(input: SessionPromptInput): string;
