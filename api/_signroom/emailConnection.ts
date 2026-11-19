import { AppError, StoreError } from "./errors.js";
import { currentWorkspace, type SignedInUser } from "./context.js";
import { brandingOf } from "./branding.js";
import type { MailDeps } from "./mail.js";
import { refuseSendLimits } from "./mailLimits.js";
import type { Workspace } from "./shared/types.js";
import type { Store } from "./store.js";
import { setupSentence } from "./setupMessages.js";
import { minutes, refuseVerdict, spend as realSpend, UNAVAILABLE_MESSAGE, workspaceLimitKey } from "./host/rateLimit.js";
import { isOwnOrigin } from "./host/origin.js";
import { decryptPassword, encryptPassword, KEY_UNAVAILABLE_MESSAGE } from "./mailbox/crypto.js";
import { buildTestEmail } from "./mailbox/content.js";
import { mapSmtpError, scrubForLog } from "./mailbox/errors.js";
import { InputError, MAILBOX_MESSAGES, parseSaveInput, passwordReusable } from "./mailbox/settings.js";
import { resolvePublic, systemLookup } from "./mailbox/ssrf.js";
import type { MailboxRow } from "./mailbox/store.js";
import { nodemailerTransport, type OutgoingMail, type Transport } from "./mailbox/transport.js";
import {
  CODE_EXPIRED_MESSAGE,
  confirmOAuth,
  oauthView,
  redirectUriFor,
  saveOAuth,
  startAuthorization,
  testOAuth,
  type OAuthView,
} from "./oauthConnection.js";

/**
 * A workspace's own email connection: an SMTP mailbox with a password or app
 * password (here), or a Google or Microsoft sign-in (oauthConnection.ts). One
 * connection per workspace, keyed by the workspace id, and only an owner or
 * admin of the workspace's organisation may see or change it. The password is
 * stored encrypted (SIGNROOM_MAIL_KEY, bound to the workspace id) and is never
 * returned or logged.
 */
export const VERIFY_TOOL = "mailbox-verify";
export const VERIFY_LIMIT = 10;
export const OWNER_ONLY_MESSAGE = "Only a workspace owner or admin can change its email connection.";
export const SAVE_FIRST_MESSAGE = "Save your email settings first.";
export const NOT_CONNECTED_MESSAGE = "Connect and verify your mailbox first.";
/** The saved password no longer decrypts (the key changed): the mailbox stops counting as verified. */
export const PASSWORD_UNREADABLE_MESSAGE = "Enter your mailbox password again.";
export const SETTINGS_CHANGED_MESSAGE = "Your email settings changed while we were checking them. Please try again.";
export const MAILBOX_REFUSED_MESSAGE = "Your mailbox refused the password. Check the email connection in Document settings.";
export const SERVER_UNREACHABLE_MESSAGE = "We couldn't reach your mailbox's server. Please try again in a few minutes.";
export const MAILBOX_SEND_FAILED_MESSAGE = "Your mailbox couldn't send this email. Please try again.";

type Body = Record<string, unknown>;
type LoginResult = { verified: true; verifiedAt: string } | { verified: false; error: string };

/**
 * What the screen may see of an SMTP mailbox. `mode` is "live" when mail really
 * goes from this mailbox, "platform" when it goes from the platform's address.
 */
export type EmailConnectionView = {
  configured: boolean;
  provider: "smtp" | "google" | "microsoft";
  status: "verified" | "configured" | "none";
  mode: "live" | "platform";
  email?: string;
  host?: string;
  port?: number;
  username?: string;
  security?: string;
  preset?: string;
  verifiedAt?: string;
  lastError?: string;
};

const now = (d: MailDeps) => (d.now ? d.now() : new Date());
const spendOf = (d: MailDeps) => d.spend ?? realSpend;

/** 10 checks of the settings an hour, per workspace. */
async function refuseVerifyLimit(d: MailDeps, workspaceId: string): Promise<void> {
  refuseVerdict(
    await spendOf(d)(d.sb, VERIFY_TOOL, workspaceLimitKey(workspaceId), VERIFY_LIMIT, 60),
    (m) => `You've checked your email settings ${VERIFY_LIMIT} times this hour. Try again in ${minutes(m)}.`,
  );
}

function needKey(d: MailDeps): Buffer {
  if (!d.key) throw new AppError(KEY_UNAVAILABLE_MESSAGE, 503);
  return d.key;
}

/** Resolves the server once and opens a transport pinned to its public address. The caller must close() it. */
export async function openTransport(
  d: MailDeps,
  row: MailboxRow,
  password: string,
): Promise<{ ok: true; transport: Transport } | { ok: false; message: string }> {
  const target = await resolvePublic(row.host, d.lookup ?? systemLookup);
  if (target.ok === false) return { ok: false, message: target.message };
  const transport = (d.transport ?? nodemailerTransport)({
    host: row.host,
    address: target.address,
    port: row.port,
    security: row.security,
    username: row.username,
    password,
  });
  return { ok: true, transport };
}

/** Why the settings can't log in with `password`, as a plain sentence, or null when they can. Sends nothing. */
async function loginProblem(d: MailDeps, row: MailboxRow, password: string): Promise<string | null> {
  const open = await openTransport(d, row, password);
  if (open.ok === false) return open.message;
  try {
    await open.transport.verify();
    return null;
  } catch (e) {
    console.error("[signroom-mailbox] verify failed", scrubForLog(e, password, row.username));
    return mapSmtpError(e, row.provider).message;
  } finally {
    open.transport.close();
  }
}

/** Logs in with the row's settings and records the result on that same row. */
async function checkLogin(d: MailDeps, row: MailboxRow, password: string): Promise<LoginResult> {
  const error = await loginProblem(d, row, password);
  const verifiedAt = now(d).toISOString();
  let marked: boolean;
  try {
    marked = await d.store.markMailbox(row, error === null ? { verified_at: verifiedAt, last_error: null } : { verified_at: null, last_error: error });
  } catch (e) {
    if (error === null) throw e;
    console.error("[signroom-mailbox] could not record the failed login", e instanceof Error ? e.name : "error");
    return { verified: false, error };
  }
  if (!marked) return { verified: false, error: SETTINGS_CHANGED_MESSAGE };
  return error === null ? { verified: true, verifiedAt } : { verified: false, error };
}

/** A saved password that no longer decrypts (the key changed) unverifies the row it is on. */
export async function markUnreadable(store: Store, row: MailboxRow): Promise<void> {
  try {
    await store.markMailbox(row, { verified_at: null, last_error: PASSWORD_UNREADABLE_MESSAGE });
  } catch (e) {
    // Best effort: the caller carries on without this mailbox either way.
    console.error("[signroom-mailbox] could not record the unreadable password", e instanceof Error ? e.name : "error");
  }
}

export function viewOf(row: MailboxRow | null): EmailConnectionView {
  if (!row) return { configured: false, provider: "smtp", status: "none", mode: "platform" };
  const verified = !!row.verified_at;
  return {
    configured: true,
    provider: "smtp",
    status: verified ? "verified" : "configured",
    mode: verified ? "live" : "platform",
    email: row.from_email,
    host: row.host,
    port: row.port,
    username: row.username,
    security: row.security,
    preset: row.provider,
    ...(row.verified_at ? { verifiedAt: row.verified_at } : {}),
    ...(row.last_error ? { lastError: row.last_error } : {}),
  };
}

/** The sign-in a request is handling, so that whatever it throws is logged without it. */
type Held = { password: string; username: string };

async function deliverTest(d: MailDeps, row: MailboxRow, password: string, mail: OutgoingMail): Promise<void> {
  const open = await openTransport(d, row, password);
  if (open.ok === false) throw new AppError(SERVER_UNREACHABLE_MESSAGE, 502);
  try {
    await open.transport.send(mail);
  } catch (e) {
    console.error("[signroom-mailbox] test failed", scrubForLog(e, password, row.username));
    const failure = mapSmtpError(e, row.provider);
    if (failure.kind === "auth" || failure.kind === "blocked") {
      try {
        await d.store.markMailbox(row, { verified_at: null, last_error: failure.message });
      } catch {
        // Recording is best effort; the refusal below is the answer.
      }
      throw new AppError(MAILBOX_REFUSED_MESSAGE, 502);
    }
    throw new AppError(failure.kind === "unreachable" ? SERVER_UNREACHABLE_MESSAGE : MAILBOX_SEND_FAILED_MESSAGE, 502);
  } finally {
    open.transport.close();
  }
}

export type EmailAction = "view" | "save" | "test" | "disconnect" | "verify" | "authorize" | "confirm";

/**
 * What the panel shows: the Google or Microsoft row when there is one, else
 * the SMTP mailbox, with the redirect URI to register at the provider.
 * `smtpKept` says an SMTP mailbox is stored behind the Google or Microsoft row;
 * `smtpKeptVerified` says it can send (verified, and the mail key present).
 * `available` is false while SIGNROOM_MAIL_KEY is not set: a connection can be
 * looked at but not saved, tested or used, and mail goes from the platform.
 */
export type EmailConnectionFullView = (EmailConnectionView | OAuthView) & {
  smtpKept: boolean;
  smtpKeptVerified: boolean;
  callbackUri: string;
  available: boolean;
};

async function fullView(d: MailDeps, workspaceId: string, origin: string): Promise<EmailConnectionFullView> {
  const oauth = await d.store.getEmailOAuth(workspaceId);
  const mailbox = await d.store.getMailbox(workspaceId);
  const callbackUri = isOwnOrigin(origin) ? redirectUriFor(origin) : "";
  const available = !!d.key;
  // Without the key nothing can be decrypted, so nothing goes from the workspace's own mailbox.
  const platform = <V extends EmailConnectionView | OAuthView>(v: V): V => (available ? v : { ...v, mode: "platform" });
  if (oauth) return { ...platform(oauthView(oauth, d.key ?? null)), smtpKept: !!mailbox, smtpKeptVerified: !!mailbox?.verified_at && available, callbackUri, available };
  return { ...platform(viewOf(mailbox)), smtpKept: false, smtpKeptVerified: false, callbackUri, available };
}

async function run(d: MailDeps, ws: Workspace, user: SignedInUser, action: EmailAction, body: Body, held: Held, origin: string): Promise<unknown> {
  const wsId = ws.id;
  if (action === "view") return fullView(d, wsId, origin);

  if (action === "save" && (body.provider === "google" || body.provider === "microsoft")) {
    await saveOAuth(d, ws, body);
    return { verified: false, view: await fullView(d, wsId, origin) };
  }
  if (action === "authorize") return startAuthorization(d, ws, user.id, origin);

  const oauth = await d.store.getEmailOAuth(wsId);
  if (action === "confirm") {
    if (!oauth) throw new AppError(CODE_EXPIRED_MESSAGE, 400);
    return confirmOAuth(d, ws, body.code);
  }

  if (action === "disconnect") {
    // With a Google or Microsoft row, only it (and its pending sign-ins) goes; the SMTP mailbox is the route again.
    if (oauth) await d.store.deleteEmailOAuth(wsId);
    else await d.store.deleteMailbox(wsId);
    return { ok: true };
  }

  if (action === "test" && oauth) return testOAuth(d, ws);
  if (action === "verify" && oauth) throw new AppError("Email connection action not found.", 404);

  if (action === "save") {
    const input = parseSaveInput(body);
    if (input.password !== null) {
      held.password = input.password;
      held.username = input.username;
    }
    const key = needKey(d);
    const stored = await d.store.getMailbox(wsId);
    let passwordEnc: string;
    let password: string;
    if (input.password !== null) {
      password = input.password;
      passwordEnc = encryptPassword(key, wsId, password);
    } else {
      const reused = stored && passwordReusable(input, stored) ? decryptPassword(key, wsId, stored.password_enc) : null;
      if (reused === null || !stored) throw new InputError(MAILBOX_MESSAGES.password);
      held.password = reused;
      held.username = input.username;
      password = reused;
      passwordEnc = stored.password_enc;
    }
    await refuseVerifyLimit(d, wsId);
    const row: MailboxRow = {
      workspace_id: wsId,
      provider: input.provider,
      host: input.host,
      port: input.port,
      security: input.security,
      username: input.username,
      from_email: input.fromEmail,
      password_enc: passwordEnc,
      verified_at: null,
      last_error: null,
    };
    await d.store.upsertMailbox({ ...row, updated_at: now(d).toISOString() });
    // Saving the SMTP form is the explicit switch back from Google or Microsoft.
    await d.store.deleteEmailOAuth(wsId);
    const login = await checkLogin(d, row, password);
    return { ...login, view: await fullView(d, wsId, origin) };
  }

  if (action === "verify") {
    const key = needKey(d);
    const row = await d.store.getMailbox(wsId);
    if (!row) throw new AppError(SAVE_FIRST_MESSAGE, 409);
    // Decrypt first: a password that can't be read can't be checked, so no attempt is spent on it.
    const password = decryptPassword(key, wsId, row.password_enc);
    if (password === null) {
      await markUnreadable(d.store, row);
      return { verified: false, error: PASSWORD_UNREADABLE_MESSAGE };
    }
    held.password = password;
    held.username = row.username;
    await refuseVerifyLimit(d, wsId);
    return checkLogin(d, row, password);
  }

  if (action === "test") {
    const key = needKey(d);
    const row = await d.store.getMailbox(wsId);
    if (!row || !row.verified_at) throw new AppError(NOT_CONNECTED_MESSAGE, 409);
    const password = decryptPassword(key, wsId, row.password_enc);
    if (password === null) {
      await markUnreadable(d.store, row);
      throw new AppError(NOT_CONNECTED_MESSAGE, 409);
    }
    held.password = password;
    held.username = row.username;
    // The test email is a real email: it counts against the workspace's own sending limits.
    await refuseSendLimits(d, ws);
    await deliverTest(d, row, password, buildTestEmail(brandingOf(ws).companyName, row.from_email));
    return { ok: true };
  }

  throw new AppError("Email connection action not found.", 404);
}

/**
 * The workspace's email connection: view, save (and log in), verify, test,
 * disconnect, and for Google or Microsoft authorize and confirm. For an owner
 * or admin of the workspace's organisation only, every action including view.
 * `origin` is the request's (already checked) origin, used for the OAuth
 * redirect URI. A database error that means migration 186 has not been run
 * becomes the sentence naming that file; any other becomes a 503.
 */
export async function emailConnectionAction(
  deps: MailDeps,
  user: SignedInUser,
  action: EmailAction,
  body: Body = {},
  origin = "",
): Promise<unknown> {
  const { workspace, role } = await currentWorkspace(deps.store, user);
  if (role !== "Owner") throw new AppError(OWNER_ONLY_MESSAGE, 403);
  const held: Held = { password: "", username: "" };
  try {
    return await run(deps, workspace, user, action, body, held, origin);
  } catch (e) {
    if (e instanceof InputError) throw new AppError(e.message, 400);
    if (e instanceof StoreError) {
      const setup = setupSentence(e.message);
      if (setup) throw new AppError(setup, 503);
      // The name only: a database error's text can carry a row's values.
      console.error("[signroom-mailbox] database", e.name);
      throw new AppError(UNAVAILABLE_MESSAGE, 503);
    }
    throw e;
  }
}
