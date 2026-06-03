import { describe, it, expect } from "vitest";
import { visibleProviders } from "@/services/integrations/providers";

describe("visibleProviders", () => {
  it("hides gmail when the gmail flag is off", () => {
    const out = visibleProviders(["google", "gmail", "slack"], { gmail: false });
    expect(out).toEqual(["google", "slack"]);
  });
  it("keeps gmail when the gmail flag is on", () => {
    const out = visibleProviders(["google", "gmail", "slack"], { gmail: true });
    expect(out).toEqual(["google", "gmail", "slack"]);
  });
  it("never touches non-gmail providers", () => {
    const out = visibleProviders(["google", "slack"], { gmail: false });
    expect(out).toEqual(["google", "slack"]);
  });
});
