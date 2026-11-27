import { AppError } from "../_signroom/errors.js";
import { isUuid } from "../_signroom/validate.js";
import { MailReachError, type MailReach, type MrAccount } from "./mailreach.js";
import { PERIOD_DAYS, SERVICE_LABEL, WARM_DAYS, WARM_MAX_SPAM_PERCENT, WARM_MIN_SENT, WARMUP_SERVICES, type WarmupMailbox, type WarmupServiceName, type WarmupState, type WarmupStatus } from "./shared/types.js";
import type { Mailbox, WarmupStore } from "./store.js";

/**
 * Mailbox warm-up through MailReach or Mailivery, for an organisation's owner
 * and admins. An organisation connects one of the two with its own API key.
 *
 *   GET    status   ?organizationId[&workspaceId]   is a key saved, and where each mailbox stands
 *                                                   (members too: they send campaigns and must see the warning)
 *   POST   key      { organizationId, apiKey[, service] }   check the key with the service, then keep it (encrypted)
 *   DELETE key      { organizationId }              forget the key (the mailboxes stay in the service)
 *   POST   connect  { mailboxId }                   add the mailbox to the service with its own sign-in (uses one seat)
 *   POST   pause    { mailboxId, paused }           pause or resume its warm-up
 *
 * The key is the organisation's own: its seats are billed to it, and no
 * organisation ever uses another's.
 */

export const OWNER_ONLY_MESSAGE = "Only the owner and admins can manage warm-up.";
export const MEMBERS_ONLY_MESSAGE = "Only members of this organisation can see its warm-up.";
export const TABLE_MISSING_MESSAGE = "Warm-up is not set up yet: run supabase/migrations/189_email_warmup.sql in the Supabase SQL editor.";
export const SECRET_KEY_MISSING_MESSAGE = "Warm-up is not set up yet: INTEGRATION_TOKEN_KEY is missing in Vercel's environment variables.";
export const NOT_LINKED_MESSAGE = "Connect MailReach first: add your API key in Email, Settings.";
export const KEY_REFUSED_MESSAGE = "MailReach did not accept this key. Copy it again from the Settings tab of your MailReach project.";
export const KEY_SHAPE_MESSAGE = "Paste the API key from the Settings tab of your MailReach project.";
export const KEY_NO_LONGER_MESSAGE = "MailReach no longer accepts the saved key. Add the current one in Email, Settings.";
export const UNAVAILABLE_MESSAGE = "MailReach could not be reached. Please try again in a minute.";
export const MAILBOX_NOT_FOUND_MESSAGE = "This mailbox was not found.";
export const NO_INBOX_MESSAGE = "Add this mailbox's inbox (IMAP) settings first. Warm-up has to read the inbox to answer its emails and move them out of spam.";
export const NO_PASSWORD_MESSAGE = "This mailbox has no saved password. Open it, enter the password again and save, then start warm-up.";
export const NOT_IN_SERVICE_MESSAGE = "This mailbox is not in MailReach yet. Start warm-up first.";
export const SEATS_MESSAGE = "MailReach refused to add this mailbox. Check that your MailReach plan has a free warm-up seat.";
export const signInFailedMessage = (inbox: boolean, sending: boolean): string =>
  `MailReach could not sign in to this mailbox's ${!inbox && !sending ? "inbox and sending server" : !inbox ? "inbox (IMAP)" : "sending server (SMTP)"}. Check the settings and the password of the mailbox, then try again.`;

export const CHOOSE_SERVICE_MESSAGE = "Choose MailReach or Mailivery.";

/** What a person reads about one service: its name, and where its key is found. */
export function wordsFor(service: WarmupServiceName) {
  const name = SERVICE_LABEL[service];
  const whereKey = service === "mailivery" ? "in Mailivery from Settings, Team Settings, API Access" : "from the Settings tab of your MailReach project";
  return {
    name,
    notLinked: `Connect ${name} first: add your API key in Email, Settings.`,
    keyRefused: `${name} did not accept this key. Copy it again ${whereKey}.`,
    keyShape: service === "mailivery" ? "Paste the API key from Mailivery (Settings, Team Settings, API Access)." : KEY_SHAPE_MESSAGE,
    keyNoLonger: `${name} no longer accepts the saved key. Add the current one in Email, Settings.`,
    unavailable: `${name} could not be reached. Please try again in a minute.`,
    notInService: `This mailbox is not in ${name} yet. Start warm-up first.`,
    seats: `${name} refused to add this mailbox. Check that your ${name} plan has room for one more mailbox.`,
    signInFailed: (inbox: boolean, sending: boolean): string => signInFailedMessage(inbox, sending).replace("MailReach", name),
  };
}

/** A saved key says which service it is for. A MailReach key is kept as it always was. */
const MAILIVERY_MARK = "mailivery|";
export const packKey = (service: WarmupServiceName, key: string): string => (service === "mailivery" ? MAILIVERY_MARK + key : key);
export const unpackKey = (plain: string): { service: WarmupServiceName; key: string } =>
  plain.startsWith(MAILIVERY_MARK) ? { service: "mailivery", key: plain.slice(MAILIVERY_MARK.length) } : { service: "mailreach", key: plain };

export type WarmupDeps = {
  store: WarmupStore;
  /** A client of the named warm-up service (MailReach when no name is given) for one API key. */
  service: (apiKey: string, name?: WarmupServiceName) => MailReach;
  /** Encrypts and decrypts with the server's own key; null when that key is not configured. */
  crypto: { encrypt: (plain: string) => Promise<string>; decrypt: (packed: string) => Promise<string> } | null;
  now?: () => Date;
};

export type RouteRequest = { method: string; action: string; query: Record<string, string>; body: Record<string, unknown>; user: { id: string } };
export type RouteResult = { status: number; json: unknown };

const nowOf = (d: WarmupDeps): Date => (d.now ? d.now() : new Date());

async function refuseUnlessAdmin(d: WarmupDeps, organizationId: unknown, userId: string): Promise<string> {
  const role = isUuid(organizationId) ? await d.store.orgRole(organizationId as string, userId) : null;
  if (role !== "owner" && role !== "admin") throw new AppError(OWNER_ONLY_MESSAGE, 403);
  return organizationId as string;
}

function cryptoOf(d: WarmupDeps): NonNullable<WarmupDeps["crypto"]> {
  if (!d.crypto) throw new AppError(SECRET_KEY_MISSING_MESSAGE, 503);
  return d.crypto;
}

type Linked = { service: MailReach; name: WarmupServiceName };

/** The service for an organisation's saved key, with which one it is, or null when it has none. */
async function serviceFor(d: WarmupDeps, organizationId: string): Promise<Linked | null> {
  const saved = await d.store.key(organizationId);
  if (!saved) return null;
  let plain: string;
  try {
    plain = await cryptoOf(d).decrypt(saved);
  } catch (e) {
    if (e instanceof AppError) throw e;
    // Saved under another server key: it cannot be read any more, so it has to be entered again.
    throw new AppError("The saved warm-up key can no longer be read. Add it again in Email, Settings.", 409);
  }
  const { service: name, key } = unpackKey(plain);
  return { service: d.service(key, name), name };
}

/** A failure of the service, as a sentence a person can act on. */
function problemOf(e: unknown, name: WarmupServiceName, onRefusedKey?: string): AppError {
  if (e instanceof AppError) return e;
  if (e instanceof MailReachError) {
    const words = wordsFor(name);
    if (e.status === 401 || e.status === 403) return new AppError(onRefusedKey ?? words.keyNoLonger, 409);
    return new AppError(words.unavailable, 502);
  }
  throw e;
}

const stateOf = (a: MrAccount): WarmupState => (!a.alive ? "disconnected" : a.suspended ? "paused" : !a.warmingEnabled ? "off" : "warming");

export const NOT_CONNECTED: WarmupMailbox = { state: "not_connected", score: null, days: null, sent: 0, spam: 0, spamPercent: null, ready: false };

/** What the page shows for one mailbox, from what the service reports. */
export function mailboxStatus(account: MrAccount, stats: { sent: number; spam: number; score?: number | null }, now: Date): WarmupMailbox {
  const state = stateOf(account);
  const started = account.createdAt ? Date.parse(account.createdAt) : NaN;
  const days = Number.isNaN(started) ? null : Math.max(0, Math.floor((now.getTime() - started) / 86_400_000));
  const spamPercent = stats.sent > 0 ? Math.round((stats.spam / stats.sent) * 1000) / 10 : null;
  const ready = state === "warming" && days !== null && days >= WARM_DAYS && stats.sent >= WARM_MIN_SENT && spamPercent !== null && spamPercent <= WARM_MAX_SPAM_PERCENT;
  // A service that gives its score with the figures (Mailivery) is believed over the list, which then has none.
  return { state, score: stats.score !== undefined ? stats.score : account.score, days, sent: stats.sent, spam: stats.spam, spamPercent, ready };
}

async function statusOf(d: WarmupDeps, service: MailReach, mailboxes: Mailbox[]): Promise<Record<string, WarmupMailbox>> {
  const byEmail = new Map((await service.accounts()).map((a) => [a.email, a]));
  const out: Record<string, WarmupMailbox> = {};
  await Promise.all(
    mailboxes.map(async (m) => {
      const account = byEmail.get(m.email);
      if (!account) {
        out[m.id] = NOT_CONNECTED;
        return;
      }
      // The figures are extra: a mailbox whose figures cannot be read is still shown with its state.
      const stats = await service.stats(account.id, PERIOD_DAYS).catch(() => ({ sent: 0, spam: 0 }));
      out[m.id] = mailboxStatus(account, stats, nowOf(d));
    }),
  );
  return out;
}

async function status(d: WarmupDeps, r: RouteRequest): Promise<RouteResult> {
  const role = isUuid(r.query.organizationId) ? await d.store.orgRole(r.query.organizationId, r.user.id) : null;
  if (!role || role === "viewer") throw new AppError(MEMBERS_ONLY_MESSAGE, 403);
  const organizationId = r.query.organizationId;
  const out: WarmupStatus = { linked: false, problem: null, periodDays: PERIOD_DAYS, mailboxes: {} };
  if (!(await d.store.tablesReady())) return { status: 200, json: { ...out, problem: TABLE_MISSING_MESSAGE } };
  let name: WarmupServiceName = "mailreach";
  try {
    const linked = await serviceFor(d, organizationId);
    if (!linked) return { status: 200, json: out };
    out.linked = true;
    out.service = name = linked.name;
    const mailboxes = await d.store.mailboxes(organizationId, isUuid(r.query.workspaceId) ? r.query.workspaceId : null);
    out.mailboxes = await statusOf(d, linked.service, mailboxes);
  } catch (e) {
    // The page still loads: it says what is wrong where the warm-up figures would be.
    out.problem = problemOf(e, name).message;
  }
  return { status: 200, json: out };
}

async function saveKey(d: WarmupDeps, r: RouteRequest): Promise<RouteResult> {
  const organizationId = await refuseUnlessAdmin(d, r.body.organizationId, r.user.id);
  // No service named: a page from before Mailivery could be chosen, which only knew MailReach.
  const name = (r.body.service === undefined ? "mailreach" : r.body.service) as WarmupServiceName;
  if (!WARMUP_SERVICES.includes(name)) throw new AppError(CHOOSE_SERVICE_MESSAGE, 400);
  const words = wordsFor(name);
  const apiKey = typeof r.body.apiKey === "string" ? r.body.apiKey.trim() : "";
  if (apiKey.length < 12 || apiKey.length > 300 || /\s/.test(apiKey)) throw new AppError(words.keyShape, 400);
  if (!(await d.store.tablesReady())) throw new AppError(TABLE_MISSING_MESSAGE, 503);
  const crypto = cryptoOf(d);
  let found: number;
  try {
    found = (await d.service(apiKey, name).accounts()).length;
  } catch (e) {
    throw problemOf(e, name, words.keyRefused);
  }
  await d.store.saveKey(organizationId, await crypto.encrypt(packKey(name, apiKey)), r.user.id);
  return { status: 200, json: { ok: true, inboxes: found } };
}

async function removeKey(d: WarmupDeps, r: RouteRequest): Promise<RouteResult> {
  const organizationId = await refuseUnlessAdmin(d, r.body.organizationId, r.user.id);
  await d.store.removeKey(organizationId);
  return { status: 200, json: { ok: true } };
}

/** The caller's own organisation's mailbox and its warm-up service. */
async function mailboxAndService(d: WarmupDeps, r: RouteRequest): Promise<{ mailbox: Mailbox; service: MailReach; name: WarmupServiceName }> {
  const mailbox = isUuid(r.body.mailboxId) ? await d.store.mailbox(r.body.mailboxId as string) : null;
  const role = mailbox ? await d.store.orgRole(mailbox.organizationId, r.user.id) : null;
  // Someone outside the organisation gets the same answer as for a mailbox that does not exist.
  if (!mailbox || !role) throw new AppError(MAILBOX_NOT_FOUND_MESSAGE, 404);
  if (role !== "owner" && role !== "admin") throw new AppError(OWNER_ONLY_MESSAGE, 403);
  const linked = await serviceFor(d, mailbox.organizationId);
  // Which of the two is not known while neither is connected: the sentence names no service then.
  if (!linked) throw new AppError(NOT_LINKED_MESSAGE, 409);
  return { mailbox, service: linked.service, name: linked.name };
}

const providerOf = (smtpHost: string): "gmail" | "outlook" | "custom" => {
  const host = smtpHost.toLowerCase();
  if (host.endsWith("gmail.com") || host.endsWith("googlemail.com")) return "gmail";
  if (host.endsWith("office365.com") || host.endsWith("outlook.com") || host.endsWith("live.com")) return "outlook";
  return "custom";
};

async function connect(d: WarmupDeps, r: RouteRequest): Promise<RouteResult> {
  const { mailbox, service, name } = await mailboxAndService(d, r);
  const words = wordsFor(name);
  if (!mailbox.imapHost) throw new AppError(NO_INBOX_MESSAGE, 409);
  const secret = await d.store.mailboxSecret(mailbox.id);
  if (!secret) throw new AppError(NO_PASSWORD_MESSAGE, 409);
  let password: string;
  try {
    password = await cryptoOf(d).decrypt(secret);
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError(NO_PASSWORD_MESSAGE, 409);
  }
  const [first, ...rest] = mailbox.fromName.trim().split(/\s+/).filter(Boolean);
  try {
    const account = await service.connect({
      email: mailbox.email,
      firstName: first || mailbox.email.split("@")[0],
      lastName: rest.join(" ") || "-",
      provider: providerOf(mailbox.smtpHost),
      username: mailbox.username,
      password,
      imapHost: mailbox.imapHost,
      imapPort: mailbox.imapPort ?? 993,
      smtpHost: mailbox.smtpHost,
      smtpPort: mailbox.smtpPort,
      smtpStartTls: !mailbox.smtpSecure,
    });
    return { status: 200, json: { mailbox: mailboxStatus(account, { sent: 0, spam: 0 }, nowOf(d)) } };
  } catch (e) {
    if (e instanceof MailReachError && e.status !== 0 && e.status !== 401 && e.status !== 403) {
      // The service names which of the two sign-ins failed.
      const inbox = e.detail.imap_auth_success;
      const sending = e.detail.smtp_auth_success;
      if (inbox === false || sending === false) throw new AppError(words.signInFailed(inbox !== false, sending !== false), 409);
      if (e.status === 402 || e.status === 422) throw new AppError(name === "mailreach" ? SEATS_MESSAGE : words.seats, 409);
    }
    throw problemOf(e, name);
  }
}

async function pause(d: WarmupDeps, r: RouteRequest): Promise<RouteResult> {
  const { mailbox, service, name } = await mailboxAndService(d, r);
  const paused = r.body.paused === true;
  try {
    const account = (await service.accounts()).find((a) => a.email === mailbox.email);
    if (!account) throw new AppError(wordsFor(name).notInService, 409);
    await service.suspend(account.id, paused);
    const stats = await service.stats(account.id, PERIOD_DAYS).catch(() => ({ sent: 0, spam: 0 }));
    return { status: 200, json: { mailbox: mailboxStatus({ ...account, suspended: paused }, stats, nowOf(d)) } };
  } catch (e) {
    throw problemOf(e, name);
  }
}

export async function route(d: WarmupDeps, r: RouteRequest): Promise<RouteResult> {
  try {
    if (r.action === "status" && r.method === "GET") return await status(d, r);
    if (r.action === "key" && r.method === "POST") return await saveKey(d, r);
    if (r.action === "key" && r.method === "DELETE") return await removeKey(d, r);
    if (r.action === "connect" && r.method === "POST") return await connect(d, r);
    if (r.action === "pause" && r.method === "POST") return await pause(d, r);
    return { status: 404, json: { error: "not found" } };
  } catch (e) {
    if (e instanceof AppError) return { status: e.status, json: { error: e.message } };
    throw e;
  }
}
