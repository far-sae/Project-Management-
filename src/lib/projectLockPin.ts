/** Reuse the same hash as task PIN; salt includes project id so hashes do not match task rows. */
export { hashLockPin } from '@/lib/taskLockPin';

const sessionKey = (projectId: string) => `project-lock-unlock:${projectId}`;

export function isProjectLockUnlockedInSession(projectId: string): boolean {
  try {
    return sessionStorage.getItem(sessionKey(projectId)) === '1';
  } catch {
    return false;
  }
}

export function setProjectLockUnlockedInSession(projectId: string): void {
  try {
    sessionStorage.setItem(sessionKey(projectId), '1');
  } catch {
    /* ignore */
  }
}

export function clearProjectLockUnlockedInSession(projectId: string): void {
  try {
    sessionStorage.removeItem(sessionKey(projectId));
  } catch {
    /* ignore */
  }
}
