// Shim the Deno global so edge-function modules using `Deno.env.get(...)` can
// load under Node-based vitest. Real values are only needed at runtime; tests
// of pure helpers don't care, and any value we return is safe for module init.
// deno-lint-ignore no-explicit-any
(globalThis as any).Deno = (globalThis as any).Deno ?? {
  env: {
    get: (_key: string): string | undefined => undefined,
  },
};
