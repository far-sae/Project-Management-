// @vitest-environment node
import { connect, createServer, type Server, type Socket } from "node:net";
import { createSecureContext, TLSSocket } from "node:tls";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mapSmtpError } from "../../../../api/_signroom/mailbox/errors";
import { DNS_TIMEOUT_MS } from "../../../../api/_signroom/mailbox/ssrf";
import {
  CONNECTION_TIMEOUT_MS, DEADLINE_MS, ehloName, GREETING_TIMEOUT_MS, makeTransportFactory, nodemailerTransport, SOCKET_TIMEOUT_MS, transportOptions,
  type MailboxConnection, type OpenSocket, type OutgoingMail,
} from "../../../../api/_signroom/mailbox/transport";

const conn: MailboxConnection = {
  host: "smtp.gmail.com", address: "142.250.27.108", port: 465, security: "tls", username: "you@acme.test", password: "app-password-1",
};
const mail: OutgoingMail = {
  from: { name: "Acme Studio Ltd", address: "you@acme.test" },
  to: "client@example.com",
  subject: "Invoice INV-000012 from Acme Studio Ltd",
  text: "Hello",
  html: "<p>Hello</p>",
  attachments: [{ filename: "INV-000012.pdf", content: Buffer.from("%PDF-1.4\n"), contentType: "application/pdf" }],
};
/** The EHLO name is the site's own host; the tests run as this site. */
const savedSite = process.env.PUBLIC_SITE_URL;
beforeEach(() => {
  process.env.PUBLIC_SITE_URL = "https://www.app.example.com";
});
afterAll(() => {
  if (savedSite === undefined) delete process.env.PUBLIC_SITE_URL;
  else process.env.PUBLIC_SITE_URL = savedSite;
});

const fakeMailer = () => ({
  verify: vi.fn().mockResolvedValue(true),
  sendMail: vi.fn().mockResolvedValue({ messageId: "<1@acme.test>" }),
  close: vi.fn(),
});

describe("timeouts", () => {
  it("connection and greeting 8 s, socket 15 s, the whole verify or send 18 s", () => {
    expect(CONNECTION_TIMEOUT_MS).toBe(8_000);
    expect(GREETING_TIMEOUT_MS).toBe(8_000);
    expect(SOCKET_TIMEOUT_MS).toBe(15_000);
    expect(DEADLINE_MS).toBe(18_000);
  });

  it("DNS plus the SMTP deadline stay well inside one request", () => {
    expect(DNS_TIMEOUT_MS + DEADLINE_MS).toBeLessThanOrEqual(21_000);
  });
});

describe("the EHLO name", () => {
  it("is the site's own host without www, from PUBLIC_SITE_URL or Vercel's production domain", () => {
    expect(ehloName()).toBe("app.example.com");
    delete process.env.PUBLIC_SITE_URL;
    const savedVercel = process.env.VERCEL_PROJECT_PRODUCTION_URL;
    try {
      process.env.VERCEL_PROJECT_PRODUCTION_URL = "taskcalendar.example.org";
      expect(ehloName()).toBe("taskcalendar.example.org");
      delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
      // Nothing known: no name is set, and nodemailer uses the machine's own.
      expect(ehloName()).toBeUndefined();
      expect("name" in transportOptions(conn)).toBe(false);
      process.env.PUBLIC_SITE_URL = "http://localhost:5173";
      expect(ehloName()).toBeUndefined();
    } finally {
      if (savedVercel === undefined) delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
      else process.env.VERCEL_PROJECT_PRODUCTION_URL = savedVercel;
    }
  });
});

describe("transportOptions", () => {
  it("connects to the pinned address, checks the certificate against the server's name, with the spec's timeouts and no logging", () => {
    expect(transportOptions(conn)).toEqual({
      host: "142.250.27.108",
      port: 465,
      secure: true,
      requireTLS: false,
      servername: "smtp.gmail.com",
      name: "app.example.com",
      auth: { user: "you@acme.test", pass: "app-password-1" },
      tls: { servername: "smtp.gmail.com", rejectUnauthorized: true, minVersion: "TLSv1.2" },
      connectionTimeout: 8_000,
      greetingTimeout: 8_000,
      socketTimeout: 15_000,
      logger: false,
      debug: false,
      transactionLog: false,
      disableFileAccess: true,
      disableUrlAccess: true,
    });
  });

  it("STARTTLS on 587 must upgrade to a verified TLS connection before the password is sent", () => {
    // toEqual: no ignoreTLS or opportunisticTLS can creep in.
    expect(transportOptions({ ...conn, host: "smtp.office365.com", address: "52.97.0.1", port: 587, security: "starttls" })).toEqual({
      host: "52.97.0.1",
      port: 587,
      secure: false,
      requireTLS: true,
      servername: "smtp.office365.com",
      name: "app.example.com",
      auth: { user: "you@acme.test", pass: "app-password-1" },
      tls: { servername: "smtp.office365.com", rejectUnauthorized: true, minVersion: "TLSv1.2" },
      connectionTimeout: 8_000,
      greetingTimeout: 8_000,
      socketTimeout: 15_000,
      logger: false,
      debug: false,
      transactionLog: false,
      disableFileAccess: true,
      disableUrlAccess: true,
    });
    expect(transportOptions({ ...conn, port: 2525, security: "starttls" })).toMatchObject({ port: 2525, secure: false, requireTLS: true });
  });
});

describe("makeTransportFactory", () => {
  it("verify logs in through the mailer, send passes the message as built, close never throws", async () => {
    const mailer = fakeMailer();
    mailer.close.mockImplementation(() => {
      throw new Error("already closed");
    });
    const create = vi.fn((_options: unknown) => mailer);
    const t = makeTransportFactory(create)(conn);
    expect(create).toHaveBeenCalledWith({ ...transportOptions(conn), getSocket: expect.any(Function) });
    await t.verify();
    expect(mailer.verify).toHaveBeenCalledTimes(1);
    expect(mailer.sendMail).not.toHaveBeenCalled();
    await t.send(mail);
    expect(mailer.sendMail).toHaveBeenCalledWith({
      from: mail.from, to: mail.to, subject: mail.subject, text: mail.text, html: mail.html, attachments: mail.attachments,
    });
    expect(() => t.close()).not.toThrow();
  });

  it("passes the server's refusal through for the error mapping", async () => {
    const mailer = fakeMailer();
    mailer.verify.mockRejectedValue(Object.assign(new Error("Invalid login: 535"), { code: "EAUTH", responseCode: 535 }));
    await expect(makeTransportFactory(() => mailer)(conn).verify()).rejects.toMatchObject({ code: "EAUTH" });
  });

  it("gives up at the deadline with a timeout the error mapping reads as unreachable, and is finished after it", async () => {
    const stuck = { verify: () => new Promise(() => undefined), sendMail: vi.fn(() => new Promise(() => undefined)), close: vi.fn() };
    const t = makeTransportFactory(() => stuck, 20)(conn);
    const err = await t.verify().catch((e: unknown) => e);
    expect(err).toMatchObject({ code: "ETIMEDOUT" });
    expect(mapSmtpError(err, "gmail").kind).toBe("unreachable");
    const late = await t.send(mail).catch((e: unknown) => e);
    expect(late).toMatchObject({ code: "ECONNECTION" });
    expect(mapSmtpError(late, "gmail").kind).toBe("unreachable");
    expect(stuck.sendMail).not.toHaveBeenCalled();
  });

  it("hands nodemailer a socket to the checked address, and none once closed (a send still being built cannot connect later)", () => {
    let options: { getSocket?: (o: unknown, cb: (err: Error | null, socket?: unknown) => void) => void } = {};
    const fake = { destroy: vi.fn(), on: vi.fn(), once: vi.fn() };
    const openSocket = vi.fn(() => fake as unknown as Socket);
    const t = makeTransportFactory((o) => {
      options = o;
      return fakeMailer();
    }, 1_000, openSocket)(conn);
    const first = vi.fn();
    options.getSocket({}, first);
    expect(openSocket).toHaveBeenCalledWith("142.250.27.108", 465);
    expect(first).toHaveBeenCalledWith(null, { connection: fake });
    t.close();
    expect(fake.destroy).toHaveBeenCalled();
    const second = vi.fn();
    options.getSocket({}, second);
    expect(openSocket).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledWith(expect.objectContaining({ code: "ECONNECTION" }));
  });

  it.each(["10.0.0.5","127.0.0.1", "169.254.169.254", "::1", "fd00:ec2::254", "smtp.gmail.com", ""])(
    "refuses to build a transport to the unchecked address %j (nodemailer must never resolve or reach it)",
    (address) => {
      const create = vi.fn(fakeMailer);
      expect(() => makeTransportFactory(create)({ ...conn, address })).toThrow();
      expect(create).not.toHaveBeenCalled();
    },
  );

  it("the default factory builds a real nodemailer transport without connecting", () => {
    const t = nodemailerTransport(conn);
    expect(typeof t.verify).toBe("function");
    expect(typeof t.send).toBe("function");
    t.close();
  });
});

/**
 * Real nodemailer against a local server: the factory still checks the public
 * address, and an injected OpenSocket points the TCP connection at 127.0.0.1.
 */
describe("the real connection", () => {
  // A throwaway self-signed certificate for smtp.gmail.com (EC P-256, valid to 2126). Not trusted by anyone:
  // the client must refuse it.
  const TEST_KEY = [
    "-----BEGIN PRIVATE KEY-----",
    "MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQg6Bk7T1bhxHsH9w95",
    "a1jzqe7Vdn3+tJKEA6b9of/8Ou6hRANCAATh6x1HnLobLUUNZO/FS92qewB7y+0L",
    "X7g4pjghsQrgybY0weE5cMaKxGdvQY2XtQQlxtz1+72mvUQb1k5VWLX6",
    "-----END PRIVATE KEY-----",
  ].join("\n");
  const TEST_CERT = [
    "-----BEGIN CERTIFICATE-----",
    "MIIBpDCCAUqgAwIBAgIUVWQQESDqPlISHlAbJUW9qwaNdjcwCgYIKoZIzj0EAwIw",
    "GTEXMBUGA1UEAwwOc210cC5nbWFpbC5jb20wIBcNMjYxMDAyMTYxODU2WhgPMjEy",
    "NjA5MDgxNjE4NTZaMBkxFzAVBgNVBAMMDnNtdHAuZ21haWwuY29tMFkwEwYHKoZI",
    "zj0CAQYIKoZIzj0DAQcDQgAE4esdR5y6Gy1FDWTvxUvdqnsAe8vtC1+4OKY4IbEK",
    "4Mm2NMHhOXDGisRnb0GNl7UEJcbc9fu9pr1EG9ZOVVi1+qNuMGwwHQYDVR0OBBYE",
    "FIOvXdM/+9JiwDwD6y0DP6iBf1wsMB8GA1UdIwQYMBaAFIOvXdM/+9JiwDwD6y0D",
    "P6iBf1wsMA8GA1UdEwEB/wQFMAMBAf8wGQYDVR0RBBIwEIIOc210cC5nbWFpbC5j",
    "b20wCgYIKoZIzj0EAwIDSAAwRQIhAN7UIBgm5T6LGxE2m5KqSUnRCEM6Bk3ZyRki",
    "fTHsJEDhAiASAbc1gJnZxXVS2MzOHD+ySrU9m3s9Xc54O9eQ84FziA==",
    "-----END CERTIFICATE-----",
  ].join("\n");
  const secureContext = createSecureContext({ key: TEST_KEY, cert: TEST_CERT });

  let server: Server | undefined;
  const serverSockets: Socket[] = [];
  afterEach(async () => {
    for (const socket of serverSockets.splice(0)) socket.destroy();
    await new Promise((done) => (server ? server.close(done) : done(undefined)));
    server = undefined;
  });

  /** Listens on 127.0.0.1; resolves with an OpenSocket that connects there, whatever address it is given. */
  async function listen(onConnection: (socket: Socket) => void): Promise<OpenSocket> {
    server = createServer((socket) => {
      serverSockets.push(socket);
      socket.on("error", () => undefined);
      onConnection(socket);
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    const { port } = server.address() as { port: number };
    return () => connect({ host: "127.0.0.1", port });
  }

  type Seen = { commands: string[]; sni?: string; closedAt?: Promise<number> };

  /**
   * A plain SMTP server: silent if `greet` is false; otherwise greets, offers STARTTLS on EHLO if `offer`,
   * and answers STARTTLS by upgrading with the test certificate, refusing (502) or stalling.
   * The socket is always read, so the server sees the client close it.
   */
  function smtp(seen: Seen, { greet = true, offer = true, startTls = "upgrade" as "upgrade" | "refuse" | "stall" } = {}) {
    return (raw: Socket) => {
      seen.closedAt = new Promise((done) => raw.once("close", () => done(Date.now())));
      if (!greet) {
        raw.resume(); // read, never answer
        return;
      }
      raw.write("220 test ESMTP\r\n");
      const onData = (d: Buffer) => {
        for (const line of d.toString().split("\r\n").filter(Boolean)) {
          seen.commands.push(line);
          if (/^EHLO/i.test(line)) raw.write(offer ? "250-test\r\n250-STARTTLS\r\n250 AUTH PLAIN LOGIN\r\n" : "250-test\r\n250 AUTH PLAIN LOGIN\r\n");
          else if (/^STARTTLS/i.test(line) && startTls === "refuse") raw.write("502 not here\r\n");
          else if (/^STARTTLS/i.test(line) && startTls === "stall") {
            raw.off("data", onData);
            raw.write("220 go ahead\r\n");
            raw.resume(); // swallow the ClientHello, never answer it
          } else if (/^STARTTLS/i.test(line)) {
            raw.off("data", onData);
            raw.write("220 go ahead\r\n", () => {
              const tlsSide = new TLSSocket(raw, {
                isServer: true, secureContext, SNICallback: (name, cb) => { seen.sni = name; cb(null, secureContext); },
              });
              tlsSide.on("error", () => undefined);
            });
          } else raw.write("530 must issue STARTTLS first\r\n");
        }
      };
      raw.on("data", onData);
    };
  }

  const c587: MailboxConnection = { ...conn, port: 587, security: "starttls" };

  it.each([
    ["465, during the TLS handshake", conn, { greet: false }],
    ["587, waiting for the greeting", c587, { greet: false }],
    ["587, in the TLS handshake after STARTTLS", c587, { startTls: "stall" as const }],
  ])("%s: the deadline destroys the connection at once, long before nodemailer's own timers", async (_label, c, script) => {
    const seen: Seen = { commands: [] };
    const open = await listen(smtp(seen, script));
    const started = Date.now();
    const err = await makeTransportFactory(undefined, 100, open)(c).verify().catch((e: unknown) => e);
    expect(err).toMatchObject({ code: "ETIMEDOUT" });
    expect(seen.closedAt).toBeDefined();
    expect((await seen.closedAt) - started).toBeLessThan(2_000);
    expect(seen.commands.join("\n")).not.toMatch(/AUTH/i);
  });

  it.each([
    ["465", conn],
    ["587", c587],
  ])("%s: a refused connection reads as 'couldn't reach the server'", async (_label, c) => {
    // A port that was free a moment ago: nothing listens there now.
    const probe = createServer();
    await new Promise<void>((done) => probe.listen(0, "127.0.0.1", done));
    const { port } = probe.address() as { port: number };
    await new Promise((done) => probe.close(done));
    const refused: OpenSocket = () => connect({ host: "127.0.0.1", port });
    const err = await makeTransportFactory(undefined, 5_000, refused)(c).verify().catch((e: unknown) => e);
    expect(err).toMatchObject({ code: "ESOCKET" });
    expect(String((err as Error).message)).toMatch(/ECONNREFUSED/);
    expect(mapSmtpError(err, "custom").kind).toBe("unreachable");
  });

  it("close() while a verify is under way destroys the connection, and the transport opens no more", async () => {
    const seen: Seen = { commands: [] };
    let arrived: () => void;
    const connected = new Promise<void>((done) => (arrived = done));
    const silent = smtp(seen, { greet: false });
    const open = await listen((socket) => {
      silent(socket);
      arrived();
    });
    const t = makeTransportFactory(undefined, 5_000, open)(c587);
    const pending = t.verify().catch((e: unknown) => e);
    await connected;
    const closedAt = Date.now();
    t.close();
    expect((await seen.closedAt) - closedAt).toBeLessThan(1_000);
    expect(await pending).toBeInstanceOf(Error);
    await expect(t.send(mail)).rejects.toMatchObject({ code: "ECONNECTION" });
  });

  it("465: TLS from the first byte, with the server's name for SNI, and an untrusted certificate is refused", async () => {
    let sni: string | undefined;
    const plaintext: string[] = [];
    const open = await listen((raw) => {
      const tlsSide = new TLSSocket(raw, {
        isServer: true, secureContext, SNICallback: (name, cb) => { sni = name; cb(null, secureContext); },
      });
      tlsSide.on("error", () => undefined);
      tlsSide.on("data", (d: Buffer) => plaintext.push(d.toString()));
      tlsSide.on("secure", () => tlsSide.write("220 test ESMTP\r\n"));
    });
    const err = await makeTransportFactory(undefined, 5_000, open)(conn).verify().catch((e: unknown) => e);
    expect(mapSmtpError(err, "gmail").kind).toBe("certificate");
    expect(sni).toBe("smtp.gmail.com");
    expect(plaintext.join("")).not.toMatch(/AUTH|EHLO/);
  });

  it("587 STARTTLS: upgrades with the server's name for SNI, refuses an untrusted certificate, never sends AUTH", async () => {
    const seen: Seen = { commands: [] };
    const open = await listen(smtp(seen));
    const err = await makeTransportFactory(undefined, 5_000, open)(c587).verify().catch((e: unknown) => e);
    expect(mapSmtpError(err, "gmail").kind).toBe("certificate");
    expect(seen.commands).toEqual(["EHLO app.example.com", "STARTTLS"]);
    expect(seen.sni).toBe("smtp.gmail.com");
  });

  it("587 STARTTLS: a server that won't upgrade is refused before the password is sent", async () => {
    const seen: Seen = { commands: [] };
    const open = await listen(smtp(seen, { offer: false, startTls: "refuse" }));
    const err = await makeTransportFactory(undefined, 5_000, open)(c587).verify().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(mapSmtpError(err, "gmail").kind).toBe("insecure");
    expect(seen.commands).toEqual(["EHLO app.example.com", "STARTTLS"]);
  });
});
