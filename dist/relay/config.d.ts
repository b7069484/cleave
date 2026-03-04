export type CleaveMode = 'guided' | 'auto' | 'headless';
export interface RelayConfig {
    projectDir: string;
    initialTask: string;
    maxSessions: number;
    sessionBudget: number;
    mode: CleaveMode;
    model?: string;
    verbose?: boolean;
    skipPermissions?: boolean;
    allowedTools?: string[];
    maxSessionLogEntries: number;
}
export declare const DEFAULT_CONFIG: Partial<RelayConfig>;
