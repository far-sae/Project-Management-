import { createHash } from "node:crypto";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { adminClient } from "./_signroom/host/admin.js";
import { route as realRoute, type FormRequest, type FormResult, type LeadFormDeps } from "./_leadForm/router.js";
import { FORM_FAILED_MESSAGE } from "./_leadForm/shared/types.js";
import { supabaseStore } from "./_leadForm/store.js";

/**
 * Web forms that create leads: /api/lead-form?id=<form id>.
 *
 * This is the one public door into the CRM. It needs no sign-in and answers
 * any website, because the owner may put the form on their own site. It can
 * only do two things: hand out a form's wording, and take one submission for a
 * form that is switched on (rules and limits: _leadForm/router.ts). It never
 * reads anything back out of the CRM.
 */
export const config = { maxDuration: 30 };

export const MAX_BODY_BYTES = 12_000;

export type LeadFormHandlerDeps = {
  route: (deps: LeadFormDeps, r: FormRequest) => Promise<FormResult>;
  /** The route deps for one request, or null when the database is not configured. */
  build: () => LeadFormDeps | null;
};

const first = (v: string | string[] | undefined): string => (Array.isArray(v) ? v[0] : v) ?? "";

/** JSON, or the fields of a plain HTML form. */
function bodyOf(raw: unknown): Record<string, unknown> {
  let v = raw;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v || "{}");
    } catch {
      v = Object.fromEntries(new URLSearchParams(String(raw)));
    }
  }
  return v && typeof v === "object" && !Array.isArray(v) && !Buffer.isBuffer(v) ? (v as Record<string, unknown>) : {};
}

/**
 * A fingerprint of where a request came from, for the spam limit. The network
 * address is hashed together with the form's id, so the same visitor cannot be
 * followed from one form to another, and the address itself is never kept.
 */
export function senderHashOf(req: VercelRequest, formId: string): string {
  const forwarded = first(req.headers["x-forwarded-for"]).split(",")[0].trim();
  const address = forwarded || first(req.headers["x-real-ip"]) || "unknown";
  return createHash("sha256").update(`${formId}|${address}`, "utf8").digest("hex").slice(0, 32);
}

export function leadFormHandler(d: LeadFormHandlerDeps) {
  return async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
    // Any website may show and send a form. No cookie or sign-in is ever used here, so this opens nothing else.
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Cache-Control", "no-store");
    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    const length = Number(first(req.headers["content-length"]) || 0);
    if (length > MAX_BODY_BYTES) {
      res.status(413).json({ error: FORM_FAILED_MESSAGE });
      return;
    }
    const formId = first((req.query ?? {}).id);
    let out: FormResult;
    try {
      const deps = d.build();
      if (!deps) {
        res.status(503).json({ error: FORM_FAILED_MESSAGE });
        return;
      }
      out = await d.route(deps, { method: String(req.method), formId, body: req.method === "POST" ? bodyOf(req.body) : {}, senderHash: senderHashOf(req, formId) });
    } catch (e) {
      // The name only: the text of a database error can carry what the visitor wrote.
      console.error("[lead-form] failed", e instanceof Error ? e.name : "unknown");
      res.status(500).json({ error: FORM_FAILED_MESSAGE });
      return;
    }
    res.status(out.status).json(out.json ?? {});
  };
}

function buildDeps(): LeadFormDeps | null {
  const sb = adminClient();
  return sb ? { store: supabaseStore(sb) } : null;
}

export default leadFormHandler({ route: realRoute, build: buildDeps });
