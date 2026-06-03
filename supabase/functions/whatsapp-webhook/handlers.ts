// supabase/functions/whatsapp-webhook/handlers.ts

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendMessage, sendButtons, sendList, type InteractiveButton, downloadMedia } from "./whatsapp.ts";
import { transcribeAudio, attachToEntity, loadLastEntity, ATTACH_ENTITY_TYPES } from "../_shared/agent/media.ts";
import { parseIntent } from "../_shared/agent/intent.ts";
import { loadUserTimezone } from "../_shared/agent/format.ts";
import {
  resolveIntent as sharedResolveIntent,
  executePending,
  loadConvo as sharedLoadConvo,
  clearConvo as sharedClearConvo,
  resumeDisambiguation as sharedResume,
} from "../_shared/agent/agentActions.ts";
import type { AgentReply, Intent, LinkedAccount } from "../_shared/agent/types.ts";

const PROVIDER = "whatsapp" as const;

const sha256Hex = async (s: string): Promise<string> => {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
};

const resolveIntent = (admin: SupabaseClient, account: LinkedAccount, chatId: string, intent: Intent) =>
  sharedResolveIntent(admin, PROVIDER, account, chatId, intent);
const loadConvo = (admin: SupabaseClient, chatId: string) =>
  sharedLoadConvo(admin, PROVIDER, chatId);
const clearConvo = (admin: SupabaseClient, chatId: string) =>
  sharedClearConvo(admin, PROVIDER, chatId);

export const findLinkedAccount = async (
  admin: SupabaseClient,
  phoneNumber: string,
): Promise<LinkedAccount | null> => {
  const { data } = await admin
    .from("integrations")
    .select("user_id, metadata, status")
    .eq("provider", PROVIDER)
    .eq("status", "active")
    .filter("metadata->>phone_number", "eq", phoneNumber)
    .maybeSingle();
  if (!data) return null;
  const meta = (data.metadata ?? {}) as { current_org_id?: string };
  if (!meta.current_org_id) return null;
  return {
    user_id: data.user_id as string,
    current_org_id: meta.current_org_id,
    external_id: phoneNumber,
  };
};

const listOrgsForUser = async (admin: SupabaseClient, userId: string) => {
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
  phoneNumber: string,
  arg: string | undefined,
): Promise<void> => {
  if (!arg) {
    const existing = await findLinkedAccount(admin, phoneNumber);
    if (existing) {
      await sendMessage(phoneNumber, "✅ Already linked. Try: add task call John tomorrow 3pm in My Project. Say help for more.");
    } else {
      await sendMessage(
        phoneNumber,
        "👋 To link this chat, generate a code in TaskCalendar (Settings → Integrations → WhatsApp), then reply: /start <code>",
      );
    }
    return;
  }
  const code = arg.trim();
  if (!/^\d{6}$/.test(code)) {
    await sendMessage(phoneNumber, "Codes are 6 digits. Try again.");
    return;
  }
  const codeHash = await sha256Hex(code);
  const { data: codeRow } = await admin
    .from("whatsapp_link_codes")
    .select("id, user_id, org_id, expires_at, consumed_at")
    .eq("code_hash", codeHash)
    .is("consumed_at", null)
    .maybeSingle();
  if (!codeRow) {
    await sendMessage(phoneNumber, "❌ Invalid or already-used code. Generate a new one in Settings.");
    return;
  }
  if (new Date(codeRow.expires_at).getTime() < Date.now()) {
    await sendMessage(phoneNumber, "❌ Code expired. Generate a new one.");
    return;
  }
  await admin.from("whatsapp_link_codes").update({ consumed_at: new Date().toISOString() }).eq("id", codeRow.id);
  await admin.from("integrations").upsert({
    user_id: codeRow.user_id,
    provider: PROVIDER,
    access_token_encrypted: "n/a",
    status: "active",
    metadata: {
      phone_number: phoneNumber,
      current_org_id: codeRow.org_id,
    },
  }, { onConflict: "user_id,provider" });

  const { data: orgRow } = await admin
    .from("organizations")
    .select("name")
    .eq("organization_id", codeRow.org_id)
    .maybeSingle();
  const orgName = (orgRow?.name as string | undefined) ?? "your org";
  await sendMessage(
    phoneNumber,
    `✅ Linked in ${orgName}. Try: add workspace Sales, or: task: call John tomorrow 3pm in Q1 launch. Say help for more.`,
  );
};

export const handleUnlink = async (admin: SupabaseClient, phoneNumber: string): Promise<void> => {
  const account = await findLinkedAccount(admin, phoneNumber);
  if (!account) {
    await sendMessage(phoneNumber, "Not linked.");
    return;
  }
  await admin.from("integrations")
    .delete()
    .eq("provider", PROVIDER)
    .eq("user_id", account.user_id);
  await sendMessage(phoneNumber, "🔌 Unlinked. /start to link again.");
};

const getMeta = async (admin: SupabaseClient, userId: string) => {
  const { data } = await admin.from("integrations").select("metadata").eq("provider", PROVIDER).eq("user_id", userId).maybeSingle();
  return (data?.metadata ?? {}) as Record<string, unknown>;
};

export const handleSwitchOrg = async (
  admin: SupabaseClient,
  account: LinkedAccount,
  arg: string,
): Promise<void> => {
  const needle = arg.trim();
  if (!needle) {
    await sendMessage(account.external_id, "Usage: /switchorg <name>. Try /orgs to list.");
    return;
  }
  const orgs = await listOrgsForUser(admin, account.user_id);
  const match = orgs.find((o) => o.name.toLowerCase() === needle.toLowerCase());
  if (!match) {
    await sendMessage(account.external_id, `No org named ${needle}. /orgs to see what you have.`);
    return;
  }
  const meta = await getMeta(admin, account.user_id);
  await admin
    .from("integrations")
    .update({ metadata: { ...meta, current_org_id: match.organization_id } })
    .eq("provider", PROVIDER)
    .eq("user_id", account.user_id);
  await sendMessage(account.external_id, `▶ Now creating in ${match.name}.`);
};

const sendReply = async (phoneNumber: string, reply: AgentReply): Promise<void> => {
  if (reply.kind === "text") return sendMessage(phoneNumber, reply.text);
  if (reply.kind === "noop") return;
  if (reply.kind === "confirm") {
    const buttons: InteractiveButton[] = [
      { id: `confirm:${reply.pendingActionId}`, title: "✅ Confirm" },
      { id: `cancel:${reply.pendingActionId}`, title: "❌ Cancel" },
    ];
    return sendButtons(phoneNumber, reply.summary, buttons);
  }
  // choices — WhatsApp buttons cap at 3; use an interactive list beyond that.
  if (reply.choices.length <= 3) {
    const buttons: InteractiveButton[] = reply.choices.map((c) => ({
      id: c.callback, title: c.label,
    }));
    return sendButtons(phoneNumber, reply.prompt, buttons);
  }
  return sendList(
    phoneNumber,
    reply.prompt,
    reply.choices.map((c) => ({ id: c.callback, title: c.label })),
  );
};

export const handleHelp = async (phoneNumber: string): Promise<void> => {
  await sendMessage(
    phoneNumber,
    "TaskCalendar bot — just type in plain English\n\n" +
      "Examples:\n" +
      "• add workspace Acme Onboarding\n" +
      "• new project Q1 launch in Acme Onboarding\n" +
      "• task: call John tomorrow 3pm in Q1 launch\n" +
      "• new client Acme Corp\n" +
      "• show my open tasks\n" +
      "• mark Deploy v2 done\n\n" +
      "Handy words:\n" +
      "my orgs — list your orgs\n" +
      "switch to <name> — change current org\n" +
      "cancel — drop the current question\n" +
      "unlink — disconnect this chat\n" +
      "help — show this message",
  );
};

export const handleListOrgs = async (
  admin: SupabaseClient,
  account: LinkedAccount,
): Promise<void> => {
  const orgs = await listOrgsForUser(admin, account.user_id);
  if (orgs.length === 0) {
    await sendMessage(account.external_id, "You're not in any orgs yet.");
    return;
  }
  const lines = orgs.map((o) =>
    `${o.organization_id === account.current_org_id ? "▶" : " "} ${o.name}`,
  );
  await sendMessage(account.external_id, lines.join("\n"));
};

export const handleCancel = async (
  admin: SupabaseClient,
  phoneNumber: string,
): Promise<void> => {
  await clearConvo(admin, phoneNumber);
  await sendMessage(phoneNumber, "🛑 Cancelled. Send a new command anytime.");
};

export const handleNaturalLanguage = async (
  admin: SupabaseClient,
  account: LinkedAccount,
  text: string,
): Promise<void> => {
  const phoneNumber = account.external_id;
  const convo = await loadConvo(admin, phoneNumber);
  if (convo && !convo.awaiting_field.startsWith("__")) {
    const filled = { ...convo.partial_intent, [convo.awaiting_field]: text.trim() } as Intent;
    const reply = await resolveIntent(admin, account, phoneNumber, filled);
    await sendReply(phoneNumber, reply);
    return;
  }

  const [{ data: wsData }, { data: projData }, { data: clData }, tz] = await Promise.all([
    admin.from("workspaces").select("name").eq("organization_id", account.current_org_id).limit(50),
    admin.from("projects").select("name").eq("organization_id", account.current_org_id).limit(50),
    admin.from("clients").select("name").eq("organization_id", account.current_org_id).limit(50),
    loadUserTimezone(admin, account.user_id),
  ]);
  const intent = await parseIntent(text, {
    workspaces: (wsData ?? []).map((r) => (r as { name: string }).name),
    projects: (projData ?? []).map((r) => (r as { name: string }).name),
    clients: (clData ?? []).map((r) => (r as { name: string }).name),
    nowIso: new Date().toISOString(),
    timezone: tz,
  });
  const reply = await resolveIntent(admin, account, phoneNumber, intent);
  await sendReply(phoneNumber, reply);
};

type WaMedia = { kind: "audio" | "image" | "document"; mediaId: string; mime: string; name: string };

export const handleMedia = async (
  admin: SupabaseClient,
  phoneNumber: string,
  media: WaMedia,
  caption: string | undefined,
): Promise<void> => {
  const account = await findLinkedAccount(admin, phoneNumber);
  if (!account) {
    await sendMessage(phoneNumber, "🔗 This number isn't linked. Send /start <code> first.");
    return;
  }
  const dl = await downloadMedia(media.mediaId, media.name);

  if (media.kind === "audio") {
    let transcript = "";
    try {
      transcript = await transcribeAudio(dl.bytes, dl.mimeType);
    } catch {
      await sendMessage(phoneNumber, "Couldn't transcribe that voice note — try typing it.");
      return;
    }
    if (!transcript) {
      await sendMessage(phoneNumber, "I couldn't hear anything in that clip.");
      return;
    }
    await handleNaturalLanguage(admin, account, transcript);
    return;
  }

  const target = await loadLastEntity(admin, PROVIDER, account.user_id);
  if (!target || !ATTACH_ENTITY_TYPES.has(target.type)) {
    await sendMessage(phoneNumber, "I don't know what to attach this to yet. Create or open a record first (e.g. new client Acme), then resend the file.");
    return;
  }
  try {
    await attachToEntity(admin, account.current_org_id, account.user_id, target.type, target.id, dl.bytes, dl.mimeType, dl.fileName);
    await sendMessage(phoneNumber, `📎 Attached ${dl.fileName} to ${target.type} ${target.label}.`);
  } catch (err) {
    await sendMessage(phoneNumber, `❌ Couldn't attach that: ${(err as Error).message}`);
  }
};

export const handleInteractiveReply = async (
  admin: SupabaseClient,
  phoneNumber: string,
  buttonId: string,
): Promise<void> => {
  if (buttonId.startsWith("confirm:")) {
    const pendingId = buttonId.slice("confirm:".length);
    try {
      const msg = await executePending(admin, pendingId);
      await sendMessage(phoneNumber, msg);
    } catch (err) {
      await sendMessage(phoneNumber, `❌ ${(err as Error).message}`);
    }
    return;
  }
  if (buttonId.startsWith("cancel:")) {
    const pendingId = buttonId.slice("cancel:".length);
    await admin.from("agent_pending_actions").delete().eq("id", pendingId);
    await sendMessage(phoneNumber, "🛑 Cancelled.");
    return;
  }
  // Disambiguation choice (button tap or list selection).
  const reply = await sharedResume(admin, PROVIDER, phoneNumber, buttonId);
  await sendReply(phoneNumber, reply);
};
