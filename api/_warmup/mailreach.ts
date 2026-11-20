/**
 * The warm-up service (MailReach), as far as this app uses it. Written from
 * its public API reference (docs.mailreach.co):
 *   base     https://api.mailreach.co/api/v1
 *   key      the header "X-Api-Key: Bearer <project API key>"
 *   accounts GET /accounts?page=N (50 a page, pages start at 0)
 *   stats    GET /accounts/{id}/stats?past_days=N  -> total_messages_sent, total_spam
 *   connect  POST /imap_auth (an inbox by its IMAP and SMTP sign-in)
 *   pause    POST /accounts/{id}/suspend { suspended }
 * The key is the organisation's own, so its seats and credits are billed to it.
 */

export const MAILREACH_BASE = "https://api.mailreach.co/api/v1";
const TIMEOUT_MS = 15_000;
/** Accounts on one page, and the most pages read (so a huge project cannot hold a request for ever). */
const PAGE_SIZE = 50;
const MAX_PAGES = 10;

/** A reply the service gave that is not a success; `status` 0 means it could not be reached. */
export class MailReachError extends Error {
  constructor(
    readonly status: number,
    readonly detail: Record<string, unknown> = {},
  ) {
    super(`mailreach ${status}`);
    this.name = "MailReachError";
  }
}

export type MrAccount = {
  id: number;
  email: string;
  createdAt: string | null;
  alive: boolean;
  suspended: boolean;
  warmingEnabled: boolean;
  score: number | null;
};

export type MrStats = { sent: number; spam: number };

export type MrConnect = {
  email: string;
  firstName: string;
  lastName: string;
  provider: "gmail" | "outlook" | "custom";
  username: string;
  password: string;
  imapHost: string;
  imapPort: number;
  smtpHost: string;
  smtpPort: number;
  /** True when the sending server upgrades a plain connection (port 587), false when it is encrypted from the start (465). */
  smtpStartTls: boolean;
};

export interface MailReach {
  /** Every inbox of the project. */
  accounts(): Promise<MrAccount[]>;
  stats(id: number, pastDays: number): Promise<MrStats>;
  connect(input: MrConnect): Promise<MrAccount>;
  suspend(id: number, suspended: boolean): Promise<void>;
}

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

function accountFrom(raw: unknown): MrAccount | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "number" || typeof r.email !== "string") return null;
  return {
    id: r.id,
    email: r.email.trim().toLowerCase(),
    createdAt: typeof r.created_at === "string" ? r.created_at : null,
    // Missing means "nothing wrong was reported".
    alive: r.alive !== false,
    suspended: r.suspended === true,
    warmingEnabled: r.warming_enabled !== false,
    score: typeof r.score === "number" && Number.isFinite(r.score) ? r.score : null,
  };
}

export function mailReach(apiKey: string, fetchFn: typeof fetch): MailReach {
  async function call(method: "GET" | "POST", path: string, body?: unknown): Promise<unknown> {
    let reply: Response;
    try {
      reply = await fetchFn(MAILREACH_BASE + path, {
        method,
        headers: { "X-Api-Key": `Bearer ${apiKey}`, Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new MailReachError(0);
    }
    let parsed: unknown = null;
    try {
      parsed = await reply.json();
    } catch {
      parsed = null;
    }
    if (!reply.ok) throw new MailReachError(reply.status, parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {});
    return parsed;
  }

  return {
    async accounts() {
      const all: MrAccount[] = [];
      for (let page = 0; page < MAX_PAGES; page += 1) {
        const got = await call("GET", `/accounts?page=${page}`);
        const rows = Array.isArray(got) ? got : [];
        for (const row of rows) {
          const account = accountFrom(row);
          if (account) all.push(account);
        }
        if (rows.length < PAGE_SIZE) break;
      }
      return all;
    },

    async stats(id, pastDays) {
      const got = (await call("GET", `/accounts/${id}/stats?past_days=${pastDays}`)) as Record<string, unknown> | null;
      return { sent: num(got?.total_messages_sent), spam: num(got?.total_spam) };
    },

    async connect(input) {
      const got = await call("POST", "/imap_auth", {
        email: input.email,
        first_name: input.firstName,
        last_name: input.lastName,
        provider: input.provider,
        imap_server: input.imapHost,
        imap_server_port: input.imapPort,
        imap_server_username: input.username,
        imap_server_password: input.password,
        smtp_server: input.smtpHost,
        smtp_server_port: input.smtpPort,
        smtp_server_username: input.username,
        smtp_server_password: input.password,
        smtp_server_auth_type: "plain",
        smtp_server_starttls: input.smtpStartTls,
      });
      const account = accountFrom(got);
      if (!account) throw new MailReachError(502);
      return account;
    },

    async suspend(id, suspended) {
      await call("POST", `/accounts/${id}/suspend`, { suspended });
    },
  };
}
