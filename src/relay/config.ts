export interface RelayConfig {
  projectDir: string;
  initialTask: string;
  maxSessions: number;
  sessionBudget: number;
  model?: string;
  verbose?: boolean;
  skipPermissions?: boolean;
  allowedTools?: string[];
  maxSessionLogEntries: number;
}

export const DEFAULT_CONFIG: Partial<RelayConfig> = {
  maxSessions: 10,
  sessionBudget: 5,
  maxSessionLogEntries: 5,
};
