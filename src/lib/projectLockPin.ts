/** Reuse the same hash as task PIN; salt includes project id so hashes do not match task rows. */
export { hashLockPin } from '@/lib/taskLockPin';

const sessionKey = (projectId: string, lockPinVersion: number) =>
  `project-lock-unlock:${projectId}:${lockPinVersion}`;

/** Session unlock is scoped to `lockPinVersion` so rotating the PIN invalidates prior unlocks. */
export function isProjectLockUnlockedInSession(
  projectId: string,
  lockPinVersion: number,
): boolean {
  try {
    return sessionStorage.getItem(sessionKey(projectId, lockPinVersion)) === '1';
  } catch {
    return false;
  }
}

export function setProjectLockUnlockedInSession(
  projectId: string,
  lockPinVersion: number,
): void {
  try {
    sessionStorage.setItem(sessionKey(projectId, lockPinVersion), '1');
  } catch {
    /* ignore */
  }
}

export function clearProjectLockUnlockedInSession(
  projectId: string,
  lockPinVersion: number,
): void {
  try {
    sessionStorage.removeItem(sessionKey(projectId, lockPinVersion));
  } catch {
    /* ignore */
  }
}
