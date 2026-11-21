import { toast } from 'sonner';
import { publicText } from '@/lib/publicError';

/**
 * A safety net under every error and warning pop-up in the app.
 *
 * Most pop-ups are given a sentence that already went through publicMessage().
 * This catches the rest: whatever text reaches toast.error() or
 * toast.warning() is checked once more, so a raw database or network error
 * cannot appear on screen even from code that forgot to check it.
 */

let installed = false;

export function installPublicToasts(): void {
  if (installed) return;
  installed = true;
  for (const kind of ['error', 'warning'] as const) {
    const original = toast[kind];
    toast[kind] = ((message: unknown, ...rest: unknown[]) =>
      (original as (...args: unknown[]) => unknown)(typeof message === 'string' ? publicText(message) : message, ...rest)) as typeof original;
  }
}
