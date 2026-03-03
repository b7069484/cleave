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
  remoteControl?: boolean;
}

export const DEFAULT_CONFIG: Partial<RelayConfig> = {
  maxSessions: 15,
  sessionBudget: 5,
  mode: 'guided',
  maxSessionLogEntries: 5,
  remoteControl: false,
};
