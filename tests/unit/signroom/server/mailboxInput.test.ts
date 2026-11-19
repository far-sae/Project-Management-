// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  EMAIL_PATTERN, InputError, MAILBOX_MESSAGES as M, parseSaveInput, passwordReusable, PRESETS, PROVIDER_IDS, validHostname,
} from "../../../../api/_signroom/mailbox/settings";

const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/186_signroom_more.sql"), "utf8").toLowerCase();

/** The message parseSaveInput refuses `body` with (a test failure if it accepts it). */
function refusal(body: unknown): string {
  try {
    parseSaveInput(body);
  } catch (e) {
    expect(e).toBeInstanceOf(InputError);
    return (e as Error).message;
  }
  throw new Error("parseSaveInput accepted it");
}

describe("mailbox presets", () => {
  it("are the spec's table", () => {
    expect(PRESETS).toEqual({
      gmail: { host: "smtp.gmail.com", port: 465, security: "tls" },
      outlook: { host: "smtp.office365.com", port: 587, security: "starttls" },
      ionos: { host: "smtp.ionos.co.uk", port: 465, security: "tls" },
      yahoo: { host: "smtp.mail.yahoo.com", port: 465, security: "tls" },
      zoho: { host: "smtp.zoho.eu", port: 465, security: "tls" },
      godaddy: { host: "smtpout.secureserver.net", port: 465, security: "tls" },
      hostinger: { host: "smtp.hostinger.com", port: 465, security: "tls" },
    });
  });

  it("plus custom are exactly the providers the migration allows, in its order", () => {
    expect(PROVIDER_IDS).toEqual([...Object.keys(PRESETS), "custom"]);
    expect(migration).toContain(`provider in (${PROVIDER_IDS.map((p) => `'${p}'`).join(", ")})`);
  });
});

describe("parseSaveInput", () => {
  it("forces a preset's server, port and security whatever the request says, and signs in with the address", () => {
    expect(parseSaveInput({ provider: "gmail", email: "you@acme.test", password: "pw", host: "evil.example.net", port: 2525, security: "starttls" })).toEqual({
      provider: "gmail", host: "smtp.gmail.com", port: 465, security: "tls", username: "you@acme.test", fromEmail: "you@acme.test", password: "pw",
    });
    expect(parseSaveInput({ provider: "outlook", email: "you@acme.test", password: "pw" })).toMatchObject({ host: "smtp.office365.com", port: 587, security: "starttls" });
  });

  it("trims the address, and keeps a different username when one is given", () => {
    expect(parseSaveInput({ provider: "ionos", email: "  You@Acme.test ", username: " billing-login ", password: "pw" })).toMatchObject({
      fromEmail: "You@Acme.test", username: "billing-login",
    });
    expect(parseSaveInput({ provider: "ionos", email: "you@acme.test", username: "   ", password: "pw" }).username).toBe("you@acme.test");
  });

  it("takes a Gmail or Yahoo app password without the spaces Google shows, and any other password exactly as typed", () => {
    expect(parseSaveInput({ provider: "gmail", email: "you@acme.test", password: "abcd efgh ijkl mnop" }).password).toBe("abcdefghijklmnop");
    expect(parseSaveInput({ provider: "yahoo", email: "you@acme.test", password: "abcd efgh ijkl mnop" }).password).toBe("abcdefghijklmnop");
    expect(parseSaveInput({ provider: "ionos", email: "you@acme.test", password: "abcd efgh ijkl mnop" }).password).toBe("abcd efgh ijkl mnop");
    expect(parseSaveInput({ provider: "gmail", email: "you@acme.test", password: " my pass word " }).password).toBe(" my pass word ");
  });

  it("reads a missing or empty password as 'keep the saved one'", () => {
    expect(parseSaveInput({ provider: "gmail", email: "you@acme.test" }).password).toBeNull();
    expect(parseSaveInput({ provider: "gmail", email: "you@acme.test", password: "" }).password).toBeNull();
  });

  it("refuses unknown providers, bad addresses, bad usernames, line breaks and over-long passwords", () => {
    expect(refusal({ provider: "aol", email: "you@acme.test", password: "pw" })).toBe(M.provider);
    expect(refusal(null)).toBe(M.provider);
    expect(refusal({ provider: "gmail", email: "you@acme", password: "pw" })).toBe(M.email);
    expect(refusal({ provider: "gmail", email: "a@x.test, b@y.test", password: "pw" })).toBe(M.email);
    expect(refusal({ provider: "gmail", email: `${"a".repeat(250)}@x.test`, password: "pw" })).toBe(M.email);
    // control characters the pattern's \s does not cover (BEL, ESC, DEL, NEL) would reach the From header
    for (const email of ["you\u0007@acme.test", "you@ac\u001bme.test", "you@acme.test\u007f", "you@acme.test\u0085"]) {
      expect(EMAIL_PATTERN.test(email)).toBe(true);
      expect(refusal({ provider: "gmail", email, password: "pw" })).toBe(M.email);
      expect(refusal({ provider: "gmail", email, username: "billing-login", password: "pw" })).toBe(M.email);
    }
    expect(refusal({ provider: "gmail", email: "you@acme.test", username: `${"u".repeat(255)}`, password: "pw" })).toBe(M.username);
    expect(refusal({ provider: "gmail", email: "you@acme.test", username: "a\u0007b", password: "pw" })).toBe(M.username);
    expect(refusal({ provider: "gmail", email: "you@acme.test", password: "line\r\nRCPT TO:<x@y.test>" })).toBe(M.passwordLineBreak);
    expect(refusal({ provider: "gmail", email: "you@acme.test", password: "x".repeat(257) })).toBe(M.passwordLong);
    expect(refusal({ provider: "gmail", email: "you@acme.test", password: 12345 })).toBe(M.password);
  });

  it("custom: lower-cases the server, and needs a public-looking name, one of the three ports and a security mode", () => {
    expect(parseSaveInput({ provider: "custom", email: "you@acme.test", password: "pw", host: " Mail.Acme-Hosting.co.uk. ", port: 587, security: "starttls" })).toMatchObject({
      host: "mail.acme-hosting.co.uk", port: 587, security: "starttls",
    });
    expect(parseSaveInput({ provider: "custom", email: "you@acme.test", password: "pw", host: "mail.acme-hosting.co.uk", port: "2525", security: "tls" }).port).toBe(2525);
    expect(refusal({ provider: "custom", email: "you@acme.test", password: "pw", host: "localhost", port: 465, security: "tls" })).toBe(M.host);
    expect(refusal({ provider: "custom", email: "you@acme.test", password: "pw", host: "10.0.0.5", port: 465, security: "tls" })).toBe(M.host);
    expect(refusal({ provider: "custom", email: "you@acme.test", password: "pw", host: "mail.acme-hosting.co.uk", port: 25, security: "tls" })).toBe(M.port);
    expect(refusal({ provider: "custom", email: "you@acme.test", password: "pw", host: "mail.acme-hosting.co.uk", port: 465, security: "ssl" })).toBe(M.security);
  });
});

describe("server names fit the database", () => {
  /** sr_mailboxes.host's CHECK in the migration. */
  const DB_HOST = /^[a-z0-9.-]+$/;

  it("the migration's CHECK is the one this test pins", () => {
    expect(migration).toContain("host ~ '^[a-z0-9.-]+$'");
  });

  it("every preset's server is a valid name the CHECK accepts", () => {
    for (const { host } of Object.values(PRESETS)) {
      expect(validHostname(host)).toBe(true);
      expect(host).toMatch(DB_HOST);
    }
  });

  it.each([
    ["SMTP.Example-Mail.NET", "smtp.example-mail.net"],
    ["  mail.acme-hosting.co.uk\t", "mail.acme-hosting.co.uk"],
    ["mail.acme-hosting.co.uk.", "mail.acme-hosting.co.uk"],
    [" MAIL.ACME-HOSTING.CO.UK.. ", "mail.acme-hosting.co.uk"],
  ])("a custom server %j is saved lower-case, trimmed and without the trailing dot", (typed, saved) => {
    const { host } = parseSaveInput({ provider: "custom", email: "you@acme.test", password: "pw", host: typed, port: 465, security: "tls" });
    expect(host).toBe(saved);
    expect(host).toMatch(DB_HOST);
  });

  it.each(["mail acme.co.uk", "mail.acme.co.uk/x", "mail.acme.co.uk:465", "mäil.acme.co.uk", ".", "", "   "])("refuses the custom server %j", (typed) => {
    expect(refusal({ provider: "custom", email: "you@acme.test", password: "pw", host: typed, port: 465, security: "tls" })).toBe(M.host);
  });
});

describe("validHostname", () => {
  it.each(["smtp.gmail.com", "mail.acme-hosting.co.uk", "smtp.zoho.eu", "a.b.c.example-mail.net"])("accepts %s", (host) => {
    expect(validHostname(host)).toBe(true);
  });

  it.each([
    "localhost", "mail.local", "smtp.internal", "printer.lan", "server.test", "smtp.example", "db.corp", "host.localdomain",
    "10.0.0.1", "169.254.169.254", "[::1]", "::1", "smtp", "-bad.com", "bad-.com", "a..b.com", "exa_mple.com", "SMTP.GMAIL.COM",
    `${"a".repeat(64)}.com`, `${"abcdefghi.".repeat(26)}com`,
  ])("refuses %s", (host) => {
    expect(validHostname(host)).toBe(false);
  });
});

describe("passwordReusable", () => {
  const stored = { host: "smtp.gmail.com", port: 465 as const, security: "tls" as const, username: "you@acme.test" };

  it("only when the server, port, security and username are all unchanged", () => {
    expect(passwordReusable({ ...stored }, stored)).toBe(true);
    expect(passwordReusable({ ...stored, host: "smtp.attacker.net" }, stored)).toBe(false);
    expect(passwordReusable({ ...stored, port: 587 }, stored)).toBe(false);
    expect(passwordReusable({ ...stored, security: "starttls" }, stored)).toBe(false);
    expect(passwordReusable({ ...stored, username: "other@acme.test" }, stored)).toBe(false);
  });
});
