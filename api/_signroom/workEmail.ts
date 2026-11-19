import { AppError } from "./errors.js";
import { sha } from "./billing.js";
import { email } from "./validate.js";

/**
 * The provider half of a Google or Microsoft email connection: the sign-in
 * and the sending requests. Pure of storage; every request
 * goes through `providerFetch` with an injected `fetch`. No token, secret,
 * code, verifier or response body is ever put into an error.
 */
export const CALLBACK_PATH = "/api/signroom/email-connection/callback";
export const SCOPES = {
  google: "openid email https://www.googleapis.com/auth/gmail.send",
  microsoft:
    "openid profile offline_access https://graph.microsoft.com/User.Read https://graph.microsoft.com/Mail.Send",
};
export const PROVIDER_HOSTS: ReadonlyArray<string> = Object.freeze([
  "oauth2.googleapis.com",
  "openidconnect.googleapis.com",
  "gmail.googleapis.com",
  "login.microsoftonline.com",
  "graph.microsoft.com",
]);
export const TENANT_PATTERN = /^(organizations|common|consumers|[a-zA-Z0-9.-]+)$/;

export const RECONNECT_MESSAGE = "Email authorisation expired or was revoked. Reconnect the provider.";
export const SIGN_IN_AGAIN_MESSAGE = "Sign in to your email provider again.";
export const SIGN_IN_FAILED_MESSAGE =
  "Provider sign-in could not be completed. Check the app registration and try again.";
export const WRONG_ADDRESS_MESSAGE = "Sign in with the exact work address saved in Settings.";
export const PROVIDER_UNCONFIRMED_MESSAGE =
  "Provider did not confirm acceptance. Check Sent mail before retrying.";
const TENANT_MESSAGE = "Enter a valid Microsoft tenant ID or domain.";

export type Secrets = { clientSecret?: string; accessToken?: string; refreshToken?: string; expires?: number };
export type OAuthApp = { provider: "google" | "microsoft"; clientId: string; tenant: string };

/** The tenant rule, minus the values that would climb or end a path ("." and ".."). */
export function isValidTenant(tenant: string): boolean {
  return (
    tenant.length > 0 &&
    tenant.length <= 100 &&
    TENANT_PATTERN.test(tenant) &&
    !tenant.includes("..") &&
    !tenant.startsWith(".") &&
    !tenant.endsWith(".")
  );
}

export async function providerFetch(f: typeof fetch, url: string, init?: RequestInit): Promise<Response> {
  const u = new URL(url);
  if (u.protocol !== "https:" || u.username || u.password || !PROVIDER_HOSTS.includes(u.hostname))
    throw new Error("Unapproved email API endpoint");
  return f(url, { ...init, redirect: "error", signal: AbortSignal.timeout(20000) });
}

function tenantOf(app: OAuthApp): string {
  if (!isValidTenant(app.tenant)) throw new AppError(TENANT_MESSAGE, 400);
  return app.tenant;
}
function tokenUrl(app: OAuthApp): string {
  return app.provider === "google"
    ? "https://oauth2.googleapis.com/token"
    : `https://login.microsoftonline.com/${tenantOf(app)}/oauth2/v2.0/token`;
}

export function authorizeUrl(app: OAuthApp, redirectUri: string, state: string, verifier: string): string {
  const url = new URL(
    app.provider === "google"
      ? "https://accounts.google.com/o/oauth2/v2/auth"
      : `https://login.microsoftonline.com/${tenantOf(app)}/oauth2/v2.0/authorize`,
  );
  url.search = new URLSearchParams({
    client_id: app.clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPES[app.provider],
    state,
    code_challenge: Buffer.from(sha(verifier), "hex").toString("base64url"),
    code_challenge_method: "S256",
    ...(app.provider === "google" ? { access_type: "offline", prompt: "consent" } : {}),
  }).toString();
  return url.toString();
}

async function readJson(r: Response): Promise<Record<string, unknown> | null> {
  try {
    const d = await r.json();
    return d && typeof d === "object" ? (d as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export async function exchangeCode(
  f: typeof fetch,
  app: OAuthApp,
  secrets: Secrets,
  code: string,
  redirectUri: string,
  verifier: string,
): Promise<{ accessToken: string; refreshToken?: string; expiresIn: number }> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    client_id: app.clientId,
    redirect_uri: redirectUri,
    code_verifier: verifier,
  });
  if (secrets.clientSecret) body.set("client_secret", secrets.clientSecret);
  let data: Record<string, unknown> | null = null;
  let ok = false;
  try {
    const response = await providerFetch(f, tokenUrl(app), { method: "POST", body });
    ok = response.ok;
    data = await readJson(response);
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError(SIGN_IN_FAILED_MESSAGE, 400);
  }
  if (!ok || !data || typeof data.access_token !== "string" || !data.access_token)
    throw new AppError(SIGN_IN_FAILED_MESSAGE, 400);
  return {
    accessToken: data.access_token,
    refreshToken: typeof data.refresh_token === "string" && data.refresh_token ? data.refresh_token : undefined,
    expiresIn: Number(data.expires_in || 3600),
  };
}

export async function signedInAddress(
  f: typeof fetch,
  provider: "google" | "microsoft",
  accessToken: string,
): Promise<string> {
  const info = await providerFetch(
    f,
    provider === "google"
      ? "https://openidconnect.googleapis.com/v1/userinfo"
      : "https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName",
    { headers: { Authorization: "Bearer " + accessToken } },
  );
  if (!info.ok) return "";
  const identity = (await readJson(info)) ?? {};
  return String(identity.email || identity.mail || identity.userPrincipalName || "").toLowerCase();
}

export type Renewal =
  | { kind: "ok"; accessToken: string; refreshToken?: string; expiresIn: number }
  | { kind: "refused" }
  | { kind: "unreachable" };

export async function renewAccess(f: typeof fetch, app: OAuthApp, secrets: Secrets): Promise<Renewal> {
  if (!secrets.refreshToken) return { kind: "refused" };
  if (app.provider === "microsoft" && !isValidTenant(app.tenant)) return { kind: "refused" };
  const body = new URLSearchParams({
    client_id: app.clientId,
    grant_type: "refresh_token",
    refresh_token: secrets.refreshToken,
  });
  if (secrets.clientSecret) body.set("client_secret", secrets.clientSecret);
  if (app.provider === "microsoft") body.set("scope", SCOPES.microsoft);
  try {
    const response = await providerFetch(f, tokenUrl(app), { method: "POST", body });
    if (response.status === 400 || response.status === 401) return { kind: "refused" };
    if (!response.ok) return { kind: "unreachable" };
    const data = await readJson(response);
    if (!data || typeof data.access_token !== "string" || !data.access_token) return { kind: "unreachable" };
    return {
      kind: "ok",
      accessToken: data.access_token,
      refreshToken: typeof data.refresh_token === "string" && data.refresh_token ? data.refresh_token : undefined,
      expiresIn: Number(data.expires_in || 3600),
    };
  } catch {
    return { kind: "unreachable" };
  }
}

const b64 = (s: string) => Buffer.from(s).toString("base64");

/**
 * The Gmail message, with the sender name encoded and every address validated
 * (no CR/LF reaches a header). The Message-ID is the delivery's id at the
 * sender's own domain.
 */
function rawMessage(
  from: { name: string; address: string },
  m: { to: string; subject: string; text: string; replyTo: string },
  id: string,
): string {
  if (!/^[A-Za-z0-9._-]+$/.test(id)) throw new AppError("Invalid message id.", 400);
  const sender = email(from.address);
  const to = email(m.to);
  const reply = m.replyTo ? email(m.replyTo) : sender;
  const name = from.name.replace(/[\r\n]/g, " ").trim();
  return [
    `From: ${name ? `=?UTF-8?B?${b64(name)}?= ` : ""}<${sender}>`,
    `To: ${to}`,
    `Reply-To: ${reply}`,
    `Subject: =?UTF-8?B?${b64(m.subject)}?=`,
    `Message-ID: <${id}@${sender.slice(sender.lastIndexOf("@") + 1)}>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    b64(m.text).match(/.{1,76}/g)?.join("\r\n") || "",
  ].join("\r\n");
}

export async function sendViaProvider(
  f: typeof fetch,
  provider: "google" | "microsoft",
  accessToken: string,
  from: { name: string; address: string },
  m: { to: string; subject: string; text: string; replyTo: string },
  messageId: string,
): Promise<void> {
  m = { ...m, subject: m.subject.replace(/\r\n|[\r\n]/g, " ") };
  const sender = email(from.address);
  const to = email(m.to);
  const reply = m.replyTo ? email(m.replyTo) : sender;
  const payload =
    provider === "google"
      ? { raw: Buffer.from(rawMessage(from, m, messageId)).toString("base64url") }
      : {
          message: {
            subject: m.subject,
            body: { contentType: "Text", content: m.text },
            toRecipients: [{ emailAddress: { address: to } }],
            replyTo: [{ emailAddress: { address: reply } }],
          },
          saveToSentItems: true,
        };
  const response = await providerFetch(
    f,
    provider === "google"
      ? "https://gmail.googleapis.com/gmail/v1/users/me/messages/send"
      : "https://graph.microsoft.com/v1.0/me/sendMail",
    {
      method: "POST",
      headers: { Authorization: "Bearer " + accessToken, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
  );
  if (!response.ok) throw new AppError(PROVIDER_UNCONFIRMED_MESSAGE, 502);
}
