/**
 * Shared set-up for the tests of a workspace's own mailbox (SMTP, Google or
 * Microsoft). Server-side fixtures: run them under `// @vitest-environment node`.
 */
import { randomUUID } from "node:crypto";
import { decryptPassword, encryptPassword, readKey } from "../../../../api/_signroom/mailbox/crypto";
import type { MailboxRow } from "../../../../api/_signroom/mailbox/store";
import type { MailboxConnection, OutgoingMail, TransportFactory } from "../../../../api/_signroom/mailbox/transport";
import type { EmailOAuth, EmailOAuthStatus } from "../../../../api/_signroom/store";
import { mailSetup as baseMailSetup, OWNER } from "./agreementFixtures";
import { SITE } from "./fakeHttp";
import { WS } from "./helpers";

export { OWNER };

/** SIGNROOM_MAIL_KEY as the tests set it: 32 bytes of 7, base64. */
export const KEY = Buffer.alloc(32, 7).toString("base64");
/** A public address, so the SSRF check lets the fake transport "connect". */
export const GMAIL_IP = "142.250.27.108";
/** The site the tests run as (PUBLIC_SITE_URL), and the redirect URI a sign-in registers. */
export const ORIGIN = SITE;
export const CALLBACK = `${SITE}/api/signroom/email-connection/callback`;

/** Sets PUBLIC_SITE_URL for a test and gives back what puts it right again. */
export function asSite(site: string = SITE): () => void {
  const saved = process.env.PUBLIC_SITE_URL;
  process.env.PUBLIC_SITE_URL = site;
  return () => {
    if (saved === undefined) delete process.env.PUBLIC_SITE_URL;
    else process.env.PUBLIC_SITE_URL = saved;
  };
}

export type FakeTransport = {
  factory: TransportFactory;
  connections: MailboxConnection[];
  sent: OutgoingMail[];
  verified: number;
  closed: number;
  failVerify: unknown;
  failSend: unknown;
};

export function fakeTransport(): FakeTransport {
  const t: FakeTransport = {
    connections: [],
    sent: [],
    verified: 0,
    closed: 0,
    failVerify: null,
    failSend: null,
    factory: (c) => {
      t.connections.push(c);
      return {
        verify: async () => {
          t.verified++;
          if (t.failVerify) throw t.failVerify;
        },
        send: async (m) => {
          if (t.failSend) throw t.failSend;
          t.sent.push(m);
        },
        close: () => {
          t.closed++;
        },
      };
    },
  };
  return t;
}

/** A stored mailbox row for a workspace (WS by default), verified, its password encrypted with KEY and bound to that workspace. */
export function mailboxRow(over: Partial<MailboxRow> = {}, password = "app-password-1"): MailboxRow {
  const workspace_id = over.workspace_id ?? WS;
  return {
    workspace_id,
    provider: "gmail",
    host: "smtp.gmail.com",
    port: 465,
    security: "tls",
    username: "you@acme.test",
    from_email: "you@acme.test",
    password_enc: encryptPassword(readKey(KEY)!, workspace_id, password),
    verified_at: "2026-10-01T09:00:00Z",
    last_error: null,
    ...over,
  };
}

/**
 * agreementFixtures' mailSetup with own mailboxes switched on: the mail key, a
 * fake SMTP transport and a resolver that answers a public address. `mailbox`
 * seeds the workspace's SMTP row. `key: null` is a server without the key.
 */
export function mailSetup(opts: Parameters<typeof baseMailSetup>[0] & { mailbox?: MailboxRow | null; key?: Buffer | null } = {}) {
  const { mailbox, key, ...rest } = opts;
  const m = baseMailSetup(rest);
  const transport = fakeTransport();
  m.deps.key = key === undefined ? readKey(KEY) : key;
  m.deps.transport = transport.factory;
  m.deps.lookup = async () => [{ address: GMAIL_IP, family: 4 }];
  if (mailbox) m.store.seedMailbox(mailbox);
  return { ...m, transport };
}

export const OAUTH = {
  secret: "synthetic-client-secret",
  access: "a1",
  renewed: "a2",
  refresh: "r1",
  email: "sender@example.test",
} as const;

export type ProviderCall = { url: string; init: RequestInit };
export type FakeProvider = {
  /** Every request to a Google or Microsoft host, in order (Resend calls stay in `resend`). */
  calls: ProviderCall[];
  /** The refresh answer, or "throw" for a network failure. */
  refresh: { status: number; body: Record<string, unknown> } | "throw";
  /** The send answer's status, or "throw" for a timeout. */
  send: number | "throw";
  /** Runs while the token request is in flight (to race a save against a renewal). */
  onToken?: () => Promise<void>;
};

/**
 * Stores a Google or Microsoft connection for WS (secrets sealed under
 * "oauth:<workspace id>", as oauthConnection.ts does) and points `m.deps.fetch`
 * at a fake provider; requests to api.resend.com still reach the fake Resend.
 */
export async function withOAuth(
  m: ReturnType<typeof mailSetup>,
  opts: { provider?: "google" | "microsoft"; status?: EmailOAuthStatus; expiresIn?: number; secrets?: Record<string, unknown>; workspaceId?: string } = {},
) {
  const provider = opts.provider ?? "google";
  const status = opts.status ?? "verified";
  const workspaceId = opts.workspaceId ?? WS;
  const sealKey = m.deps.key ?? readKey(KEY)!;
  const secrets = opts.secrets ?? {
    clientSecret: OAUTH.secret,
    accessToken: OAUTH.access,
    refreshToken: OAUTH.refresh,
    expires: Date.now() + (opts.expiresIn ?? 3600) * 1000,
  };
  const row: EmailOAuth = {
    workspaceId,
    id: randomUUID(),
    revision: 1,
    provider,
    email: OAUTH.email,
    clientId: "synthetic-client-id",
    tenant: provider === "microsoft" ? "organizations" : "",
    secretsEnc: encryptPassword(sealKey, "oauth:" + workspaceId, JSON.stringify(secrets)),
    status,
    ...(status === "verified" ? { verifiedAt: new Date().toISOString() } : {}),
  };
  await m.store.replaceEmailOAuth(row);
  const p: FakeProvider = { calls: [], refresh: { status: 200, body: { access_token: OAUTH.renewed, expires_in: 3600 } }, send: 200 };
  const resend = m.deps.fetch;
  m.deps.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const u = new URL(url);
    if (u.hostname === "api.resend.com") return resend(url, init);
    p.calls.push({ url, init: init ?? {} });
    if (u.pathname.endsWith("/token")) {
      if (p.onToken) await p.onToken();
      if (p.refresh === "throw") throw new TypeError("fetch failed " + url);
      return new Response(JSON.stringify(p.refresh.body), { status: p.refresh.status });
    }
    if (url === "https://gmail.googleapis.com/gmail/v1/users/me/messages/send" || url === "https://graph.microsoft.com/v1.0/me/sendMail") {
      if (p.send === "throw") throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
      return new Response(p.send < 300 ? (provider === "google" ? '{"id":"g1"}' : null) : "{}", { status: p.send });
    }
    return new Response("{}", { status: 404 });
  }) as never;
  const stored = async () => (await m.store.getEmailOAuth(workspaceId))!;
  const secretsOf = (c: EmailOAuth) => JSON.parse(decryptPassword(sealKey, "oauth:" + workspaceId, c.secretsEnc)!) as Record<string, unknown>;
  const isToken = (c: ProviderCall) => new URL(c.url).pathname.endsWith("/token");
  const tokenCalls = () => p.calls.filter(isToken);
  const sends = () => p.calls.filter((c) => !isToken(c));
  return { provider: p, row, stored, secretsOf, tokenCalls, sends };
}
