/**
 * Dev-only logger. No-op in production to avoid leaking info and console noise.
 */
const isDev = import.meta.env.DEV;

export const logger = {
  log: (...args: unknown[]) => {
    if (isDev) console.log(...args);
  },
  warn: (...args: unknown[]) => {
    if (isDev) console.warn(...args);
  },
  error: (...args: unknown[]) => {
    // Keep errors in production for critical failures (sanitized)
    console.error(...args);
  },
};
