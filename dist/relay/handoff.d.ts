import { CleaveState } from '../state/files.js';
export type HandoffResult = 'handoff' | 'complete' | null;
export declare function detectHandoff(state: CleaveState): Promise<HandoffResult>;
export declare function generateRescueHandoff(state: CleaveState, sessionNum: number, originalTask: string): Promise<void>;
