/**
 * Desktop notifications — macOS (osascript) and Linux (notify-send).
 */

import { execSync } from 'child_process';

/**
 * Sanitize a string for safe embedding in shell commands.
 */
function sanitize(str: string): string {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/'/g, '')
    .replace(/\n/g, ' ')
    .replace(/`/g, '')
    .replace(/\$/g, '');
}

/**
 * Send a desktop notification.
 */
export function sendNotification(title: string, message: string): void {
  const safeTitle = sanitize(title);
  const safeMessage = sanitize(message);

  try {
    if (process.platform === 'darwin') {
      execSync(
        `osascript -e 'display notification "${safeMessage}" with title "${safeTitle}"'`,
        { stdio: 'pipe', timeout: 5000 }
      );
    } else if (process.platform === 'linux') {
      execSync(`notify-send "${safeTitle}" "${safeMessage}"`, {
        stdio: 'pipe',
        timeout: 5000,
      });
    }
  } catch {
    // Notifications are best-effort
  }
}
