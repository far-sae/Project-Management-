import { describe, it, expect } from "vitest";
import {
  TRIGGER_TYPES,
  ACTION_TYPES,
  validateRecipeDraft,
  summarizeRecipe,
} from "@/services/supabase/automations";

describe("automations service", () => {
  it("rejects empty name", () => {
    expect(() => validateRecipeDraft({
      name: "", enabled: true,
      trigger: { type: "deal_stage_entered", config: {} },
      conditions: [], actions: [{ type: "create_task", config: { title: "x" } }],
    })).toThrow();
  });

  it("rejects empty actions array", () => {
    expect(() => validateRecipeDraft({
      name: "x", enabled: true,
      trigger: { type: "deal_stage_entered", config: {} },
      conditions: [], actions: [],
    })).toThrow();
  });

  it("rejects unknown trigger type", () => {
    expect(() => validateRecipeDraft({
      name: "x", enabled: true,
      trigger: { type: "bogus" as any, config: {} },
      conditions: [], actions: [{ type: "create_task", config: { title: "x" } }],
    })).toThrow();
  });

  it("accepts a valid minimal recipe", () => {
    expect(() => validateRecipeDraft({
      name: "Won handoff", enabled: true,
      trigger: { type: "deal_stage_entered", config: { stage_id: "abc" } },
      conditions: [],
      actions: [{ type: "create_task", config: { title: "Kickoff", assignee: "deal_owner", due_in_days: 3 } }],
    })).not.toThrow();
  });

  it("summarizes a recipe into a sentence", () => {
    expect(summarizeRecipe({
      trigger_type: "deal_stage_entered",
      actions: [{ type: "create_task" }, { type: "slack_post" }],
    } as any)).toBe("When deal enters stage, then create task, post to Slack");
  });

  it("includes every registered trigger and action", () => {
    expect(TRIGGER_TYPES).toContain("deal_stage_entered");
    expect(TRIGGER_TYPES).toContain("scheduled");
    expect(ACTION_TYPES).toContain("create_task");
    expect(ACTION_TYPES).toContain("send_email");
  });
});
