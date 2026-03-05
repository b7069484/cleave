/**
 * Desktop notifications — macOS (osascript) and Linux (notify-send).
 */

import { execFileSync } from 'child_process';

/**
 * Sanitize a string for safe embedding in AppleScript/notification.
 */
function sanitize(str: string): string {
  return str
    .replace(/[\\"`$']/g, '')
    .replace(/\n/g, ' ')
    .slice(0, 200);
}

/**
 * Send a desktop notification.
 */
export function sendNotification(title: string, message: string): void {
  const safeTitle = sanitize(title);
  const safeMessage = sanitize(message);

  try {
    if (process.platform === 'darwin') {
      execFileSync('osascript', [
        '-e', `display notification "${safeMessage}" with title "${safeTitle}"`
      ], { stdio: 'pipe', timeout: 5000 });
    } else if (process.platform === 'linux') {
      execFileSync('notify-send', [safeTitle, safeMessage], {
        stdio: 'pipe',
        timeout: 5000,
      });
    }
  } catch {
    // Notifications are best-effort
  }
}
