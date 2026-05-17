import { describe, it, expect } from "vitest";
import {
  matchesSlackTrigger,
  matchesSlackReaction,
} from "@/supabase-functions/crm-run-automations/triggers/slackMatch";

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

  it("mention_only requires the bot user id to appear in the text", () => {
    const cfg = { channels: ["C1"], mention_only: true };
    const payload = { channel_id: "C1", text: "hi <@U0BOT> please follow up" };
    expect(matchesSlackTrigger(cfg, payload, { botUserId: "U0BOT" })).toBe(true);
    expect(matchesSlackTrigger(cfg, payload, { botUserId: "U0OTHER" })).toBe(false);
    expect(matchesSlackTrigger(cfg, { channel_id: "C1", text: "no mention" }, { botUserId: "U0BOT" })).toBe(false);
  });

  it("mention_only returns false when bot user id is unknown", () => {
    const cfg = { channels: ["C1"], mention_only: true };
    expect(matchesSlackTrigger(cfg, { channel_id: "C1", text: "<@U0BOT>" })).toBe(false);
  });

  it("mention_only is independent of keyword (both filters compose)", () => {
    const cfg = { channels: ["C1"], mention_only: true, keyword: "deploy" };
    const payload = (text: string) => ({ channel_id: "C1", text });
    expect(matchesSlackTrigger(cfg, payload("<@U0BOT> please deploy"), { botUserId: "U0BOT" })).toBe(true);
    expect(matchesSlackTrigger(cfg, payload("<@U0BOT> hi"), { botUserId: "U0BOT" })).toBe(false);
    expect(matchesSlackTrigger(cfg, payload("deploy now"), { botUserId: "U0BOT" })).toBe(false);
  });
});

describe("matchesSlackReaction", () => {
  it("returns false when no reactions configured", () => {
    expect(matchesSlackReaction({}, { reaction: "white_check_mark" })).toBe(false);
    expect(matchesSlackReaction({ reactions: [] }, { reaction: "white_check_mark" })).toBe(false);
  });

  it("matches when reaction name is in the list", () => {
    const cfg = { reactions: ["white_check_mark", "pushpin"] };
    expect(matchesSlackReaction(cfg, { reaction: "white_check_mark" })).toBe(true);
    expect(matchesSlackReaction(cfg, { reaction: "pushpin" })).toBe(true);
    expect(matchesSlackReaction(cfg, { reaction: "eyes" })).toBe(false);
  });

  it("strips colons + normalizes case", () => {
    const cfg = { reactions: [":White_Check_Mark:", "PUSHPIN"] };
    expect(matchesSlackReaction(cfg, { reaction: "white_check_mark" })).toBe(true);
    expect(matchesSlackReaction(cfg, { reaction: "PUSHPIN" })).toBe(true);
  });

  it("applies channel whitelist when set", () => {
    const cfg = { reactions: ["white_check_mark"], channels: ["C1", "C2"] };
    expect(matchesSlackReaction(cfg, { reaction: "white_check_mark", channel_id: "C1" })).toBe(true);
    expect(matchesSlackReaction(cfg, { reaction: "white_check_mark", channel_id: "C9" })).toBe(false);
  });

  it("empty channel list = any channel allowed", () => {
    const cfg = { reactions: ["white_check_mark"] };
    expect(matchesSlackReaction(cfg, { reaction: "white_check_mark", channel_id: "C9" })).toBe(true);
  });
});
