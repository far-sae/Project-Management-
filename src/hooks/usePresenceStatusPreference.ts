import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'presenceStatusPreferenceV1';
const EVENT_NAME = 'app:presence-status-preference';

export type PresenceStatusPreference =
  | 'auto'
  | 'appear_offline'
  | 'dnd'
  | 'holiday';

const isValid = (v: string | null): v is PresenceStatusPreference =>
  v === 'auto' ||
  v === 'appear_offline' ||
  v === 'dnd' ||
  v === 'holiday';

const read = (): PresenceStatusPreference => {
  try {
    const s = window.localStorage.getItem(STORAGE_KEY);
    if (s && isValid(s)) return s;
  } catch {
    /* ignore */
  }
  return 'auto';
};

/**
 * How you appear in project presence: Auto (online when active tab, otherwise
 * offline), manual appear offline, Do not disturb, or Holiday.
 */
export const usePresenceStatusPreference = () => {
  const [preference, setPreferenceState] =
    useState<PresenceStatusPreference>(read);

  useEffect(() => {
    const onExt = () => setPreferenceState(read);
    window.addEventListener('storage', onExt);
    window.addEventListener(EVENT_NAME, onExt);
    return () => {
      window.removeEventListener('storage', onExt);
      window.removeEventListener(EVENT_NAME, onExt);
    };
  }, []);

  const setPreference = useCallback((next: PresenceStatusPreference) => {
    setPreferenceState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
    try {
      window.dispatchEvent(new Event(EVENT_NAME));
    } catch {
      /* ignore */
    }
  }, []);

  return { preference, setPreference };
};
