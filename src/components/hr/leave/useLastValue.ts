import { useRef } from 'react';

/**
 * The last non-null value. A dialog keeps showing what it was opened for
 * while it fades out, after its target has been cleared.
 */
export function useLastValue<T>(value: T | null): T | null {
  const last = useRef(value);
  if (value !== null) last.current = value;
  return last.current;
}
