import { randomBytes, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { AppError } from "./errors.js";
import { newSecret, sha } from "./billing.js";
import { email, text } from "./validate.js";
import type { MailDeps } from "./mail.js";
import type { Workspace } from "./shared/types.js";
import type { EmailOAuth } from "./store.js";
import { refuseVerdict, spend as realSpend, workspaceLimitKey } from "./host/rateLimit.js";
import { isOwnOrigin } from "./host/origin.js";
import { decryptPassword, encryptPassword, KEY_UNAVAILABLE_MESSAGE } from "./mailbox/crypto.js";
import {
  authorizeUrl,
  CALLBACK_PATH,
  exchangeCode,
  isValidTenant,
  RECONNECT_MESSAGE,
  renewAccess,
  sendViaProvider,
  SIGN_IN_FAILED_MESSAGE,
  signedInAddress,
  WRONG_ADDRESS_MESSAGE,
  type OAuthApp,
  type Secrets,
} from "./workEmail.js";

/**
 * A workspace's Google or Microsoft 365 email connection: save the workspace's
 * own OAuth app (its client id and secret are typed in by an owner or admin),
 * sign in (PKCE, a single-use state bound to the browser), send a real
 * verification email and confirm its code. One row per workspace in
 * sr_email_oauth; the client secret and tokens are only ever ciphertext there
 * (SIGNROOM_MAIL_KEY, bound to the workspace id), and are never returned,
 * logged, or put into an error or a URL.
 */
/** The same sentence emailConnection.ts answers with; kept here so the two files do not import each other in a ring. */
export const SERVER_UNREACHABLE_MESSAGE = "We couldn't reach your mailbox's server. Please try again in a few minutes.";
export const OAUTH_TEST_TOOL = "signroom-email-test";
export const OAUTH_TEST_LIMIT = 3;
export const SAVE_OAUTH_FIRST_MESSAGE = "Save a Google or Microsoft configuration first.";
export const CLIENT_ID_MESSAGE = "Enter the OAuth application client ID from your provider.";
export const TENANT_MESSAGE = "Enter a valid Microsoft tenant ID or domain.";
export const TOO_LONG_MESSAGE = "Credential is too long.";
export const TEST_BEFORE_SIGN_IN_MESSAGE = "Complete provider sign-in before testing.";
export const TEST_FAILED_MESSAGE =
  "Connection test did not complete. Check SMTP host/TLS/credentials or provider consent. If a message arrived, check it before trying again.";
export const TEST_SENT_MESSAGE = "A real verification email was submitted to your saved work address. Enter its code here.";
export const CODE_EXPIRED_MESSAGE = "Verification code expired. Send a new test.";
export const CODE_WRONG_MESSAGE = "Incorrect verification code.";
export const RATE_MESSAGE = "Too many requests. Please try again later.";
export const CALLBACK_ORIGIN_MESSAGE = "OAuth callbacks must use this site's own address.";

/** The refusals inside the callback; the router turns every one into the `error` redirect. */
const SIGN_IN_EXPIRED_MESSAGE = "Email sign-in expired or was cancelled.";
const STATE_MESSAGE = "Invalid or expired email sign-in state.";
const CHANGED_MESSAGE = "Workspace or email configuration changed.";
const CONFIG_CHANGED_MESSAGE = "Email configuration changed.";

export const TEST_SUBJECT = "Verify your TaskCalendar email connection";
const testText = (code: string) =>
  `Your TaskCalendar verification code is ${code}. It expires in ten minutes.\n\nThis test was requested in your TaskCalendar document settings. No document or signing invitation is included.`;

const SIGN_IN_MS = 600_000;
const CODE_MS = 600_000;
const CODE_TRIES = 5;
const MAX_STATE = 200;
const MAX_CODE = 2048;
const MAX_BROWSER = 200;
const MAX_SECRET = 4096;

export type OAuthView = {
  configured: true;
  provider: "google" | "microsoft";
  status: "configured" | "authenticated" | "verified";
  mode: "live" | "platform";
  email: string;
  clientId: string;
  tenant: string;
  hasClientSecret: boolean;
  verifiedAt?: string;
  lastTestAt?: string;
  lastError?: string;
};

type Body = Record<string, unknown>;

const nowMs = (d: MailDeps) => (d.now ? d.now() : new Date()).getTime();
const nowIso = (d: MailDeps) => new Date(nowMs(d)).toISOString();
/** What each ciphertext is bound to: the workspace id, with a prefix so a secret and a verifier never decrypt as each other. */
const secretsAad = (workspaceId: string) => "oauth:" + workspaceId;
const verifierAad = (workspaceId: string) => "oauth-state:" + workspaceId;
const appOf = (c: EmailOAuth): OAuthApp => ({ provider: c.provider, clientId: c.clientId, tenant: c.tenant });

function needKey(d: MailDeps): Buffer {
  if (!d.key) throw new AppError(KEY_UNAVAILABLE_MESSAGE, 503);
  return d.key;
}

/** The decrypted secrets, or null when they do not decrypt (another key, another workspace, changed bytes). */
function readSecrets(key: Buffer, c: EmailOAuth): Secrets | null {
  const plain = decryptPassword(key, secretsAad(c.workspaceId), c.secretsEnc);
  if (plain === null) return null;
  try {
    const v = JSON.parse(plain) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Secrets) : null;
  } catch {
    return null;
  }
}

const sealSecrets = (key: Buffer, workspaceId: string, s: Secrets) => encryptPassword(key, secretsAad(workspaceId), JSON.stringify(s));

/** What the browser may see. A `reconnect` row reads as `configured` with its lastError, so sign-in is offered. */
export function oauthView(c: EmailOAuth, key: Buffer | null): OAuthView {
  const secrets = key ? readSecrets(key, c) : null;
  return {
    configured: true,
    provider: c.provider,
    status: c.status === "reconnect" ? "configured" : c.status,
    mode: c.status === "verified" ? "live" : "platform",
    email: c.email,
    clientId: c.clientId,
    tenant: c.tenant,
    hasClientSecret: !!secrets?.clientSecret,
    ...(c.verifiedAt ? { verifiedAt: c.verifiedAt } : {}),
    ...(c.lastTestAt ? { lastTestAt: c.lastTestAt } : {}),
    ...(c.lastError ? { lastError: c.lastError } : {}),
  };
}

/** The request's own allow-listed origin plus the fixed callback path, used exactly. */
export function redirectUriFor(origin: string): string {
  if (!isOwnOrigin(origin)) throw new AppError(CALLBACK_ORIGIN_MESSAGE, 400);
  return origin + CALLBACK_PATH;
}

/** Saves the Google or Microsoft app. Writes sr_email_oauth only; the SMTP mailbox is never touched. */
export async function saveOAuth(d: MailDeps, ws: Workspace, b: Body): Promise<OAuthView> {
  const provider = String(b.provider);
  if (provider !== "google" && provider !== "microsoft") throw new AppError("Choose a supported email provider.", 400);
  const address = email(b.email);
  const typedSecret = b.clientSecret ? String(b.clientSecret) : undefined;
  if ((typedSecret?.length || 0) > MAX_SECRET) throw new AppError(TOO_LONG_MESSAGE, 400);
  const clientId = text(b.clientId, 300);
  // Checked before trimming to length: a 101-character tenant is refused, not cut short.
  const rawTenant = provider === "microsoft" ? String(b.tenant || "organizations").trim() : "";
  if (provider === "microsoft" && !isValidTenant(rawTenant)) throw new AppError(TENANT_MESSAGE, 400);
  const tenant = text(rawTenant, 100);
  if (!clientId) throw new AppError(CLIENT_ID_MESSAGE, 400);
  const key = needKey(d);
  const workspaceId = ws.id;
  const old = await d.store.getEmailOAuth(workspaceId);
  // A blank secret keeps the stored one only for the very same app.
  const same = !!old && old.provider === provider && old.email === address && old.clientId === clientId && old.tenant === tenant;
  const prior = same && old ? readSecrets(key, old) : null;
  const clientSecret = typedSecret ?? prior?.clientSecret;
  const c: EmailOAuth = {
    workspaceId,
    id: randomUUID(),
    revision: (old?.revision || 0) + 1,
    provider,
    email: address,
    clientId,
    tenant,
    secretsEnc: sealSecrets(key, workspaceId, clientSecret ? { clientSecret } : {}),
    status: "configured",
  };
  await d.store.replaceEmailOAuth(c);
  return oauthView(c, key);
}

/**
 * A single-use sign-in, bound to the browser by `browser` (the router's cookie),
 * with PKCE. `userId` is the owner or admin starting it: the callback, which has
 * no sign-in of its own, checks that they still are one.
 */
export async function startAuthorization(d: MailDeps, ws: Workspace, userId: string, origin: string): Promise<{ url: string; browser: string }> {
  const c = await d.store.getEmailOAuth(ws.id);
  if (!c) throw new AppError(SAVE_OAUTH_FIRST_MESSAGE, 400);
  const redirectUri = redirectUriFor(origin);
  const key = needKey(d);
  const browser = newSecret();
  const state = newSecret();
  const verifier = randomBytes(48).toString("base64url");
  const url = authorizeUrl(appOf(c), redirectUri, state, verifier);
  await d.store.insertOAuthState({
    digest: sha(state),
    browserDigest: sha(browser),
    workspaceId: ws.id,
    userId,
    connectionId: c.id,
    revision: c.revision,
    verifierEnc: encryptPassword(key, verifierAad(ws.id), verifier),
    redirectUri,
    expires: nowMs(d) + SIGN_IN_MS,
  });
  return { url, browser };
}

const given = (v: unknown, max: number): v is string => typeof v === "string" && v.length > 0 && v.length <= max;

/**
 * The provider's redirect. Throws on every refusal (the router answers each
 * with the same `error` redirect); nothing is stored unless every check passes.
 */
export async function finishAuthorization(
  d: MailDeps,
  q: { state?: string; code?: string; browser?: string; error?: string },
): Promise<void> {
  if (q.error !== undefined && q.error !== "") throw new AppError(SIGN_IN_EXPIRED_MESSAGE, 400);
  if (!given(q.state, MAX_STATE) || !given(q.code, MAX_CODE) || !given(q.browser, MAX_BROWSER))
    throw new AppError(SIGN_IN_EXPIRED_MESSAGE, 400);
  const key = needKey(d);
  const a = await d.store.takeOAuthState(sha(q.state), sha(q.browser), nowMs(d));
  if (!a) throw new AppError(STATE_MESSAGE, 400);
  // The person who started the sign-in must still be an owner or admin of the workspace's organisation.
  const access = await d.store.workspaceAccess(a.workspaceId, a.userId);
  if (!access || (access.role !== "owner" && access.role !== "admin")) throw new AppError(CHANGED_MESSAGE, 403);
  const c = await d.store.getEmailOAuth(a.workspaceId);
  if (!c || c.id !== a.connectionId || c.revision !== a.revision) throw new AppError(CHANGED_MESSAGE, 403);
  const verifier = decryptPassword(key, verifierAad(a.workspaceId), a.verifierEnc);
  const stored = readSecrets(key, c);
  if (verifier === null || stored === null) throw new AppError(SIGN_IN_FAILED_MESSAGE, 400);

  let tokens: Awaited<ReturnType<typeof exchangeCode>>;
  let address: string;
  try {
    tokens = await exchangeCode(d.fetch, appOf(c), stored, q.code, a.redirectUri, verifier);
    address = await signedInAddress(d.fetch, c.provider, tokens.accessToken);
  } catch (e) {
    // A raw fetch error may carry a URL; only our own sentence leaves here.
    if (e instanceof AppError) throw e;
    throw new AppError(SIGN_IN_FAILED_MESSAGE, 400);
  }
  if (!address || address !== c.email.toLowerCase()) throw new AppError(WRONG_ADDRESS_MESSAGE, 400);

  const expiresIn = Number.isFinite(tokens.expiresIn) && tokens.expiresIn > 0 ? tokens.expiresIn : 3600;
  const next: Secrets = {
    ...stored,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expires: nowMs(d) + expiresIn * 1000,
  };
  const ok = await d.store.updateEmailOAuth(
    c.workspaceId,
    { id: c.id, revision: c.revision },
    { secretsEnc: sealSecrets(key, c.workspaceId, next), status: "authenticated", verifiedAt: null, challenge: null, lastError: null },
  );
  if (!ok) throw new AppError("Email configuration or owner access changed.", 409);
}

/**
 * A refused renewal, at the row's own id, revision and status, so a newer save
 * or sign-in is never overwritten. Only a row that was verified becomes
 * `reconnect` (the route that refuses sends until it is signed in again). A
 * row that was never verified is not a route and must never block mail: it
 * goes back to `configured` with that sentence, so sign-in is offered again.
 */
async function markReconnect(d: MailDeps, c: EmailOAuth): Promise<void> {
  const wasRoute = c.status === "verified" || c.status === "reconnect";
  await d.store.updateEmailOAuth(
    c.workspaceId,
    { id: c.id, revision: c.revision, status: c.status },
    { status: wasRoute ? "reconnect" : "configured", lastError: RECONNECT_MESSAGE },
  );
}

/**
 * The access token for a send: the stored one while it has over a minute
 * left, else a renewal stored at (id, revision), keeping the stored refresh
 * token when none comes back. A refused renewal, missing refresh token or
 * unreadable secrets marks a verified row `reconnect` and a never-verified one
 * `configured` (both 409, see markReconnect); an unreachable token endpoint
 * changes nothing (502).
 */
export async function accessFor(d: MailDeps, c: EmailOAuth): Promise<string> {
  const key = needKey(d);
  const stored = readSecrets(key, c);
  if (!stored) {
    await markReconnect(d, c);
    throw new AppError(RECONNECT_MESSAGE, 409);
  }
  if (stored.accessToken && (stored.expires || 0) > nowMs(d) + 60_000) return stored.accessToken;
  const renewal = await renewAccess(d.fetch, appOf(c), stored);
  if (renewal.kind === "refused") {
    await markReconnect(d, c);
    throw new AppError(RECONNECT_MESSAGE, 409);
  }
  if (renewal.kind === "unreachable") throw new AppError(SERVER_UNREACHABLE_MESSAGE, 502);
  const expiresIn = Number.isFinite(renewal.expiresIn) && renewal.expiresIn > 0 ? renewal.expiresIn : 3600;
  const next: Secrets = {
    ...stored,
    accessToken: renewal.accessToken,
    refreshToken: renewal.refreshToken || stored.refreshToken,
    expires: nowMs(d) + expiresIn * 1000,
  };
  const ok = await d.store.updateEmailOAuth(c.workspaceId, { id: c.id, revision: c.revision }, { secretsEnc: sealSecrets(key, c.workspaceId, next) });
  if (!ok) throw new AppError(CONFIG_CHANGED_MESSAGE, 409);
  return renewal.accessToken;
}

/** Clears the challenge only while it is still this code's (and no guess has moved it on). */
async function clearChallenge(d: MailDeps, c: EmailOAuth, digest: string): Promise<void> {
  try {
    const current = await d.store.getEmailOAuth(c.workspaceId);
    if (!current || current.id !== c.id || current.revision !== c.revision || current.challenge?.digest !== digest) return;
    await d.store.updateEmailOAuth(c.workspaceId, { id: c.id, revision: c.revision, attempts: current.challenge.attempts }, { challenge: null });
  } catch (e) {
    console.error("[signroom-email] could not clear the test code", e instanceof Error ? e.name : "error");
  }
}

/** A real email with a six-digit code to the saved address, through the provider. Three an hour per workspace. */
export async function testOAuth(d: MailDeps, ws: Workspace): Promise<{ ok: true; message: string }> {
  needKey(d);
  const c = await d.store.getEmailOAuth(ws.id);
  if (!c) throw new AppError(SAVE_OAUTH_FIRST_MESSAGE, 400);
  if (c.status === "configured" || c.status === "reconnect") throw new AppError(TEST_BEFORE_SIGN_IN_MESSAGE, 400);
  refuseVerdict(await (d.spend ?? realSpend)(d.sb, OAUTH_TEST_TOOL, workspaceLimitKey(ws.id), OAUTH_TEST_LIMIT, 60), () => RATE_MESSAGE);
  const code = String(randomInt(100000, 1000000));
  const digest = sha(code);
  const set = await d.store.updateEmailOAuth(
    c.workspaceId,
    { id: c.id, revision: c.revision },
    { challenge: { digest, expires: nowMs(d) + CODE_MS, attempts: 0 } },
  );
  if (!set) throw new AppError(CONFIG_CHANGED_MESSAGE, 409);
  try {
    const token = await accessFor(d, c);
    await sendViaProvider(
      d.fetch,
      c.provider,
      token,
      { name: "", address: c.email },
      { to: c.email, subject: TEST_SUBJECT, text: testText(code), replyTo: "" },
      randomBytes(16).toString("hex"),
    );
  } catch (e) {
    console.error("[signroom-email] test failed", e instanceof Error ? e.name : "error");
    await clearChallenge(d, c, digest);
    throw new AppError(TEST_FAILED_MESSAGE, 502);
  }
  await d.store.updateEmailOAuth(c.workspaceId, { id: c.id, revision: c.revision }, { lastTestAt: nowIso(d) });
  return { ok: true, message: TEST_SENT_MESSAGE };
}

function sameDigest(a: string, b: string): boolean {
  const x = Buffer.from(a, "utf8");
  const y = Buffer.from(b, "utf8");
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Five tries, each counted by a compare-and-set before the code is compared. */
export async function confirmOAuth(d: MailDeps, ws: Workspace, code: unknown): Promise<OAuthView> {
  const c = await d.store.getEmailOAuth(ws.id);
  const ch = c?.challenge;
  if (!c || !ch || ch.expires < nowMs(d) || ch.attempts >= CODE_TRIES || c.status === "configured" || c.status === "reconnect")
    throw new AppError(CODE_EXPIRED_MESSAGE, 400);
  const tried = { ...ch, attempts: ch.attempts + 1 };
  const counted = await d.store.updateEmailOAuth(c.workspaceId, { id: c.id, revision: c.revision, attempts: ch.attempts }, { challenge: tried });
  if (!counted) throw new AppError(CODE_EXPIRED_MESSAGE, 400);
  const typed = typeof code === "string" || typeof code === "number" ? String(code).trim() : "";
  if (!typed || typed.length > 20 || !sameDigest(sha(typed), ch.digest)) throw new AppError(CODE_WRONG_MESSAGE, 400);
  const verifiedAt = nowIso(d);
  const done = await d.store.updateEmailOAuth(
    c.workspaceId,
    { id: c.id, revision: c.revision, attempts: tried.attempts },
    { status: "verified", verifiedAt, challenge: null, lastError: null },
  );
  if (!done) throw new AppError(CODE_EXPIRED_MESSAGE, 400);
  const now = await d.store.getEmailOAuth(ws.id);
  return oauthView(now ?? { ...c, status: "verified", verifiedAt, challenge: undefined, lastError: undefined }, d.key ?? null);
}
