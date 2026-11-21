import React from 'react';
import { NOT_ON_YET_MESSAGE } from '@/lib/publicError';
import { useInternalsVisible } from '@/hooks/useInternalsVisible';

/**
 * Words about how the site is set up (which file to run, which setting to add).
 * The people who run the site read them; everybody else reads one neutral
 * sentence, because none of it is theirs to act on.
 */
export const SetupHint: React.FC<{
  /** The set-up instructions. */
  children: React.ReactNode;
  /** What everybody else reads instead. */
  other?: React.ReactNode;
}> = ({ children, other = NOT_ON_YET_MESSAGE }) => (useInternalsVisible() ? <>{children}</> : <>{other}</>);
