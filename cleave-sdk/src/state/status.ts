/**
 * Machine-readable status.json management.
 */

import * as fs from 'fs';
import { CleaveConfig, VERSION } from '../config';

export type SessionStatus =
  | 'running'
  | 'paused'
  | 'complete'
  | 'verified_complete'
  | 'stuck'
  | 'max_sessions'
  | 'error';

export interface StatusFile {
  tool: 'cleave';
  version: string;
  session: number;
  max_sessions: number;
  status: SessionStatus;
  message: string;
  updated_at: string;
  work_dir: string;
  completion_marker: string;
}

/**
 * Write the status.json file.
 */
export function writeStatus(
  statusPath: string,
  config: CleaveConfig,
  sessionNum: number,
  status: SessionStatus,
  message: string
): void {
  const statusObj: StatusFile = {
    tool: 'cleave',
    version: VERSION,
    session: sessionNum,
    max_sessions: config.maxSessions,
    status,
    message,
    updated_at: new Date().toISOString(),
    work_dir: config.workDir,
    completion_marker: config.completionMarker,
  };

  fs.writeFileSync(statusPath, JSON.stringify(statusObj, null, 2) + '\n');
}
