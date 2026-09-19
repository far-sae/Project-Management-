import { describe, it, expect } from "vitest";
import {
  FIRST_SCAN_LOOKBACK_MS, SCAN_OVERLAP_MS,
  scanWindow, normalizeAddress, matchReplies, looksLikeBounce, extractBouncedAddress,
} from "@/lib/email/inbox";
import { classifyImapError, friendlyImapError } from "@/lib/email/imapErrors";
import type { InboxEnvelope } from "@/lib/email/types";

const now = new Date("2026-09-19T12:00:00Z");
const env = (over: Partial<InboxEnvelope> = {}): InboxEnvelope => ({
  from: "ada@acme.com", subject: "Re: hello", at: now, ...over,
});

describe("scanWindow", () => {
  it("looks back one day on the first scan", () => {
    expect(scanWindow(null, now).getTime()).toBe(now.getTime() - FIRST_SCAN_LOOKBACK_MS);
  });
  it("starts a little before the last scan so nothing falls between scans", () => {
    const last = new Date("2026-09-19T11:50:00Z");
    expect(scanWindow(last, now).getTime()).toBe(last.getTime() - SCAN_OVERLAP_MS);
  });
  it("never returns a window wider than the first-scan floor", () => {
    const ancient = new Date("2020-01-01T00:00:00Z");
    expect(scanWindow(ancient, now).getTime()).toBe(now.getTime() - FIRST_SCAN_LOOKBACK_MS);
  });
  it("never returns a window in the future when the clock jumped backwards", () => {
    const future = new Date("2026-09-19T13:00:00Z");
    expect(scanWindow(future, now).getTime()).toBeLessThanOrEqual(now.getTime());
  });
});

describe("normalizeAddress", () => {
  it("trims and lowercases", () => {
    expect(normalizeAddress("  Ada@Acme.COM ")).toBe("ada@acme.com");
  });
  it("strips angle brackets and a display name", () => {
    expect(normalizeAddress('"Ada Lovelace" <Ada@Acme.com>')).toBe("ada@acme.com");
  });
  it("returns an empty string for junk", () => {
    expect(normalizeAddress("not an address")).toBe("");
  });
});

describe("matchReplies", () => {
  const sentTo = ["ada@acme.com", "bob@other.com"];
  it("matches a sender we mailed", () => {
    const out = matchReplies([env()], sentTo);
    expect(out.map((r) => r.address)).toEqual(["ada@acme.com"]);
  });
  it("ignores a sender we never mailed", () => {
    expect(matchReplies([env({ from: "stranger@nowhere.com" })], sentTo)).toEqual([]);
  });
  it("matches case-insensitively and through a display name", () => {
    const out = matchReplies([env({ from: "Ada <ADA@ACME.COM>" })], sentTo);
    expect(out.map((r) => r.address)).toEqual(["ada@acme.com"]);
  });
  it("counts a sender who replied twice once, keeping the earliest reply", () => {
    const early = new Date("2026-09-19T10:00:00Z");
    const late = new Date("2026-09-19T11:00:00Z");
    const out = matchReplies([env({ at: late }), env({ at: early })], sentTo);
    expect(out).toHaveLength(1);
    expect(out[0].at.getTime()).toBe(early.getTime());
  });
  it("returns nothing when we sent to nobody", () => {
    expect(matchReplies([env()], [])).toEqual([]);
  });
});

describe("looksLikeBounce", () => {
  it("recognises the usual notifier senders", () => {
    expect(looksLikeBounce(env({ from: "MAILER-DAEMON@acme.com" }))).toBe(true);
    expect(looksLikeBounce(env({ from: "postmaster@acme.com" }))).toBe(true);
  });
  it("recognises the usual subjects", () => {
    expect(looksLikeBounce(env({ from: "x@y.com", subject: "Undeliverable: hello" }))).toBe(true);
    expect(looksLikeBounce(env({ from: "x@y.com", subject: "Delivery Status Notification" }))).toBe(true);
    expect(looksLikeBounce(env({ from: "x@y.com", subject: "Returned mail: see below" }))).toBe(true);
  });
  it("leaves an ordinary reply alone", () => {
    expect(looksLikeBounce(env())).toBe(false);
  });
});

describe("extractBouncedAddress", () => {
  it("reads the standard Final-Recipient field", () => {
    const src = "Final-Recipient: rfc822; bob@other.com\r\nAction: failed\r\n";
    expect(extractBouncedAddress(src)).toBe("bob@other.com");
  });
  it("falls back to an inline failure line", () => {
    const src = "Your message to bob@other.com could not be delivered.";
    expect(extractBouncedAddress(src)).toBe("bob@other.com");
  });
  it("returns null when it finds nothing", () => {
    expect(extractBouncedAddress("nothing useful here")).toBeNull();
  });
  it("lowercases what it finds", () => {
    expect(extractBouncedAddress("Final-Recipient: rfc822; BOB@OTHER.COM")).toBe("bob@other.com");
  });
});

describe("classifyImapError", () => {
  it("recognises an authentication failure", () => {
    expect(classifyImapError({ authenticationFailed: true })).toBe("auth");
    expect(classifyImapError(new Error("Invalid credentials (AUTHENTICATIONFAILED)"))).toBe("auth");
  });
  it("recognises an unreachable server", () => {
    expect(classifyImapError({ code: "ETIMEDOUT" })).toBe("unreachable");
    expect(classifyImapError({ code: "ENOTFOUND" })).toBe("unreachable");
  });
  it("falls back to other", () => {
    expect(classifyImapError(new Error("something odd"))).toBe("other");
  });
});

describe("friendlyImapError", () => {
  it("tells a Zoho user to enable IMAP and use an app password", () => {
    const s = friendlyImapError({ authenticationFailed: true }, "imap.zoho.eu");
    expect(s).toMatch(/zoho/i);
    expect(s).toMatch(/app password/i);
  });
  it("mentions port 993 when the server is unreachable", () => {
    expect(friendlyImapError({ code: "ETIMEDOUT" }, "imap.acme.com")).toMatch(/993/);
  });
  it("falls back to the raw message", () => {
    expect(friendlyImapError(new Error("weird imap failure"))).toContain("weird imap failure");
  });
});
