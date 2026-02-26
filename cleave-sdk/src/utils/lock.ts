/**
 * File-based mutex lock using atomic exclusive create (O_EXCL).
 * Prevents concurrent cleave runs on the same work directory.
 */

import * as fs from 'fs';
import * as path from 'path';

export class FileLock {
  private lockPath: string;
  private acquired = false;

  constructor(relayDir: string) {
    this.lockPath = path.join(relayDir, '.lock');
  }

  /**
   * Attempt to acquire the lock atomically.
   * Uses O_CREAT | O_EXCL (fs.openSync 'wx') to prevent TOCTOU races.
   */
  acquire(): boolean {
    // First, check for stale locks from dead processes
    this.cleanStaleLock();

    try {
      // Atomic exclusive create — fails with EEXIST if file already exists
      const fd = fs.openSync(this.lockPath, 'wx');
      fs.writeSync(fd, String(process.pid));
      fs.closeSync(fd);
      this.acquired = true;
      return true;
    } catch (err: any) {
      if (err.code === 'EEXIST') {
        // Lock file exists — another process holds it (we already cleaned stale above)
        return false;
      }
      // Unexpected error (permission denied, disk full, etc.)
      throw new Error(`Failed to acquire lock: ${err.message}`);
    }
  }

  /**
   * Remove stale lock files left by dead processes.
   */
  private cleanStaleLock(): void {
    try {
      if (!fs.existsSync(this.lockPath)) return;
      const pidStr = fs.readFileSync(this.lockPath, 'utf8').trim();
      const pid = parseInt(pidStr, 10);
      if (isNaN(pid)) {
        // Corrupted lock file — remove it
        fs.unlinkSync(this.lockPath);
        return;
      }
      try {
        process.kill(pid, 0); // Check if process is alive
        // Process is alive — lock is valid, don't touch it
      } catch {
        // Process is dead — stale lock, safe to remove
        fs.unlinkSync(this.lockPath);
      }
    } catch {
      // Can't read/remove lock — will fail on acquire() instead
    }
  }

  release(): void {
    if (this.acquired) {
      try {
        // Verify it's still our lock before removing
        const pidStr = fs.readFileSync(this.lockPath, 'utf8').trim();
        if (pidStr === String(process.pid)) {
          fs.unlinkSync(this.lockPath);
        }
      } catch {
        // Best effort — file might already be gone
      }
      this.acquired = false;
    }
  }
}
