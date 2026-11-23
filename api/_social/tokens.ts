import type { PublishDeps } from "./publishers.js";

/**
 * The key of a connected account. Facebook and Instagram give a Page token
 * that lasts; YouTube, TikTok and X give one that runs out within hours, with
 * a second, lasting token to ask for a new one. Both kinds are kept (encrypted)
 * as one text: a bare token, or JSON with the token, the refresh token and when
 * the token runs out.
 */
export type AccountSecret = { accessToken: string; refreshToken?: string; expiresAt?: number };

export function readSecret(plain: string): AccountSecret {
  const text = plain.trim();
  if (text.startsWith("{")) {
    try {
      const j = JSON.parse(text) as Record<string, unknown>;
      const accessToken = typeof j.accessToken === "string" ? j.accessToken : "";
      const refreshToken = typeof j.refreshToken === "string" && j.refreshToken ? j.refreshToken : undefined;
      const expiresAt = typeof j.expiresAt === "number" && Number.isFinite(j.expiresAt) ? j.expiresAt : undefined;
      return { accessToken, ...(refreshToken ? { refreshToken } : {}), ...(expiresAt ? { expiresAt } : {}) };
    } catch {
      return { accessToken: "" };
    }
  }
  return { accessToken: text };
}

export const writeSecret = (secret: AccountSecret): string =>
  secret.refreshToken || secret.expiresAt ? JSON.stringify(secret) : secret.accessToken;

/** A token with a refresh token is renewed when it has run out, is about to, or was never used here. */
export function isStale(secret: AccountSecret, now: number): boolean {
  if (!secret.refreshToken) return false;
  return !secret.accessToken || !secret.expiresAt || secret.expiresAt - now < 2 * 60_000;
}

type Asker = { url: string; headers?: Record<string, string>; form: Record<string, string> };

/** How each platform is asked for a new token. Null when the platform has none to give, or the app's own keys are not set. */
function refreshRequest(provider: string, refreshToken: string, env: PublishDeps["env"]): Asker | null {
  const set = (name: string) => (env[name] ?? "").trim();
  if (provider === "youtube") {
    if (!set("GOOGLE_CLIENT_ID") || !set("GOOGLE_CLIENT_SECRET")) return null;
    return {
      url: "https://oauth2.googleapis.com/token",
      form: { client_id: set("GOOGLE_CLIENT_ID"), client_secret: set("GOOGLE_CLIENT_SECRET"), refresh_token: refreshToken, grant_type: "refresh_token" },
    };
  }
  if (provider === "tiktok") {
    if (!set("TIKTOK_CLIENT_KEY") || !set("TIKTOK_CLIENT_SECRET")) return null;
    return {
      url: "https://open.tiktokapis.com/v2/oauth/token/",
      form: { client_key: set("TIKTOK_CLIENT_KEY"), client_secret: set("TIKTOK_CLIENT_SECRET"), refresh_token: refreshToken, grant_type: "refresh_token" },
    };
  }
  if (provider === "x") {
    if (!set("X_CLIENT_ID")) return null;
    const basic = set("X_CLIENT_SECRET") ? { Authorization: `Basic ${Buffer.from(`${set("X_CLIENT_ID")}:${set("X_CLIENT_SECRET")}`).toString("base64")}` } : undefined;
    return { url: "https://api.x.com/2/oauth2/token", headers: basic, form: { client_id: set("X_CLIENT_ID"), refresh_token: refreshToken, grant_type: "refresh_token" } };
  }
  return null;
}

/**
 * A new token for the account, or null when one cannot be had (no refresh
 * token, the app's keys are not set, or the platform said no). The platform's
 * answer is never passed on.
 */
export async function refreshSecret(d: Pick<PublishDeps, "fetch" | "env">, provider: string, secret: AccountSecret, now: number): Promise<AccountSecret | null> {
  if (!secret.refreshToken) return null;
  const ask = refreshRequest(provider, secret.refreshToken, d.env);
  if (!ask) return null;
  try {
    const response = await d.fetch(ask.url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", ...(ask.headers ?? {}) },
      body: new URLSearchParams(ask.form).toString(),
    });
    if (!response.ok) return null;
    const j = (await response.json()) as Record<string, unknown>;
    const accessToken = typeof j.access_token === "string" ? j.access_token : "";
    if (!accessToken) return null;
    const seconds = Number(j.expires_in);
    return {
      accessToken,
      // TikTok and X hand out a new refresh token each time; Google keeps the old one.
      refreshToken: typeof j.refresh_token === "string" && j.refresh_token ? j.refresh_token : secret.refreshToken,
      ...(Number.isFinite(seconds) && seconds > 0 ? { expiresAt: now + seconds * 1000 } : {}),
    };
  } catch {
    return null;
  }
}
