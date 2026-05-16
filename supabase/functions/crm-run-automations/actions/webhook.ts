// supabase/functions/crm-run-automations/actions/webhook.ts
import { ActionHandler } from "../shared/types.ts";

const PRIVATE_HOST_RE = /^(localhost|127\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.|169\.254\.|metadata\.google\.internal)/i;

const hmacSha256Hex = async (secret: string, body: string): Promise<string> => {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
};

export const webhook: ActionHandler = async (ctx, config) => {
  const url = config.url as string;
  if (!url) return { status: "failure", message: "url config required" };

  let parsed: URL;
  try { parsed = new URL(url); }
  catch { return { status: "failure", message: "Invalid url" }; }
  if (parsed.protocol !== "https:") return { status: "failure", message: "Webhook url must be https" };
  if (PRIVATE_HOST_RE.test(parsed.hostname)) {
    return { status: "failure", message: "Webhook url points to a private address (blocked)" };
  }

  const body = JSON.stringify({
    event: ctx.event,
    recipe_id: ctx.recipeId,
    org_id: ctx.orgId,
  });

  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-crm-idempotency-key": ctx.event.event_id + ":" + ctx.recipeId,
    ...(config.headers as Record<string, string> | undefined ?? {}),
  };

  const secret = config.secret as string | undefined;
  if (secret) {
    headers["x-crm-signature"] = "sha256=" + await hmacSha256Hex(secret, body);
  }

  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 30000);
  try {
    const res = await fetch(url, { method: "POST", headers, body, signal: ctrl.signal });
    clearTimeout(timeout);
    if (!res.ok) return { status: "failure", message: `Webhook returned ${res.status}` };
    return { status: "success", meta: { http_status: res.status } };
  } catch (err) {
    clearTimeout(timeout);
    const msg = err instanceof Error ? err.message : String(err);
    return { status: "failure", message: msg };
  }
};
