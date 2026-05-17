import { describe, it, expect } from "vitest";
import { buildUserMessage } from "@/supabase-functions/ai-agent-suggest/draftPrompt";

describe("agentDraftPrompt.buildUserMessage", () => {
  it("includes all client fields for intake trigger", () => {
    const msg = buildUserMessage({
      triggerType: "intake",
      client: { name: "Jane Doe", email: "jane@acme.com", company: "Acme" },
      deal: null,
      enrichment: null,
      recentActivity: [],
      stages: [],
    });
    expect(msg).toContain("TRIGGER: intake");
    expect(msg).toContain("Jane Doe");
    expect(msg).toContain("jane@acme.com");
    expect(msg).toContain("Acme");
  });

  it("renders enrichment as JSON block when present", () => {
    const msg = buildUserMessage({
      triggerType: "intake",
      client: { name: "Jane", email: "j@a.com", company: null },
      deal: null,
      enrichment: { title: "CMO", organization: { name: "Acme", employees: 200 } },
      recentActivity: [],
      stages: [],
    });
    expect(msg).toContain('"title": "CMO"');
    expect(msg).toContain('"employees": 200');
  });

  it("emits literal 'null' when enrichment is absent", () => {
    const msg = buildUserMessage({
      triggerType: "intake",
      client: { name: "Jane", email: "j@a.com", company: null },
      deal: null,
      enrichment: null,
      recentActivity: [],
      stages: [],
    });
    expect(msg).toMatch(/ENRICHMENT[^\n]*\n\s*null/);
  });

  it("includes deal block + days_in_stage for re_engagement", () => {
    const msg = buildUserMessage({
      triggerType: "re_engagement",
      client: { name: "Jane", email: "j@a.com", company: "Acme" },
      deal: {
        title: "Acme Pro",
        value: 25000,
        stageName: "Negotiation",
        daysInStage: 21,
        lastActivityAt: "2026-04-26T00:00:00Z",
      },
      enrichment: null,
      recentActivity: [],
      stages: [{ stageId: "s-1", name: "Closed Won" }],
    });
    expect(msg).toContain('DEAL: "Acme Pro"');
    expect(msg).toContain("£25000");
    expect(msg).toContain("21 days");
    expect(msg).toContain('"stageId": "s-1"');
  });

  it("formats recent activity bullets", () => {
    const msg = buildUserMessage({
      triggerType: "intake",
      client: { name: "Jane", email: "j@a.com", company: null },
      deal: null,
      enrichment: null,
      recentActivity: ["Stage moved to Discovery", "Note added: budget approved"],
      stages: [],
    });
    expect(msg).toContain("- Stage moved to Discovery");
    expect(msg).toContain("- Note added: budget approved");
  });
});
