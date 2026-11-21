import { useSyncExternalStore } from 'react';
import { internalsAreVisible, onInternalsChange } from '@/lib/publicError';

/**
 * True when this person is shown how the site is set up (see lib/platform.ts).
 * Works on every page, also the public ones that have no organisation: there
 * it is simply false.
 */
export function useInternalsVisible(): boolean {
  return useSyncExternalStore(onInternalsChange, internalsAreVisible, () => false);
}
