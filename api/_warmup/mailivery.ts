import { randomUUID } from "node:crypto";
import { MailReachError, type MailReach, type MrAccount, type MrConnect, type MrStats } from "./mailreach.js";

/**
 * Mailivery as a warm-up service, in the same shape as MailReach, so the rest
 * of the warm-up server does not care which of the two an organisation uses.
 * Written from its public API reference (mailivery.readme.io):
 *   base      https://app.mailivery.io/api/v1
 *   key       the header "Authorization: Bearer <API key>" (Settings, Team Settings, API Access)
 *   mailboxes GET   /campaigns?per_page=100&page=N   (Mailivery calls a mailbox a "campaign")
 *   figures   PATCH /campaigns/{id}/get-metrics      one entry for each day: sent, and where they landed
 *   score     PATCH /campaigns/{id}/get-health-score-points   0 to 100, or none in the first days
 *   add       POST  /campaigns/smtp (a form), then PATCH /campaigns/{id}/start-warmup
 *   pause     PATCH /campaigns/{id}/pause-warmup, resume: /resume-warmup
 * The three reading calls are PATCH in Mailivery's API although they change
 * nothing. Its reference is not the same on every page about the spelling of
 * a few names ("landed In", "Landed In"), so names are read without regard to
 * capitals.
 */

export const MAILIVERY_BASE = "https://app.mailivery.io/api/v1";
const TIMEOUT_MS = 15_000;
const PAGE_SIZE = 100;
const MAX_PAGES = 10;
/** What a mailbox added from here starts with; both can be changed in Mailivery afterwards. */
const EMAILS_A_DAY = 20;
const REPLY_PERCENT = 30;

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
const count = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);

/** The same object with every name in lower case, so "Total" and "total" are one. */
function lower(v: unknown): Json {
  const out: Json = {};
  for (const [k, x] of Object.entries(obj(v))) out[k.toLowerCase()] = x;
  return out;
}

function accountFrom(raw: unknown): MrAccount | null {
  const r = obj(raw);
  if (typeof r.id !== "number" || typeof r.email !== "string") return null;
  const status = typeof r.status_code === "string" ? r.status_code : "active";
  return {
    id: r.id,
    email: r.email.trim().toLowerCase(),
    createdAt: typeof r.created_at === "string" ? r.created_at : null,
    alive: status !== "connection-problem",
    suspended: status === "paused",
    // A mailbox in Mailivery is there to be warmed: there is no "in the service but switched off".
    warmingEnabled: true,
    // The score is asked for with the figures (stats), not with the list.
    score: null,
  };
}

export function mailivery(apiKey: string, fetchFn: typeof fetch, now: () => Date = () => new Date()): MailReach {
  async function call(method: "GET" | "PATCH" | "POST", path: string, form?: FormData): Promise<Json> {
    let reply: Response;
    try {
      reply = await fetchFn(MAILIVERY_BASE + path, {
        method,
        // No Content-Type: a form names its own (with its boundary), and the other calls have no body.
        headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json", "X-Request-ID": randomUUID() },
        body: form,
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
    if (!reply.ok) throw new MailReachError(reply.status, obj(parsed));
    return obj(parsed);
  }

  /** A refusal that only says "it is already so" is not a failure. */
  const already = (e: unknown, code: string): boolean => e instanceof MailReachError && e.status === 400 && e.detail.code === code;

  async function accounts(): Promise<MrAccount[]> {
    const all: MrAccount[] = [];
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const got = await call("GET", `/campaigns?per_page=${PAGE_SIZE}&page=${page}`);
      const rows = Array.isArray(got.data) ? got.data : [];
      for (const row of rows) {
        const account = accountFrom(row);
        if (account) all.push(account);
      }
      const meta = obj(got.meta);
      const last = typeof meta.last_page === "number" ? meta.last_page : null;
      if (last !== null ? page >= last : rows.length < PAGE_SIZE) break;
    }
    return all;
  }

  async function figures(id: number, pastDays: number): Promise<{ sent: number; spam: number }> {
    const got = await call("PATCH", `/campaigns/${id}/get-metrics`);
    // The first day that counts, as the service writes its days: "2026-11-14".
    const from = new Date(now().getTime() - (pastDays - 1) * 86_400_000).toISOString().slice(0, 10);
    let sent = 0;
    let spam = 0;
    for (const [day, entry] of Object.entries(obj(got.data))) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day < from) continue;
      const warm = lower(lower(entry)["warm up"]);
      sent += count(warm.total);
      spam += count(lower(warm["landed in"]).spam);
    }
    return { sent, spam };
  }

  async function score(id: number): Promise<number | null> {
    const got = await call("PATCH", `/campaigns/${id}/get-health-score-points`);
    const value = obj(got.data).health_score;
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  }

  return {
    accounts,

    async stats(id, pastDays): Promise<MrStats> {
      // Two questions, and one failing does not lose the answer to the other.
      const [f, s] = await Promise.allSettled([figures(id, pastDays), score(id)]);
      if (f.status === "rejected" && s.status === "rejected") throw f.reason;
      return { ...(f.status === "fulfilled" ? f.value : { sent: 0, spam: 0 }), score: s.status === "fulfilled" ? s.value : null };
    },

    async connect(input: MrConnect) {
      const form = new FormData();
      const fields: Record<string, string> = {
        email: input.email,
        first_name: input.firstName,
        last_name: input.lastName,
        smtp_host: input.smtpHost,
        smtp_port: String(input.smtpPort),
        smtp_username: input.username,
        smtp_password: input.password,
        imap_host: input.imapHost,
        imap_port: String(input.imapPort),
        imap_username: input.username,
        imap_password: input.password,
        imap_email: input.email,
        email_per_day: String(EMAILS_A_DAY),
        response_rate: String(REPLY_PERCENT),
        with_rampup: "1",
        rampup_speed: "normal",
      };
      for (const [k, v] of Object.entries(fields)) form.append(k, v);

      let made: MrAccount | null;
      try {
        made = accountFrom((await call("POST", "/campaigns/smtp", form)).data);
      } catch (e) {
        // "This address is already here": then it is the mailbox that was wanted.
        const taken = e instanceof MailReachError && e.status === 400 && /already been taken/i.test(JSON.stringify(e.detail.error ?? e.detail.errors ?? ""));
        if (!taken) throw e;
        const existing = (await accounts()).find((a) => a.email === input.email.trim().toLowerCase());
        if (!existing) throw e;
        return existing;
      }
      if (!made) throw new MailReachError(502);

      try {
        await call("PATCH", `/campaigns/${made.id}/start-warmup`);
      } catch (e) {
        if (already(e, "CAMPAIGN_ALREADY_STARTED")) return made;
        // Mailivery signs in to the mailbox before it starts; it does not say which of the two sign-ins failed.
        if (e instanceof MailReachError && e.detail.code === "VALIDATION_CREDENTIALS_ERROR") throw new MailReachError(e.status, { imap_auth_success: false, smtp_auth_success: false });
        throw e;
      }
      return made;
    },

    async suspend(id, suspended) {
      try {
        await call("PATCH", `/campaigns/${id}/${suspended ? "pause-warmup" : "resume-warmup"}`);
      } catch (e) {
        if (already(e, suspended ? "CAMPAIGN_ALREADY_PAUSED" : "CAMPAIGN_ALREADY_STARTED")) return;
        throw e;
      }
    },
  };
}
