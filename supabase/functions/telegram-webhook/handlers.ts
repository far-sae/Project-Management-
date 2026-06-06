// supabase/functions/telegram-webhook/handlers.ts

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendMessage, answerCallbackQuery, type InlineButton, downloadMedia } from "./telegram.ts";
import { transcribeAudio, attachToEntity, loadLastEntity, ATTACH_ENTITY_TYPES } from "../_shared/agent/media.ts";
import { parseIntent } from "./intent.ts";
import { loadUserTimezone } from "../_shared/agent/format.ts";
import { resolveIntent, executePending, loadConvo, clearConvo, resumeDisambiguation } from "./agentActions.ts";
import type { AgentReply, Intent, LinkedAccount } from "./types.ts";

const sha256Hex = async (s: string): Promise<string> => {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
};

export const findLinkedAccount = async (
  admin: SupabaseClient,
  telegramUserId: number,
): Promise<LinkedAccount | null> => {
  const { data } = await admin
    .from("integrations")
    .select("user_id, metadata, status")
    .eq("provider", "telegram")
    .eq("status", "active")
    .filter("metadata->>telegram_user_id", "eq", String(telegramUserId))
    .maybeSingle();
  if (!data) return null;
  const meta = (data.metadata ?? {}) as { current_org_id?: string };
  if (!meta.current_org_id) return null;
  return {
    user_id: data.user_id as string,
    current_org_id: meta.current_org_id,
    external_id: String(telegramUserId),
  };
};

const listOrgsForUser = async (
  admin: SupabaseClient,
  userId: string,
): Promise<Array<{ organization_id: string; name: string }>> => {
  const { data: owned } = await admin
    .from("organizations")
    .select("organization_id, name")
    .eq("owner_id", userId);
  const { data: memberOf } = await admin
    .from("organizations")
    .select("organization_id, name")
    .contains("members", [{ userId }]);
  const map = new Map<string, string>();
  for (const r of (owned ?? []) as Array<{ organization_id: string; name: string }>) {
    map.set(r.organization_id, r.name);
  }
  for (const r of (memberOf ?? []) as Array<{ organization_id: string; name: string }>) {
    if (!map.has(r.organization_id)) map.set(r.organization_id, r.name);
  }
  return Array.from(map.entries()).map(([organization_id, name]) => ({ organization_id, name }));
};

export const handleStart = async (
  admin: SupabaseClient,
  chatId: number,
  telegramUserId: number,
  telegramUsername: string | undefined,
  arg: string | undefined,
): Promise<void> => {
  if (!arg) {
    const existing = await findLinkedAccount(admin, telegramUserId);
    if (existing) {
      await sendMessage(chatId, `✅ Already linked. Try \`add task: call John tomorrow 3pm in My Project\`. /help for more.`);
    } else {
      await sendMessage(chatId, `👋 To link this chat, generate a code in TaskCalendar (Settings → Integrations → Telegram), then send \`/start <code>\`.`);
    }
    return;
  }
  const code = arg.trim();
  if (!/^\d{6}$/.test(code)) {
    await sendMessage(chatId, "Codes are 6 digits. Try again.");
    return;
  }
  const codeHash = await sha256Hex(code);
  const { data: codeRow } = await admin
    .from("telegram_link_codes")
    .select("id, user_id, org_id, expires_at, consumed_at")
    .eq("code_hash", codeHash)
    .is("consumed_at", null)
    .maybeSingle();
  if (!codeRow) {
    await sendMessage(chatId, "❌ Invalid or already-used code. Generate a new one in Settings.");
    return;
  }
  if (new Date(codeRow.expires_at).getTime() < Date.now()) {
    await sendMessage(chatId, "❌ Code expired. Generate a new one.");
    return;
  }
  // Consume code + upsert integrations row in two writes.
  await admin.from("telegram_link_codes").update({ consumed_at: new Date().toISOString() }).eq("id", codeRow.id);
  await admin.from("integrations").upsert({
    user_id: codeRow.user_id,
    provider: "telegram",
    access_token_encrypted: "n/a",            // schema requires a value; not used for telegram
    status: "active",
    metadata: {
      telegram_user_id: telegramUserId,
      telegram_username: telegramUsername ?? null,
      chat_id: chatId,
      current_org_id: codeRow.org_id,
    },
  }, { onConflict: "user_id,provider" });
  const { data: orgRow } = await admin
    .from("organizations")
    .select("name")
    .eq("organization_id", codeRow.org_id)
    .maybeSingle();
  const orgName = (orgRow?.name as string | undefined) ?? "your org";
  await sendMessage(chatId, `✅ Linked in *${orgName}*. Try \`add workspace Sales\` or \`task: call John tomorrow 3pm in Q1 launch\`. Say *help* for more.`);
};

export const handleUnlink = async (
  admin: SupabaseClient,
  chatId: number,
  telegramUserId: number,
): Promise<void> => {
  const account = await findLinkedAccount(admin, telegramUserId);
  if (!account) {
    await sendMessage(chatId, "Not linked.");
    return;
  }
  await admin.from("integrations")
    .delete()
    .eq("provider", "telegram")
    .eq("user_id", account.user_id);
  await sendMessage(chatId, "🔌 Unlinked. /start to link again.");
};

const getMeta = async (admin: SupabaseClient, userId: string): Promise<Record<string, unknown>> => {
  const { data } = await admin.from("integrations").select("metadata").eq("provider", "telegram").eq("user_id", userId).maybeSingle();
  return (data?.metadata ?? {}) as Record<string, unknown>;
};

export const handleSwitchOrg = async (
  admin: SupabaseClient,
  chatId: number,
  account: LinkedAccount,
  arg: string,
): Promise<void> => {
  const needle = arg.trim();
  if (!needle) {
    await sendMessage(chatId, "Usage: `/switchorg <name>`. Try /orgs to list.");
    return;
  }
  const orgs = await listOrgsForUser(admin, account.user_id);
  const match = orgs.find((o) => o.name.toLowerCase() === needle.toLowerCase());
  if (!match) {
    await sendMessage(chatId, `No org named *${needle}*. /orgs to see what you have.`);
    return;
  }
  const meta = await getMeta(admin, account.user_id);
  await admin
    .from("integrations")
    .update({ metadata: { ...meta, current_org_id: match.organization_id } })
    .eq("provider", "telegram")
    .eq("user_id", account.user_id);
  await sendMessage(chatId, `▶ Now creating in *${match.name}*.`);
};

const sendReply = async (chatId: number, reply: AgentReply): Promise<void> => {
  if (reply.kind === "text") return sendMessage(chatId, reply.text);
  if (reply.kind === "noop") return;
  if (reply.kind === "confirm") {
    const kb: InlineButton[][] = [[
      { text: "✅ Confirm", callback_data: `confirm:${reply.pendingActionId}` },
      { text: "❌ Cancel", callback_data: `cancel:${reply.pendingActionId}` },
    ]];
    return sendMessage(chatId, reply.summary, kb);
  }
  // choices
  const kb: InlineButton[][] = reply.choices.map((c) => [{ text: c.label, callback_data: c.callback }]);
  return sendMessage(chatId, reply.prompt, kb);
};

export const handleNaturalLanguage = async (
  admin: SupabaseClient,
  chatId: number,
  account: LinkedAccount,
  text: string,
): Promise<void> => {
  // 1. If we're mid-conversation (bot asked for a missing field on the previous
  //    turn), slot this message in as that field and re-resolve without going
  //    through the LLM. Saves a round-trip and is robust to single-word replies
  //    like "Marketing" that OpenAI would otherwise classify as unknown.
  const convo = await loadConvo(admin, String(chatId));
  if (convo && !convo.awaiting_field.startsWith("__")) {
    const filled = { ...convo.partial_intent, [convo.awaiting_field]: text.trim() } as Intent;
    const reply = await resolveIntent(admin, account, String(chatId), filled);
    await sendReply(chatId, reply);
    return;
  }

  // 2. Fresh command. Compact context for the parser. Load the user's IANA
  //    timezone from user_profiles so relative dates ("tomorrow 3pm") resolve
  //    correctly in their local time.
  const [{ data: wsData }, { data: projData }, { data: clData }, tz] = await Promise.all([
    admin.from("workspaces").select("name").eq("organization_id", account.current_org_id).limit(200),
    admin.from("projects").select("name").eq("organization_id", account.current_org_id).limit(200),
    admin.from("clients").select("name").eq("organization_id", account.current_org_id).limit(200),
    loadUserTimezone(admin, account.user_id),
  ]);
  const intent = await parseIntent(text, {
    workspaces: (wsData ?? []).map((r) => (r as { name: string }).name),
    projects: (projData ?? []).map((r) => (r as { name: string }).name),
    clients: (clData ?? []).map((r) => (r as { name: string }).name),
    nowIso: new Date().toISOString(),
    timezone: tz,
  });
  const reply = await resolveIntent(admin, account, String(chatId), intent);
  await sendReply(chatId, reply);
};

export const handleCancel = async (
  admin: SupabaseClient,
  chatId: number,
): Promise<void> => {
  await clearConvo(admin, String(chatId));
  await sendMessage(chatId, "🛑 Cancelled. Send a new command anytime.");
};

// Local /help and /orgs dispatch — does not go through OpenAI so it works
// even if the OpenAI key is missing or rate-limited.
export const handleHelp = async (chatId: number): Promise<void> => {
  await sendMessage(chatId, HELP_TEXT);
};

export const handleListOrgs = async (
  admin: SupabaseClient,
  chatId: number,
  account: LinkedAccount,
): Promise<void> => {
  const orgs = await listOrgsForUser(admin, account.user_id);
  if (orgs.length === 0) {
    await sendMessage(chatId, "You're not in any orgs yet.");
    return;
  }
  const lines = orgs.map((o) =>
    `${o.organization_id === account.current_org_id ? "▶" : " "} ${o.name}`,
  );
  await sendMessage(chatId, lines.join("\n"));
};

const HELP_TEXT = `*TaskCalendar bot — just type in plain English*

Examples:
• \`add workspace Acme Onboarding\`
• \`new project Q1 launch in Acme Onboarding\`
• \`task: call John tomorrow 3pm in Q1 launch\`
• \`new client Acme Corp\`
• \`show my open tasks\`
• \`mark Deploy v2 done\`

Handy words:
• \`my orgs\` — list your orgs
• \`switch to <name>\` — change current org
• \`cancel\` — drop the current question
• \`unlink\` — disconnect this chat
• \`help\` — show this message`;

type TgMedia = { kind: "voice" | "audio" | "document" | "photo"; fileId: string; mime: string; name: string };

export const handleMedia = async (
  admin: SupabaseClient,
  chatId: number,
  account: LinkedAccount,
  media: TgMedia,
  caption: string | undefined,
): Promise<void> => {
  const dl = await downloadMedia(media.fileId, media.mime, media.name);

  if (media.kind === "voice" || media.kind === "audio") {
    let transcript = "";
    try {
      transcript = await transcribeAudio(dl.bytes, dl.mimeType);
    } catch {
      await sendMessage(chatId, "Couldn't transcribe that voice note — try typing it.");
      return;
    }
    if (!transcript) {
      await sendMessage(chatId, "I couldn't hear anything in that clip.");
      return;
    }
    await handleNaturalLanguage(admin, chatId, account, transcript);
    return;
  }

  const target = await loadLastEntity(admin, "telegram", account.user_id);
  if (!target || !ATTACH_ENTITY_TYPES.has(target.type)) {
    await sendMessage(chatId, "I don't know what to attach this to yet. Create or open a record first (e.g. `new client Acme`), then resend the file.");
    return;
  }
  try {
    await attachToEntity(admin, account.current_org_id, account.user_id, target.type, target.id, dl.bytes, dl.mimeType, dl.fileName);
    await sendMessage(chatId, `📎 Attached *${dl.fileName}* to ${target.type} *${target.label}*.`);
  } catch (err) {
    await sendMessage(chatId, `❌ Couldn't attach that: ${(err as Error).message}`);
  }
};

export const handleCallbackQuery = async (
  admin: SupabaseClient,
  callbackQueryId: string,
  chatId: number,
  data: string,
): Promise<void> => {
  if (data.startsWith("confirm:")) {
    const pendingId = data.slice("confirm:".length);
    try {
      const msg = await executePending(admin, pendingId);
      await answerCallbackQuery(callbackQueryId);
      await sendMessage(chatId, msg);
    } catch (err) {
      await answerCallbackQuery(callbackQueryId);
      await sendMessage(chatId, `❌ ${(err as Error).message}`);
    }
    return;
  }
  if (data.startsWith("cancel:")) {
    const pendingId = data.slice("cancel:".length);
    await admin.from("agent_pending_actions").delete().eq("id", pendingId);
    await answerCallbackQuery(callbackQueryId, "Cancelled");
    await sendMessage(chatId, "🛑 Cancelled.");
    return;
  }
  // Disambiguation choice tap.
  await answerCallbackQuery(callbackQueryId);
  const reply = await resumeDisambiguation(admin, String(chatId), data);
  await sendReply(chatId, reply);
};
