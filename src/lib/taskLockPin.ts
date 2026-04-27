/** Session flag so collaborators can edit after entering the task PIN (client-side guard). */
const sessionKey = (taskId: string) => `task-lock-unlock:${taskId}`;

export async function hashLockPin(pin: string, taskId: string): Promise<string> {
  const enc = new TextEncoder();
  const data = enc.encode(`${pin.trim()}\n${taskId}`);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function isTaskLockUnlockedInSession(taskId: string): boolean {
  try {
    return sessionStorage.getItem(sessionKey(taskId)) === '1';
  } catch {
    return false;
  }
}

export function setTaskLockUnlockedInSession(taskId: string): void {
  try {
    sessionStorage.setItem(sessionKey(taskId), '1');
  } catch {
    /* ignore */
  }
}

export function clearTaskLockUnlockedInSession(taskId: string): void {
  try {
    sessionStorage.removeItem(sessionKey(taskId));
  } catch {
    /* ignore */
  }
}
