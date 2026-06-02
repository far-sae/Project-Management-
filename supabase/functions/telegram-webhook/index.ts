// supabase/functions/telegram-webhook/index.ts
// Public endpoint for Telegram Bot API. Deploy with --no-verify-jwt:
//   npx supabase functions deploy telegram-webhook --no-verify-jwt
//
// Secrets (Supabase → Edge Functions → Secrets):
//   TELEGRAM_BOT_TOKEN         — from @BotFather
//   TELEGRAM_WEBHOOK_SECRET    — long random string, also passed to setWebhook
//   OPENAI_API_KEY             — existing secret reused
//
// After deploy, register the webhook once:
//   curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook" \
//     -d "url=https://<project>.supabase.co/functions/v1/telegram-webhook" \
//     -d "secret_token=<TELEGRAM_WEBHOOK_SECRET>"

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendMessage } from "./telegram.ts";
import {
  findLinkedAccount, handleStart, handleUnlink, handleSwitchOrg,
  handleNaturalLanguage, handleCallbackQuery, handleHelp, handleListOrgs,
  handleCancel, handleMedia,
} from "./handlers.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WEBHOOK_SECRET = Deno.env.get("TELEGRAM_WEBHOOK_SECRET") ?? "";

interface TgUpdate {
  message?: {
    chat: { id: number };
    from?: { id: number; username?: string };
    text?: string;
    caption?: string;
    voice?: { file_id: string; mime_type?: string };
    audio?: { file_id: string; mime_type?: string; file_name?: string };
    document?: { file_id: string; mime_type?: string; file_name?: string };
    photo?: Array<{ file_id: string }>;
  };
  callback_query?: {
    id: string;
    from: { id: number };
    message: { chat: { id: number } };
    data: string;
  };
}

const timingSafeEqual = (a: string, b: string): boolean => {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
};

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method_not_allowed", { status: 405 });

  // Webhook authenticity: Telegram echoes the secret as a header. Constant-time
  // compare so a timing leak can't be used to bruteforce the secret.
  const headerSecret = req.headers.get("x-telegram-bot-api-secret-token") ?? "";
  if (!WEBHOOK_SECRET || !timingSafeEqual(headerSecret, WEBHOOK_SECRET)) {
    return new Response("unauthorized", { status: 401 });
  }

  let body: TgUpdate;
  try { body = await req.json(); } catch { return new Response("bad_json", { status: 400 }); }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    if (body.callback_query) {
      const cq = body.callback_query;
      await handleCallbackQuery(admin, cq.id, cq.message.chat.id, cq.data);
      return new Response("ok");
    }

    const msg = body.message;
    if (!msg?.from) return new Response("ok");

    const chatId = msg.chat.id;
    const tgUserId = msg.from.id;
    const username = msg.from.username;

    // Text-only slash commands that don't require a linked account.
    if (msg.text) {
      const text = msg.text.trim();
      if (text.startsWith("/start")) {
        const arg = text.slice("/start".length).trim() || undefined;
        await handleStart(admin, chatId, tgUserId, username, arg);
        return new Response("ok");
      }
      if (text === "/unlink") {
        await handleUnlink(admin, chatId, tgUserId);
        return new Response("ok");
      }
    }

    // Everything else requires a linked account.
    const account = await findLinkedAccount(admin, tgUserId);
    if (!account) {
      await sendMessage(chatId, "🔗 This chat isn't linked. In TaskCalendar: Settings → Integrations → Telegram → Connect, then send `/start <code>`.");
      return new Response("ok");
    }

    // Media messages (voice, audio, document, photo) — handle before text routing.
    const media = msg.voice
      ? { kind: "voice" as const, fileId: msg.voice.file_id, mime: msg.voice.mime_type ?? "audio/ogg", name: "voice.ogg" }
      : msg.audio
      ? { kind: "audio" as const, fileId: msg.audio.file_id, mime: msg.audio.mime_type ?? "audio/mpeg", name: msg.audio.file_name ?? "audio.mp3" }
      : msg.document
      ? { kind: "document" as const, fileId: msg.document.file_id, mime: msg.document.mime_type ?? "application/octet-stream", name: msg.document.file_name ?? "file" }
      : (msg.photo && msg.photo.length)
      ? { kind: "photo" as const, fileId: msg.photo[msg.photo.length - 1].file_id, mime: "image/jpeg", name: "photo.jpg" }
      : null;
    if (media) {
      await handleMedia(admin, chatId, account, media, msg.caption);
      return new Response("ok");
    }

    // Non-media, non-text messages (stickers, location, etc.) — ignore.
    if (!msg.text) return new Response("ok");
    const text = msg.text.trim();

    if (text === "/help") {
      await handleHelp(chatId);
      return new Response("ok");
    }
    if (text === "/orgs") {
      await handleListOrgs(admin, chatId, account);
      return new Response("ok");
    }
    if (text === "/cancel") {
      await handleCancel(admin, chatId);
      return new Response("ok");
    }
    if (text.startsWith("/switchorg")) {
      await handleSwitchOrg(admin, chatId, account, text.slice("/switchorg".length).trim());
      return new Response("ok");
    }

    await handleNaturalLanguage(admin, chatId, account, text);
    return new Response("ok");
  } catch (err) {
    console.error("telegram-webhook error:", err);
    // Always 200 to stop Telegram retries; surface error to the user when possible.
    try {
      const chatId = body.message?.chat.id ?? body.callback_query?.message.chat.id;
      if (chatId) await sendMessage(chatId, `❌ ${(err as Error).message}`);
    } catch { /* swallow */ }
    return new Response("ok");
  }
});
