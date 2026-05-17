// Test stub for the Anthropic SDK URL import in edge function code.
// Node-based vitest cannot resolve `https://esm.sh/...`; this stub is aliased
// in via vitest.config.ts so the module loads. The real SDK is only used at
// runtime in Deno.
export default class Anthropic {
  // deno-lint-ignore no-explicit-any
  constructor(_opts: { apiKey: string }) {}
  messages = {
    // deno-lint-ignore no-explicit-any
    create: async (_args: any) => ({
      content: [{ type: "text", text: "" }],
      usage: { input_tokens: 0, output_tokens: 0 },
    }),
  };
}
