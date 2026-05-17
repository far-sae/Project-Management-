import { describe, it, expect } from "vitest";
import { matchesSlackTrigger } from "@/supabase-functions/crm-run-automations/triggers/slackMatch";

describe("matchesSlackTrigger", () => {
  it("returns false when channels list is empty", () => {
    expect(matchesSlackTrigger({ channels: [] }, { channel_id: "C1" })).toBe(false);
    expect(matchesSlackTrigger({}, { channel_id: "C1" })).toBe(false);
  });

  it("returns false when channel_id is not whitelisted", () => {
    expect(matchesSlackTrigger({ channels: ["C1", "C2"] }, { channel_id: "C9" })).toBe(false);
  });

  it("returns true when channel matches and no keyword set", () => {
    expect(matchesSlackTrigger({ channels: ["C1"] }, { channel_id: "C1", text: "anything" })).toBe(true);
  });

  it("matches plain-text keyword case-insensitively", () => {
    const cfg = { channels: ["C1"], keyword: "TASK:" };
    expect(matchesSlackTrigger(cfg, { channel_id: "C1", text: "task: follow up" })).toBe(true);
    expect(matchesSlackTrigger(cfg, { channel_id: "C1", text: "lol nothing here" })).toBe(false);
  });

  it("matches /regex/flags syntax", () => {
    const cfg = { channels: ["C1"], keyword: "/^(todo|task):/i" };
    expect(matchesSlackTrigger(cfg, { channel_id: "C1", text: "TODO: ship it" })).toBe(true);
    expect(matchesSlackTrigger(cfg, { channel_id: "C1", text: "task: x" })).toBe(true);
    expect(matchesSlackTrigger(cfg, { channel_id: "C1", text: "later" })).toBe(false);
  });

  it("returns false on invalid regex (defensive)", () => {
    const cfg = { channels: ["C1"], keyword: "/(unclosed/" };
    expect(matchesSlackTrigger(cfg, { channel_id: "C1", text: "anything" })).toBe(false);
  });
});
