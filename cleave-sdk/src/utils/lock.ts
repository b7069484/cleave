/**
 * File-based mutex lock to prevent concurrent cleave runs.
 */

import * as fs from 'fs';
import * as path from 'path';

export class FileLock {
  private lockPath: string;
  private acquired = false;

  constructor(relayDir: string) {
    this.lockPath = path.join(relayDir, '.lock');
  }

  acquire(): boolean {
    // Check if another process holds the lock
    if (fs.existsSync(this.lockPath)) {
      try {
        const pidStr = fs.readFileSync(this.lockPath, 'utf8').trim();
        const pid = parseInt(pidStr, 10);
        if (!isNaN(pid)) {
          try {
            // Check if process is alive (signal 0 = check existence)
            process.kill(pid, 0);
            // Process is alive — lock is held
            return false;
          } catch {
            // Process is dead — stale lock, we can take it
          }
        }
      } catch {
        // Can't read lock file — treat as stale
      }
    }

    // Write our PID
    fs.writeFileSync(this.lockPath, String(process.pid));
    this.acquired = true;
    return true;
  }

  release() {
    if (this.acquired && fs.existsSync(this.lockPath)) {
      try {
        fs.unlinkSync(this.lockPath);
      } catch {
        // Best effort
      }
      this.acquired = false;
    }
  }
}
