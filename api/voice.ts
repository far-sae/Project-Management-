import { Readable } from "node:stream";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { validateRequest } from "twilio/lib/webhooks/webhooks";
import { adminClient, siteOrigin } from "./_signroom/host/admin.js";
import { refuseSignedOut } from "./_signroom/host/auth.js";
import { refuseOversize } from "./_signroom/host/bodySize.js";
import { refuseForeign } from "./_signroom/host/origin.js";
import { readConfig } from "./_voice/config.js";
import { route as realRoute, webhook as realWebhook, WEBHOOKS, type RouteRequest, type RouteResult, type VoiceDeps, type Webhook, type WebhookRequest } from "./_voice/router.js";
import { supabaseStore } from "./_voice/store.js";
import { callToken } from "./_voice/token.js";

/**
 * Calling from the CRM: one Vercel function.
 *
 * The page reaches it as /api/voice/<path> (vercel.json rewrites that to
 * ?path=<path>): our own pages only, a small body, the signed-in account, then
 * the router (paths and rules: _voice/router.ts).
 *
 * The phone provider (Twilio) reaches it as /api/voice?path=twiml and the
 * three addresses that answer gives it. Those requests carry no sign-in and no
 * Origin; each is checked by the provider's signature over the exact address
 * and fields it sent, made with the account's Auth Token.
 */
export const config = { maxDuration: 60 };

export const MAX_BODY_BYTES = 20_000;
export const BODY_TOO_LARGE_MESSAGE = "That is too much text. Shorten the note and try again.";
export const FAILED_MESSAGE = "Something went wrong. Please try again.";
export const UNAVAILABLE_MESSAGE = "Calling is temporarily unavailable. Please try again in a minute.";

export type VoiceHandlerDeps = {
  signedIn: (req: VercelRequest, res: VercelResponse) => Promise<{ id: string } | null>;
  route: (deps: VoiceDeps, r: RouteRequest) => Promise<RouteResult>;
  webhook: (deps: VoiceDeps, r: WebhookRequest) => Promise<string>;
  /** The route deps for one request, or null when the database is not configured. */
  build: () => VoiceDeps | null;
  /** The provider's Auth Token, or null while calling is not set up. */
  authToken: () => string | null;
};

export function splitPath(raw: string | string[] | undefined): string[] {
  const parts = Array.isArray(raw) ? raw : [raw ?? ""];
  return parts.flatMap((p) => String(p).split("/")).filter(Boolean);
}

const first = (v: string | string[] | undefined): string => (Array.isArray(v) ? v[0] : v) ?? "";

function bodyOf(raw: unknown): Record<string, unknown> {
  let v = raw;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v || "{}");
    } catch {
      return {};
    }
  }
  return v && typeof v === "object" && !Array.isArray(v) && !Buffer.isBuffer(v) ? (v as Record<string, unknown>) : {};
}

/** The form fields of a provider request, as text. */
function fieldsOf(raw: unknown): Record<string, string> {
  let v: unknown = raw;
  if (typeof v === "string") v = Object.fromEntries(new URLSearchParams(v));
  const out: Record<string, string> = {};
  if (v && typeof v === "object" && !Array.isArray(v) && !Buffer.isBuffer(v)) {
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) out[k] = String(Array.isArray(val) ? val[0] : val ?? "");
  }
  return out;
}

/**
 * The origins the provider may have reached us at: the host it named, and the
 * site's own. The signature covers the whole address, so trying each one gives
 * nothing to a request that was not signed with the Auth Token.
 */
function originsOf(req: VercelRequest): string[] {
  const hosts = [first(req.headers["x-forwarded-host"]), first(req.headers.host)].map((h) => h.trim().toLowerCase()).filter((h) => /^[a-z0-9.-]+(:\d+)?$/.test(h));
  const origins = hosts.map((h) => `https://${h}`);
  const site = siteOrigin();
  if (site) origins.push(site);
  return [...new Set(origins)];
}

/** The origin whose address matches the provider's signature, or null when none does. */
export function signedOrigin(req: VercelRequest, authToken: string, fields: Record<string, string>): string | null {
  const signature = first(req.headers["x-twilio-signature"]);
  const path = String(req.url ?? "");
  if (!signature || !path.startsWith("/")) return null;
  for (const origin of originsOf(req)) {
    try {
      if (validateRequest(authToken, signature, origin + path, fields)) return origin;
    } catch {
      /* an address the validator cannot read is simply not a match */
    }
  }
  return null;
}

const TWIML = "text/xml; charset=utf-8";

async function fromProvider(d: VoiceHandlerDeps, req: VercelRequest, res: VercelResponse, what: Webhook): Promise<void> {
  const authToken = d.authToken();
  if (!authToken) {
    res.status(503).json({ error: UNAVAILABLE_MESSAGE });
    return;
  }
  const fields = fieldsOf(req.body);
  const base = signedOrigin(req, authToken, fields);
  if (!base) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  const query: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.query ?? {})) if (k !== "path") query[k] = first(v);
  let out: string;
  try {
    const deps = d.build();
    if (!deps) {
      res.status(503).json({ error: UNAVAILABLE_MESSAGE });
      return;
    }
    out = await d.webhook(deps, { what, base, query, params: fields });
  } catch (e) {
    console.error("[voice] provider request failed", what, e instanceof Error ? e.name : "unknown");
    res.status(500).json({ error: FAILED_MESSAGE });
    return;
  }
  res.setHeader("Content-Type", TWIML);
  res.setHeader("Cache-Control", "private, no-store");
  res.status(200).send(out);
}

export function voiceHandler(d: VoiceHandlerDeps) {
  return async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
    const path = splitPath((req.query ?? {}).path);
    if (req.method === "POST" && path.length === 1 && (WEBHOOKS as readonly string[]).includes(path[0])) return fromProvider(d, req, res, path[0] as Webhook);

    if (refuseForeign(req, res)) return;
    if (refuseOversize(req, res, MAX_BODY_BYTES, BODY_TOO_LARGE_MESSAGE)) return;
    const who = await d.signedIn(req, res);
    if (!who) return;

    let out: RouteResult;
    try {
      const deps = d.build();
      if (!deps) {
        res.status(503).json({ error: UNAVAILABLE_MESSAGE });
        return;
      }
      out = await d.route(deps, { method: String(req.method), path, body: bodyOf(req.body), user: { id: who.id } });
    } catch (e) {
      console.error("[voice] failed", e instanceof Error ? e.name : "unknown");
      res.status(500).json({ error: FAILED_MESSAGE });
      return;
    }
    res.setHeader("Cache-Control", "private, no-store");
    if (out.media) {
      // A recording is sent as it arrives: a long call is larger than a function may send in one piece.
      res.setHeader("Content-Type", out.media.type);
      if (out.media.length) res.setHeader("Content-Length", out.media.length);
      res.status(200);
      Readable.fromWeb(out.media.body as never).pipe(res as never);
      return;
    }
    res.status(out.status).json(out.json ?? {});
  };
}

async function realSignedIn(req: VercelRequest, res: VercelResponse): Promise<{ id: string } | null> {
  const who = await refuseSignedOut(req, res);
  return who ? { id: who.userId } : null;
}

function buildDeps(): VoiceDeps | null {
  const sb = adminClient();
  return sb ? { store: supabaseStore(sb), config: () => readConfig(), token: callToken, fetch } : null;
}

export default voiceHandler({
  signedIn: realSignedIn,
  route: realRoute,
  webhook: realWebhook,
  build: buildDeps,
  authToken: () => readConfig().config?.authToken ?? null,
});
