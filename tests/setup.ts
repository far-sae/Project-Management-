// Shim the Deno global so edge-function modules using `Deno.env.get(...)` can
// load under Node-based vitest. Real values are only needed at runtime; tests
// of pure helpers don't care, and any value we return is safe for module init.
// deno-lint-ignore no-explicit-any
(globalThis as any).Deno = (globalThis as any).Deno ?? {
  env: {
    get: (_key: string): string | undefined => undefined,
  },
  // Stub so edge-function modules that call `Deno.serve(handler)` at module
  // top-level load without throwing under Node vitest. We never actually
  // invoke the handler in unit tests.
  serve: (_handler: unknown): void => undefined,
};

// jsdom has no layout, so it does not implement scrollIntoView. Radix's
// drop-downs call it when they open on an already-chosen value; without this
// stand-in the open throws and the list never becomes usable in a test.
if (typeof Element !== 'undefined' && typeof Element.prototype.scrollIntoView !== 'function') {
  Element.prototype.scrollIntoView = () => undefined;
}

// Set-up messages (which database file to run, which setting is missing) are
// shown only to the people who run the site. Most tests check exactly those
// messages, so they look at the app as that person. A test about what
// everybody else reads calls setInternalsVisible(false) itself.
import { setInternalsVisible } from '../src/lib/publicError';

setInternalsVisible(true);
