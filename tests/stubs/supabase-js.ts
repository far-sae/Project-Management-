// Test stub for the Supabase JS URL import in edge function code.
// Node-based vitest cannot resolve `https://esm.sh/...`; this stub is aliased
// in via vitest.config.ts so the module loads. The real SDK is only used at
// runtime in Deno.
// deno-lint-ignore no-explicit-any
export const createClient = (_url: string, _key: string, _opts?: any) => {
  // Minimal chainable stub — unit tests for pure helpers never invoke this.
  const chain: any = new Proxy(() => chain, {
    get: () => chain,
    apply: () => chain,
  });
  return chain;
};
