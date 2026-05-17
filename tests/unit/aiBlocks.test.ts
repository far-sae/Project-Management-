import { describe, it, expect } from "vitest";
import {
  computeCostCents,
  parseClassifyResponse,
  parseDraftEmailResponse,
  parseExtractResponse,
} from "../../supabase/functions/crm-run-automations/actions/ai.ts";

describe("AI block — pure helpers", () => {
  describe("computeCostCents", () => {
    it("applies Sonnet 4.6 pricing (input 0.0003¢/tok, output 0.0015¢/tok)", () => {
      expect(computeCostCents(1000, 500)).toBeCloseTo(0.3 + 0.75, 4); // 1.05¢
    });
    it("handles zero tokens", () => {
      expect(computeCostCents(0, 0)).toBe(0);
    });
  });

  describe("parseClassifyResponse", () => {
    it("accepts hot/warm/cold case-insensitive with surrounding whitespace", () => {
      expect(parseClassifyResponse("Hot")).toBe("hot");
      expect(parseClassifyResponse("  warm  ")).toBe("warm");
      expect(parseClassifyResponse("COLD")).toBe("cold");
    });
    it("takes the first word when model adds prose", () => {
      expect(parseClassifyResponse("Hot — strong engagement signals")).toBe("hot");
    });
    it("returns null when no valid band found", () => {
      expect(parseClassifyResponse("I am unable to classify")).toBe(null);
      expect(parseClassifyResponse("")).toBe(null);
    });
  });

  describe("parseDraftEmailResponse", () => {
    it("splits on first blank line into subject + body", () => {
      const out = parseDraftEmailResponse("Re: Your quote\n\nHi Faraz,\n\nThanks!");
      expect(out.subject).toBe("Re: Your quote");
      expect(out.body).toBe("Hi Faraz,\n\nThanks!");
    });
    it("strips a leading 'Subject:' prefix if the model adds one", () => {
      const out = parseDraftEmailResponse("Subject: Hi there\n\nBody here");
      expect(out.subject).toBe("Hi there");
      expect(out.body).toBe("Body here");
    });
    it("falls back to empty subject and full text as body when no blank line", () => {
      const out = parseDraftEmailResponse("Just a body, no subject line.");
      expect(out.subject).toBe("");
      expect(out.body).toBe("Just a body, no subject line.");
    });
  });

  describe("parseExtractResponse", () => {
    it("parses a clean JSON object", () => {
      expect(parseExtractResponse('{"company_size":"50-100","intent":"buy"}'))
        .toEqual({ company_size: "50-100", intent: "buy" });
    });
    it("strips ```json fences if model adds them", () => {
      expect(parseExtractResponse('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    });
    it("returns null when JSON is malformed", () => {
      expect(parseExtractResponse("not json at all")).toBe(null);
      expect(parseExtractResponse('{"unterminated":')).toBe(null);
    });
  });
});
