import { describe, it, expect } from "vitest";
// Note: substitute.ts lives in the deno-targeted Edge Function folder; the test
// imports it via a relative path. Vitest with TypeScript handles .ts imports.
import { substitute } from "../../supabase/functions/crm-run-automations/shared/substitute.ts";

describe("substitute", () => {
  it("replaces known placeholders", () => {
    expect(substitute("Hello {{client.name}}", { client: { name: "Acme" } } as any))
      .toBe("Hello Acme");
  });

  it("passes through unknown placeholders unchanged", () => {
    expect(substitute("{{not.a.thing}}", {} as any)).toBe("{{not.a.thing}}");
  });

  it("handles missing context paths gracefully", () => {
    expect(substitute("X {{deal.title}} Y", { deal: undefined } as any))
      .toBe("X {{deal.title}} Y");
  });

  it("supports actor and recipe placeholders", () => {
    expect(substitute("by {{actor}} for {{recipe.name}}",
      { actor: "Faraz", recipe: { name: "Won handoff" } } as any))
      .toBe("by Faraz for Won handoff");
  });
});

describe("substitute — ai.* keys", () => {
  it("resolves {{ai.output}} from aiOutputs", () => {
    expect(
      substitute("Drafted: {{ai.output}}", { aiOutputs: { ai_output: "Hello world" } } as any),
    ).toBe("Drafted: Hello world");
  });

  it("resolves {{ai.output_subject}} and {{ai.output_body}}", () => {
    const ctx = { aiOutputs: { ai_output_subject: "Re: Quote", ai_output_body: "Hi!" } } as any;
    expect(substitute("S:{{ai.output_subject}} B:{{ai.output_body}}", ctx))
      .toBe("S:Re: Quote B:Hi!");
  });

  it("passes through {{ai.foo}} when key is missing", () => {
    expect(substitute("{{ai.foo}}", { aiOutputs: {} } as any)).toBe("{{ai.foo}}");
  });

  it("does not require aiOutputs to be present", () => {
    expect(substitute("{{ai.output}}", {} as any)).toBe("{{ai.output}}");
  });
});
