// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  APP_PASSWORD_MESSAGES, APP_PASSWORD_NEEDED_MESSAGE, BLOCKED_MESSAGE, CERTIFICATE_MESSAGE, INSECURE_MESSAGE, isLoginFailure, mapSmtpError,
  OUTLOOK_BLOCKED_MESSAGE, REJECTED_MESSAGE, scrubForLog, UNKNOWN_MESSAGE, UNREACHABLE_MESSAGE, WRONG_PASSWORD_MESSAGE,
} from "../../../../api/_signroom/mailbox/errors";

/** A nodemailer-shaped error: message plus code / responseCode / response. */
const smtpError = (message: string, extra: Record<string, unknown> = {}) => Object.assign(new Error(message), extra);
const BAD_LOGIN = smtpError("Invalid login: 535-5.7.8 Username and Password not accepted.", { code: "EAUTH", responseCode: 535 });

describe("mapSmtpError", () => {
  it("a refused password: Gmail, Yahoo and Microsoft 365 get their app-password hint, others the plain sentence", () => {
    expect(mapSmtpError(BAD_LOGIN, "gmail")).toEqual({ kind: "auth", message: APP_PASSWORD_MESSAGES.gmail });
    expect(mapSmtpError(BAD_LOGIN, "yahoo")).toEqual({ kind: "auth", message: APP_PASSWORD_MESSAGES.yahoo });
    expect(mapSmtpError(BAD_LOGIN, "outlook")).toEqual({ kind: "auth", message: APP_PASSWORD_MESSAGES.outlook });
    expect(mapSmtpError(BAD_LOGIN, "ionos")).toEqual({ kind: "auth", message: WRONG_PASSWORD_MESSAGE });
    expect(APP_PASSWORD_MESSAGES.gmail).toContain("16-letter app password");
  });

  it("'application-specific password required' asks for an app password", () => {
    const e = smtpError("Invalid login: 534-5.7.9 Application-specific password required.", { code: "EAUTH", responseCode: 534 });
    expect(mapSmtpError(e, "gmail")).toEqual({ kind: "auth", message: APP_PASSWORD_MESSAGES.gmail });
    expect(mapSmtpError(e, "zoho")).toEqual({ kind: "auth", message: APP_PASSWORD_NEEDED_MESSAGE });
  });

  it("a provider that blocked the sign-in says so (Microsoft 365 SMTP AUTH off, Google web sign-in needed)", () => {
    const m365 = smtpError("Invalid login: 535 5.7.139 Authentication unsuccessful, SmtpClientAuthentication is disabled for the Tenant.", { code: "EAUTH", responseCode: 535 });
    expect(mapSmtpError(m365, "outlook")).toEqual({ kind: "blocked", message: OUTLOOK_BLOCKED_MESSAGE });
    const google = smtpError("Invalid login: 534-5.7.14 Please log in via your web browser and then try again.", { code: "EAUTH", responseCode: 534 });
    expect(mapSmtpError(google, "gmail")).toEqual({ kind: "blocked", message: BLOCKED_MESSAGE });
  });

  it("names a bad certificate whatever code nodemailer put on it", () => {
    for (const e of [
      smtpError("certificate has expired", { code: "ESOCKET" }),
      smtpError("Hostname/IP does not match certificate's altnames: Host: smtp.x.net. is not in the cert's altnames", { code: "ESOCKET" }),
      smtpError("Error initiating TLS - self-signed certificate in certificate chain", { code: "ETLS" }),
      smtpError("unable to verify the first certificate", { code: "ESOCKET" }),
    ]) {
      expect(mapSmtpError(e, "custom")).toEqual({ kind: "certificate", message: CERTIFICATE_MESSAGE });
    }
  });

  it("a server that won't upgrade to TLS is refused before the password goes anywhere", () => {
    expect(mapSmtpError(smtpError("Error upgrading connection with STARTTLS", { code: "ETLS" }), "custom")).toEqual({ kind: "insecure", message: INSECURE_MESSAGE });
  });

  it("refused, dropped and slow connections are 'couldn't reach the server'", () => {
    for (const e of [
      smtpError("connect ECONNREFUSED 203.0.113.1:465", { code: "ECONNECTION" }),
      smtpError("Greeting never received", { code: "ETIMEDOUT" }),
      smtpError("read ECONNRESET", { code: "ESOCKET" }),
      smtpError("getaddrinfo ENOTFOUND smtp.nowhere.net", { code: "EDNS" }),
      smtpError("The email server took too long.", { code: "ETIMEDOUT" }),
    ]) {
      expect(mapSmtpError(e, "custom")).toEqual({ kind: "unreachable", message: UNREACHABLE_MESSAGE });
    }
  });

  it("a connection refused, unroutable or timed out on our own socket (ESOCKET) is 'couldn't reach the server', wherever the cause shows", () => {
    for (const e of [
      smtpError("connect ECONNREFUSED 203.0.113.1:465", { code: "ESOCKET", errno: -111, syscall: "connect" }),
      smtpError("connect EHOSTUNREACH 203.0.113.1:587", { code: "ESOCKET" }),
      smtpError("connect ETIMEDOUT 203.0.113.1:465", { code: "ESOCKET" }),
      smtpError("Connection failed", { code: "ESOCKET", cause: { code: "ECONNREFUSED" } }),
      smtpError("Connection failed", { cause: Object.assign(new Error("connect EHOSTUNREACH 203.0.113.1:465"), { code: "EHOSTUNREACH" }) }),
      smtpError("Error initiating TLS - connect ECONNREFUSED 203.0.113.1:465", { code: "ETLS" }),
    ]) {
      expect(mapSmtpError(e, "custom")).toEqual({ kind: "unreachable", message: UNREACHABLE_MESSAGE });
    }
    // On the cause's message alone, too (no code anywhere).
    expect(mapSmtpError(smtpError("Connection failed", { cause: new Error("connect ENETUNREACH 203.0.113.1:465") }), "custom").kind).toBe("unreachable");
  });

  it("the server's own reply text never makes a failure 'unreachable': only our socket's messages do", () => {
    const rejected = smtpError("Message failed: 554 5.7.1 Rejected", {
      code: "EMESSAGE", responseCode: 554, response: "554 5.7.1 Rejected: upstream ECONNREFUSED ETIMEDOUT",
    });
    expect(mapSmtpError(rejected, "custom")).toEqual({ kind: "rejected", message: REJECTED_MESSAGE });
    const odd = smtpError("Unexpected reply", { response: "421 ECONNRESET EHOSTUNREACH ENETUNREACH" });
    expect(mapSmtpError(odd, "custom")).toEqual({ kind: "unknown", message: UNKNOWN_MESSAGE });
  });

  it("a refused recipient or message is 'rejected'", () => {
    expect(mapSmtpError(smtpError("Can't send mail - all recipients were rejected: 550 5.1.1 No such user", { code: "EENVELOPE", responseCode: 550 }), "gmail")).toEqual({
      kind: "rejected", message: REJECTED_MESSAGE,
    });
    expect(mapSmtpError(smtpError("Message failed: 554 5.7.1 Spam", { code: "EMESSAGE", responseCode: 554 }), "gmail").kind).toBe("rejected");
  });

  it("anything else, errors or not, is the generic sentence", () => {
    expect(mapSmtpError(smtpError("Something odd"), "gmail")).toEqual({ kind: "unknown", message: UNKNOWN_MESSAGE });
    expect(mapSmtpError("boom", "gmail")).toEqual({ kind: "unknown", message: UNKNOWN_MESSAGE });
    expect(mapSmtpError(null, "custom")).toEqual({ kind: "unknown", message: UNKNOWN_MESSAGE });
  });

  it("every sentence fits sr_mailboxes.last_error (300 characters)", () => {
    const all = [
      ...Object.values(APP_PASSWORD_MESSAGES), APP_PASSWORD_NEEDED_MESSAGE, BLOCKED_MESSAGE, OUTLOOK_BLOCKED_MESSAGE, CERTIFICATE_MESSAGE,
      INSECURE_MESSAGE, REJECTED_MESSAGE, UNKNOWN_MESSAGE, UNREACHABLE_MESSAGE, WRONG_PASSWORD_MESSAGE,
    ];
    for (const m of all) expect(m.length).toBeLessThanOrEqual(300);
  });
});

describe("isLoginFailure", () => {
  it("is true only when the sign-in itself failed", () => {
    expect(isLoginFailure("auth")).toBe(true);
    expect(isLoginFailure("blocked")).toBe(true);
    for (const k of ["unreachable", "certificate", "insecure", "rejected", "unknown"] as const) expect(isLoginFailure(k)).toBe(false);
  });
});

describe("scrubForLog", () => {
  it("keeps the code and reason but never the password or its base64", () => {
    const secret = "app-password-1";
    const e = smtpError(`Invalid login: 535 bad ${secret} ${Buffer.from(secret).toString("base64")}`, { code: "EAUTH", responseCode: 535 });
    const line = scrubForLog(e, secret);
    expect(line).toContain("EAUTH");
    expect(line).toContain("535");
    expect(line).not.toContain(secret);
    expect(line).not.toContain(Buffer.from(secret).toString("base64"));
    expect(line).toContain("[redacted]");
  });

  /** True when any base64-looking run in `line`, decoded from any of its four character offsets, still holds `secret`. */
  function base64Leaks(line: string, secret: string): boolean {
    for (const run of line.match(/[A-Za-z0-9+/=]{4,}/g) ?? []) {
      for (let k = 0; k < 4; k++) {
        if (Buffer.from(run.slice(k), "base64").toString("latin1").includes(Buffer.from(secret, "utf8").toString("latin1"))) return true;
      }
    }
    return false;
  }

  const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");

  it("finds the password's base64 whatever its alignment inside a longer base64 run", () => {
    const secret = "app-password-1";
    for (const prefix of ["", "x", "xy", "xyz", "you@acme.test:"]) {
      const run = b64(`${prefix}${secret}-and-more-after`);
      expect(base64Leaks(run, secret)).toBe(true); // the oracle sees it before scrubbing
      const line = scrubForLog(smtpError(`Invalid login: 535 ${run}`, { code: "EAUTH", responseCode: 535 }), secret);
      expect(base64Leaks(line, secret)).toBe(false);
      expect(line).toContain("[redacted]");
    }
  });

  it("removes an AUTH PLAIN token, and an AUTH LOGIN username and password, when given the username", () => {
    const user = "billing@acme.test";
    const secret = "s3cret-Pa55";
    const plain = b64(`\0${user}\0${secret}`);
    const e = smtpError(`Invalid login: 535 AUTH PLAIN ${plain} / AUTH LOGIN ${b64(user)} ${b64(secret)}`, { code: "EAUTH", responseCode: 535 });
    const line = scrubForLog(e, secret, user);
    expect(line).not.toContain(plain);
    expect(line).not.toContain(b64(user));
    expect(line).not.toContain(b64(secret));
    expect(base64Leaks(line, secret)).toBe(false);
    expect(line).toBe("EAUTH 535 Invalid login: 535 AUTH PLAIN [redacted] / AUTH LOGIN [redacted] [redacted]");
  });

  it("removes the password's AUTH PLAIN base64 even without the username", () => {
    const secret = "s3cret-Pa55";
    for (const user of ["a@b.test", "ab@b.test", "abc@b.test"]) {
      const line = scrubForLog(smtpError(`535 ${b64(`\0${user}\0${secret}`)}`, { code: "EAUTH" }), secret);
      expect(base64Leaks(line, secret)).toBe(false);
    }
  });

  it("keeps a log line on one line", () => {
    expect(scrubForLog(smtpError("first\r\nsecond\nthird", { code: "ESOCKET" }), "pw")).toBe("ESOCKET first second third");
  });

  it("is at most 300 characters", () => {
    expect(scrubForLog(smtpError("x".repeat(1000)), "pw").length).toBeLessThanOrEqual(300);
    expect(scrubForLog("plain text failure", "pw")).toBe("plain text failure");
  });
});
