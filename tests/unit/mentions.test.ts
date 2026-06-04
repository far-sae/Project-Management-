import { describe, it, expect } from "vitest";
import { extractMentions } from "@/services/agent/mentions";

const members = [
  { userId: "u1", name: "Sam Lee" }, { userId: "u2", name: "Priya" }, { userId: "u3", name: "Sam" },
];
describe("extractMentions", () => {
  it("matches @name tokens to members (longest name first), de-duped", () => {
    expect(extractMentions("hey @Sam Lee and @Priya", members).map((m) => m.userId)).toEqual(["u1", "u2"]);
  });
  it("matches a single-word @Sam to the exact single-word member", () => {
    expect(extractMentions("ping @Sam", members).map((m) => m.userId)).toEqual(["u3"]);
  });
  it("returns [] when nothing matches", () => {
    expect(extractMentions("no mentions here", members)).toEqual([]);
  });
});
