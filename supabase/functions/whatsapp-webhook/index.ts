// supabase/functions/whatsapp-webhook/index.ts
// Meta WhatsApp Cloud API webhook. Two endpoints in one function:
//   GET  — Meta's subscribe handshake (hub.mode / hub.verify_token / hub.challenge)
//   POST — message + interactive-reply events
//
// Deploy: npx supabase functions deploy whatsapp-webhook --no-verify-jwt
//
// Secrets (Supabase → Edge Functions → Secrets):
//   WHATSAPP_ACCESS_TOKEN       — permanent system-user token from Meta
//   WHATSAPP_PHONE_NUMBER_ID    — phone-number-id from the Meta dashboard
//   WHATSAPP_VERIFY_TOKEN       — any random string; matches Meta's subscribe form
//   WHATSAPP_APP_SECRET         — Meta App secret (used to verify X-Hub-Signature-256)
//   WHATSAPP_API_VERSION        — optional, default v20.0
//   OPENAI_API_KEY              — existing secret reused for intent parsing

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendMessage, markRead } from "./whatsapp.ts";
import {
  findLinkedAccount, handleStart, handleUnlink, handleSwitchOrg,
  handleNaturalLanguage, handleInteractiveReply, handleHelp, handleListOrgs,
  handleCancel, handleMedia,
} from "./handlers.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VERIFY_TOKEN = Deno.env.get("WHATSAPP_VERIFY_TOKEN") ?? "";
const APP_SECRET = Deno.env.get("WHATSAPP_APP_SECRET") ?? "";

// ── Signature verification ──────────────────────────────────────────────────
// Meta signs every POST with HMAC-SHA256 of the raw request body using the
// app secret. Header is `X-Hub-Signature-256: sha256=<hex>`. We compare in
// constant time. If the secret isn't configured, refuse all POSTs (fail closed).

const timingSafeEqualHex = (a: string, b: string): boolean => {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
};

const verifySignature = async (rawBody: string, header: string): Promise<boolean> => {
  if (!APP_SECRET || !header.startsWith("sha256=")) return false;
  const provided = header.slice("sha256=".length).toLowerCase();
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(APP_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sigBytes = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const expected = Array.from(new Uint8Array(sigBytes))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return timingSafeEqualHex(expected, provided);
};

// ── Types we care about from the Meta payload ──────────────────────────────
interface InboundChange {
  value?: {
    messaging_product?: string;
    messages?: Array<{
      id: string;
      from: string; // sender's phone number in E.164 (no +)
      type: "text" | "interactive" | "button" | "image" | "audio" | "document" | string;
      text?: { body: string };
      interactive?: {
        type: "button_reply" | "list_reply";
        button_reply?: { id: string; title: string };
        list_reply?: { id: string; title: string };
      };
      button?: { payload?: string; text?: string };
      image?: { id: string; mime_type?: string; caption?: string };
      audio?: { id: string; mime_type?: string; voice?: boolean };
      document?: { id: string; mime_type?: string; filename?: string; caption?: string };
    }>;
  };
}

interface InboundEntry {
  changes?: InboundChange[];
}

interface InboundPayload {
  object?: string;
  entry?: InboundEntry[];
}

Deno.serve(async (req) => {
  // ── Subscribe handshake ─────────────────────────────────────────────────
  if (req.method === "GET") {
    const url = new URL(req.url);
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    if (mode === "subscribe" && token && token === VERIFY_TOKEN) {
      return new Response(challenge ?? "", { status: 200 });
    }
    return new Response("forbidden", { status: 403 });
  }

  if (req.method !== "POST") return new Response("method_not_allowed", { status: 405 });

  const rawBody = await req.text();
  const sigHeader = req.headers.get("x-hub-signature-256") ?? "";
  if (!(await verifySignature(rawBody, sigHeader))) {
    return new Response("unauthorized", { status: 401 });
  }

  let body: InboundPayload;
  try { body = JSON.parse(rawBody); } catch { return new Response("bad_json", { status: 400 }); }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Meta delivers a tree: entry[].changes[].value.messages[]. We walk every
  // message in the payload and handle them one at a time. Status updates
  // (delivered/read) come through here too — we ignore them.
  try {
    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const messages = change.value?.messages ?? [];
        for (const m of messages) {
          await handleOne(admin, m);
        }
      }
    }
    // Always 200 — Meta retries non-2xx aggressively, which would amplify
    // bugs. We log inside handleOne and surface errors to the user where we can.
    return new Response("ok");
  } catch (err) {
    console.error("whatsapp-webhook error:", err);
    return new Response("ok");
  }
});

const handleOne = async (
  admin: SupabaseClient,
  m: NonNullable<NonNullable<InboundChange["value"]>["messages"]>[number],
): Promise<void> => {
  const phoneNumber = m.from;
  // Best-effort read receipt — non-fatal.
  void markRead(m.id);

  // Interactive reply (button tap)
  if (m.type === "interactive" && m.interactive) {
    const buttonId =
      m.interactive.button_reply?.id ?? m.interactive.list_reply?.id ?? "";
    if (buttonId) {
      await handleInteractiveReply(admin, phoneNumber, buttonId);
      return;
    }
  }

  // Legacy button (template button responses also arrive as type:'button')
  if (m.type === "button" && m.button?.payload) {
    await handleInteractiveReply(admin, phoneNumber, m.button.payload);
    return;
  }

  // Media messages — handled before the text guard.
  if (m.type === "audio" && m.audio) {
    await handleMedia(admin, phoneNumber, { kind: "audio", mediaId: m.audio.id, mime: m.audio.mime_type ?? "audio/ogg", name: "voice.ogg" }, undefined);
    return;
  }
  if (m.type === "image" && m.image) {
    await handleMedia(admin, phoneNumber, { kind: "image", mediaId: m.image.id, mime: m.image.mime_type ?? "image/jpeg", name: "image.jpg" }, m.image.caption);
    return;
  }
  if (m.type === "document" && m.document) {
    await handleMedia(admin, phoneNumber, { kind: "document", mediaId: m.document.id, mime: m.document.mime_type ?? "application/octet-stream", name: m.document.filename ?? "file" }, m.document.caption);
    return;
  }

  // Text message
  if (m.type !== "text" || !m.text?.body) return;
  const text = m.text.body.trim();

  // Slash commands first — they don't need a linked account check for /start.
  if (text.toLowerCase().startsWith("/start")) {
    const arg = text.slice(6).trim() || undefined;
    await handleStart(admin, phoneNumber, arg);
    return;
  }
  if (text.toLowerCase() === "/unlink") {
    await handleUnlink(admin, phoneNumber);
    return;
  }

  // Everything else requires a linked account.
  const account = await findLinkedAccount(admin, phoneNumber);
  if (!account) {
    await sendMessage(
      phoneNumber,
      "🔗 This number isn't linked. In TaskCalendar: Settings → Integrations → WhatsApp → Connect, then reply: /start <code>",
    );
    return;
  }

  if (text.toLowerCase() === "/help") {
    await handleHelp(phoneNumber);
    return;
  }
  if (text.toLowerCase() === "/orgs") {
    await handleListOrgs(admin, account);
    return;
  }
  if (text.toLowerCase().startsWith("/switchorg")) {
    await handleSwitchOrg(admin, account, text.slice("/switchorg".length).trim());
    return;
  }
  if (text.toLowerCase() === "/cancel") {
    await handleCancel(admin, phoneNumber);
    return;
  }

  await handleNaturalLanguage(admin, account, text);
};
