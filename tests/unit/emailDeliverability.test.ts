import { describe, it, expect } from "vitest";
import { isWithinSendWindow, describeSendWindow } from "@/lib/email/sendWindow";
import {
  remainingToday, isSendable, selectMailboxes, blockedReason,
  MAX_CONSECUTIVE_FAILURES, PER_MAILBOX_SLICE,
} from "@/lib/email/mailboxPool";
import { providerOf, classifySmtpError, friendlySmtpError } from "@/lib/email/smtpErrors";
import { interpretDomainAuth } from "@/lib/email/domainAuth";
import type { MailboxHealth, SendWindow } from "@/lib/email/types";

const win = (over: Partial<SendWindow> = {}): SendWindow => ({
  enabled: true, startHour: 8, endHour: 18,
  days: [1, 2, 3, 4, 5], timezone: "Europe/London", ...over,
});

// 2026-09-16 is a Wednesday.
const at = (iso: string) => new Date(iso);

describe("isWithinSendWindow", () => {
  it("is true inside the window on a working day", () => {
    expect(isWithinSendWindow(win(), at("2026-09-16T10:00:00Z"))).toBe(true);
  });
  it("is false before the start hour", () => {
    expect(isWithinSendWindow(win(), at("2026-09-16T06:00:00Z"))).toBe(false);
  });
  it("is false at and after the end hour", () => {
    expect(isWithinSendWindow(win(), at("2026-09-16T17:00:00Z"))).toBe(false);
  });
  it("is false on a day not in the list", () => {
    // 2026-09-19 is a Saturday.
    expect(isWithinSendWindow(win(), at("2026-09-19T10:00:00Z"))).toBe(false);
  });
  it("uses the window's timezone, not the host's", () => {
    // 21:00 UTC is 06:00 next day in Tokyo, outside 8-18 there.
    expect(isWithinSendWindow(win({ timezone: "Asia/Tokyo" }), at("2026-09-16T21:00:00Z")))
      .toBe(false);
    // 01:00 UTC is 10:00 in Tokyo, inside.
    expect(isWithinSendWindow(win({ timezone: "Asia/Tokyo" }), at("2026-09-16T01:00:00Z")))
      .toBe(true);
  });
  it("is always true when disabled", () => {
    expect(isWithinSendWindow(win({ enabled: false }), at("2026-09-19T03:00:00Z"))).toBe(true);
  });
});

describe("describeSendWindow", () => {
  it("names the hours, days and timezone", () => {
    const s = describeSendWindow(win());
    expect(s).toContain("08:00");
    expect(s).toContain("18:00");
    expect(s).toContain("Europe/London");
  });
});

const mb = (over: Partial<MailboxHealth> = {}): MailboxHealth => ({
  id: "m1", label: "Sales", fromEmail: "sales@acme.com",
  isActive: true, pausedReason: null, status: "active",
  consecutiveFailures: 0, lastSentAt: null,
  effectiveLimit: 20, sentToday: 0, ...over,
});

describe("remainingToday", () => {
  it("is the effective limit minus what has been sent", () => {
    expect(remainingToday(mb({ effectiveLimit: 20, sentToday: 8 }))).toBe(12);
  });
  it("never goes below zero", () => {
    expect(remainingToday(mb({ effectiveLimit: 5, sentToday: 9 }))).toBe(0);
  });
});

describe("isSendable", () => {
  it("accepts a healthy active mailbox with allowance left", () => {
    expect(isSendable(mb())).toBe(true);
  });
  it("rejects an inactive mailbox", () => {
    expect(isSendable(mb({ isActive: false }))).toBe(false);
  });
  it("rejects a paused mailbox", () => {
    expect(isSendable(mb({ pausedReason: "Authentication failed" }))).toBe(false);
  });
  it("rejects a mailbox whose status is error", () => {
    expect(isSendable(mb({ status: "error" }))).toBe(false);
  });
  it("rejects a mailbox at its effective limit", () => {
    expect(isSendable(mb({ effectiveLimit: 10, sentToday: 10 }))).toBe(false);
  });
  it("rejects a mailbox at the failure ceiling", () => {
    expect(isSendable(mb({ consecutiveFailures: MAX_CONSECUTIVE_FAILURES }))).toBe(false);
  });
});

describe("selectMailboxes", () => {
  it("orders least recently used first, nulls before dates", () => {
    const out = selectMailboxes([
      mb({ id: "b", lastSentAt: new Date("2026-09-16T09:00:00Z") }),
      mb({ id: "a", lastSentAt: null }),
      mb({ id: "c", lastSentAt: new Date("2026-09-16T08:00:00Z") }),
    ], 100);
    expect(out.map((x) => x.mailbox.id)).toEqual(["a", "c", "b"]);
  });
  it("gives each mailbox at most the per-mailbox slice", () => {
    const out = selectMailboxes([mb({ effectiveLimit: 100 })], 100);
    expect(out[0].take).toBe(PER_MAILBOX_SLICE);
  });
  it("never exceeds a mailbox's remaining allowance", () => {
    const out = selectMailboxes([mb({ effectiveLimit: 4, sentToday: 1 })], 100);
    expect(out[0].take).toBe(3);
  });
  it("stops once the budget is spent", () => {
    const out = selectMailboxes([mb({ id: "a" }), mb({ id: "b" })], 4);
    expect(out.reduce((n, x) => n + x.take, 0)).toBe(4);
  });
  it("excludes unsendable mailboxes", () => {
    const out = selectMailboxes([mb({ id: "a", isActive: false }), mb({ id: "b" })], 10);
    expect(out.map((x) => x.mailbox.id)).toEqual(["b"]);
  });
  it("returns nothing for an empty pool", () => {
    expect(selectMailboxes([], 10)).toEqual([]);
  });
});

describe("blockedReason", () => {
  it("explains an empty pool", () => {
    expect(blockedReason([])).toMatch(/no mailbox/i);
  });
  it("explains a paused pool", () => {
    expect(blockedReason([mb({ pausedReason: "Authentication failed" })])).toMatch(/paused/i);
  });
  it("explains an exhausted pool", () => {
    expect(blockedReason([mb({ effectiveLimit: 10, sentToday: 10 })])).toMatch(/allowance/i);
  });
  it("is null when something can send", () => {
    expect(blockedReason([mb()])).toBeNull();
  });
});

describe("providerOf", () => {
  it("recognises the common hosts", () => {
    expect(providerOf("smtp.zoho.eu")).toBe("zoho");
    expect(providerOf("smtp.ionos.co.uk")).toBe("ionos");
    expect(providerOf("smtp.gmail.com")).toBe("google");
    expect(providerOf("smtp.office365.com")).toBe("microsoft");
    expect(providerOf("mail.example.com")).toBe("other");
    expect(providerOf()).toBe("other");
  });
});

describe("classifySmtpError", () => {
  it("treats 5xx as permanent", () => {
    expect(classifySmtpError({ responseCode: 535 })).toBe("permanent");
  });
  it("treats recipient rejections as a hard bounce", () => {
    expect(classifySmtpError({ responseCode: 550 })).toBe("hard_bounce");
    expect(classifySmtpError({ responseCode: 553 })).toBe("hard_bounce");
  });
  it("treats 4xx as transient", () => {
    expect(classifySmtpError({ responseCode: 451 })).toBe("transient");
  });
  it("treats an unknown error as transient", () => {
    expect(classifySmtpError(new Error("socket hang up"))).toBe("transient");
  });
});

describe("friendlySmtpError", () => {
  it("tells a Google user to use an app password", () => {
    const s = friendlySmtpError({ code: "EAUTH" }, "smtp.gmail.com");
    expect(s).toMatch(/app password/i);
    expect(s).toMatch(/google/i);
  });
  it("tells a Microsoft user their tenant may block SMTP auth", () => {
    expect(friendlySmtpError({ responseCode: 535 }, "smtp.office365.com")).toMatch(/SMTP AUTH/i);
  });
  it("explains a connection failure in terms of ports", () => {
    const s = friendlySmtpError({ code: "ETIMEDOUT" }, "mail.example.com");
    expect(s).toMatch(/465/);
    expect(s).toMatch(/587/);
  });
  it("explains throttling", () => {
    expect(friendlySmtpError({ responseCode: 421 }, "smtp.zoho.eu")).toMatch(/throttl/i);
  });
  it("falls back to the raw message when it has nothing better", () => {
    expect(friendlySmtpError(new Error("weird failure"))).toContain("weird failure");
  });
});

const raw = (over: Partial<Parameters<typeof interpretDomainAuth>[0]> = {}) => ({
  domain: "acme.com",
  rootTxt: ["v=spf1 include:_spf.google.com ~all"],
  dmarcTxt: ["v=DMARC1; p=none"],
  mx: ["aspmx.l.google.com"],
  dkimSelectors: [{ selector: "zmail", records: ["v=DKIM1; k=rsa; p=AAAA"] }],
  ...over,
});

describe("interpretDomainAuth", () => {
  it("passes a fully configured domain", () => {
    const r = interpretDomainAuth(raw());
    expect(r.spf.ok).toBe(true);
    expect(r.dkim.ok).toBe(true);
    expect(r.dmarc.ok).toBe(true);
    expect(r.mx).toEqual(["aspmx.l.google.com"]);
  });
  it("flags a missing SPF record", () => {
    const r = interpretDomainAuth(raw({ rootTxt: [] }));
    expect(r.spf.ok).toBe(false);
    expect(r.spf.detail).toMatch(/no spf/i);
  });
  it("flags SPF that does not authorise the IONOS mail host", () => {
    const r = interpretDomainAuth(raw({
      rootTxt: ["v=spf1 include:_spf.google.com ~all"],
      mx: ["mx00.ionos.co.uk"],
    }));
    expect(r.spf.ok).toBe(false);
    expect(r.spf.detail).toMatch(/ionos/i);
  });
  it("flags a missing DKIM key", () => {
    const r = interpretDomainAuth(raw({ dkimSelectors: [] }));
    expect(r.dkim.ok).toBe(false);
    expect(r.dkim.detail).toMatch(/unsigned|no dkim/i);
  });
  it("flags a DKIM key that belongs to another platform", () => {
    const r = interpretDomainAuth(raw({
      dkimSelectors: [{ selector: "selector1", records: ["v=DKIM1; p=BBBB"] }],
    }));
    expect(r.dkim.ok).toBe(false);
    expect(r.dkim.detail).toMatch(/another provider/i);
  });
  it("flags a missing DMARC record", () => {
    const r = interpretDomainAuth(raw({ dmarcTxt: [] }));
    expect(r.dmarc.ok).toBe(false);
    expect(r.dmarc.detail).toMatch(/dmarc/i);
  });
});
