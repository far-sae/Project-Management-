import { describe, it, expect } from "vitest";
import { mapSuggestion, mapDraft } from "@/services/supabase/agentSuggestions";

describe("agentSuggestions.mapSuggestion", () => {
  it("maps a row with full draft + enrichment", () => {
    const row = {
      id: "s-1",
      organization_id: "o-1",
      trigger_type: "intake",
      client_id: "c-1",
      deal_id: null,
      draft: {
        subject: "Hi",
        body_text: "body",
        body_html: "<p>body</p>",
        confidence: 0.8,
        reasoning: "fits ICP",
      },
      enrichment_snapshot: { title: "CMO" },
      confidence: 0.8,
      reasoning: "fits ICP",
      status: "pending",
      created_at: "2026-05-17T00:00:00Z",
    };
    const s = mapSuggestion(row);
    expect(s.suggestionId).toBe("s-1");
    expect(s.triggerType).toBe("intake");
    expect(s.draft.subject).toBe("Hi");
    expect(s.confidence).toBe(0.8);
    expect(s.enrichment?.title).toBe("CMO");
  });

  it("mapDraft tolerates missing fields", () => {
    const d = mapDraft({});
    expect(d.subject).toBe("");
    expect(d.bodyText).toBe("");
    expect(d.bodyHtml).toBe("");
    expect(d.confidence).toBe(0);
    expect(d.suggestedNextStageId).toBeNull();
  });
});
