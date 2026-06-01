// supabase/functions/_shared/agent/agentActions.ts
// Platform-agnostic resolver. Takes a parsed Intent + a linked user and either
// returns a ConfirmReply (with a pending-action id), a choices reply for
// disambiguation, or a plain text error/help reply.
//
// Used by both telegram-webhook and whatsapp-webhook. The provider argument
// scopes the agent_pending_actions and agent_conversation_state rows so the
// two chat surfaces don't cross-talk.

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { AgentProvider, AgentReply, Intent, LinkedAccount } from "./types.ts";

// Maps a choice-button callback prefix to the Intent.resolved_ids field it fills.
const PICK_FIELD: Record<string, string> = {
  pickws: "workspace_id",
  pickproj: "project_id",
  pickclient: "client_id",
};

/** Parses a "pick<prefix>:<uuid>" choice callback. Returns null for anything
 *  that isn't a known, non-empty pick callback (e.g. confirm:/cancel:). */
export const parsePickCallback = (
  cb: string,
): { idField: string; id: string } | null => {
  const idx = cb.indexOf(":");
  if (idx < 0) return null;
  const idField = PICK_FIELD[cb.slice(0, idx)];
  const id = cb.slice(idx + 1);
  if (!idField || !id) return null;
  return { idField, id };
};

const PENDING_TTL_MIN = 10;
const CONVO_TTL_MIN = 5;

export type AwaitingField = "name" | "title" | "project" | "client" | "workspace" | "company" | "due" | "body";

export interface LoadedConvo {
  awaiting_field: string;   // an AwaitingField, or "__pick:<id_field>" for disambiguation
  partial_intent: Intent;
}

const queueConvo = async (
  admin: SupabaseClient,
  provider: AgentProvider,
  account: LinkedAccount,
  chatId: string,
  awaitingField: AwaitingField,
  partialIntent: Intent,
): Promise<void> => {
  const expiresAt = new Date(Date.now() + CONVO_TTL_MIN * 60_000).toISOString();
  await admin.from("agent_conversation_state").upsert({
    provider,
    chat_id: chatId,
    user_id: account.user_id,
    org_id: account.current_org_id,
    awaiting_field: awaitingField,
    partial_intent: partialIntent,
    expires_at: expiresAt,
  }, { onConflict: "provider,chat_id" });
};

// Persist the in-flight intent while we wait for the user to tap a choice
// button. awaiting_field encodes which resolved_ids key the tap will fill,
// e.g. "__pick:project_id". Reuses the (provider, chat_id) conversation row
// and its 5-minute TTL.
const queueDisambiguation = async (
  admin: SupabaseClient,
  provider: AgentProvider,
  account: LinkedAccount,
  chatId: string,
  idField: string,
  partialIntent: Intent,
): Promise<void> => {
  const expiresAt = new Date(Date.now() + CONVO_TTL_MIN * 60_000).toISOString();
  await admin.from("agent_conversation_state").upsert({
    provider,
    chat_id: chatId,
    user_id: account.user_id,
    org_id: account.current_org_id,
    awaiting_field: `__pick:${idField}`,
    partial_intent: partialIntent,
    expires_at: expiresAt,
  }, { onConflict: "provider,chat_id" });
};

export const clearConvo = async (
  admin: SupabaseClient,
  provider: AgentProvider,
  chatId: string,
): Promise<void> => {
  await admin
    .from("agent_conversation_state")
    .delete()
    .eq("provider", provider)
    .eq("chat_id", chatId);
};

export const loadConvo = async (
  admin: SupabaseClient,
  provider: AgentProvider,
  chatId: string,
): Promise<LoadedConvo | null> => {
  const { data } = await admin
    .from("agent_conversation_state")
    .select("awaiting_field, partial_intent, expires_at")
    .eq("provider", provider)
    .eq("chat_id", chatId)
    .maybeSingle();
  if (!data) return null;
  if (new Date((data.expires_at as string)).getTime() < Date.now()) {
    await clearConvo(admin, provider, chatId);
    return null;
  }
  return {
    awaiting_field: data.awaiting_field as string,
    partial_intent: data.partial_intent as Intent,
  };
};

const findByName = async (
  admin: SupabaseClient,
  table: string,
  nameCol: string,
  pkCol: string,
  orgId: string,
  needle: string,
): Promise<{ matches: Array<{ id: string; name: string }> }> => {
  const { data } = await admin
    .from(table)
    .select(`${pkCol}, ${nameCol}`)
    .eq("organization_id", orgId)
    .ilike(nameCol, needle);
  const rows = (data ?? []) as unknown as Array<Record<string, string>>;
  return {
    matches: rows.map((r) => ({ id: r[pkCol], name: r[nameCol] })),
  };
};

type RefResult =
  | { status: "resolved"; id: string }
  | { status: "missing" }
  | { status: "ambiguous"; matches: Array<{ id: string; name: string }> };

// Resolve an entity reference: prefer a pre-resolved id (from a prior choice
// tap), else search by name. "missing" means no id and no/zero-match needle;
// the caller decides whether that's an error or "proceed without it".
const resolveRef = async (
  admin: SupabaseClient,
  orgId: string,
  intent: Intent,
  idField: string,
  needle: string | null | undefined,
  table: string,
  nameCol: string,
  pkCol: string,
): Promise<RefResult> => {
  const pre = intent.resolved_ids?.[idField];
  if (pre) return { status: "resolved", id: pre };
  const n = (needle ?? "").trim();
  if (!n) return { status: "missing" };
  const { matches } = await findByName(admin, table, nameCol, pkCol, orgId, n);
  if (matches.length === 0) return { status: "missing" };
  if (matches.length > 1) return { status: "ambiguous", matches };
  return { status: "resolved", id: matches[0].id };
};

// Persist the in-flight intent and return a choices reply. The tap callback
// "<pickPrefix>:<id>" will be resolved by resumeDisambiguation into idField.
const ambiguate = async (
  admin: SupabaseClient,
  provider: AgentProvider,
  account: LinkedAccount,
  chatId: string,
  intent: Intent,
  idField: string,
  matches: Array<{ id: string; name: string }>,
  prompt: string,
  pickPrefix: string,
): Promise<AgentReply> => {
  await queueDisambiguation(admin, provider, account, chatId, idField, intent);
  return {
    kind: "choices",
    prompt,
    choices: matches.map((m) => ({ label: m.name, callback: `${pickPrefix}:${m.id}` })),
  };
};

const queuePending = async (
  admin: SupabaseClient,
  provider: AgentProvider,
  account: LinkedAccount,
  chatId: string,
  intent: Intent,
  resolvedIds: Record<string, string>,
): Promise<string> => {
  const expiresAt = new Date(Date.now() + PENDING_TTL_MIN * 60_000).toISOString();
  await admin.from("agent_pending_actions").delete().lt("expires_at", new Date().toISOString());
  const { data, error } = await admin
    .from("agent_pending_actions")
    .insert({
      provider,
      chat_id: chatId,
      user_id: account.user_id,
      org_id: account.current_org_id,
      action: { ...intent, resolved_ids: resolvedIds },
      expires_at: expiresAt,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data!.id as string;
};

// Handle a choice-button tap. Loads the persisted partial intent, injects the
// chosen id into resolved_ids, clears the disambiguation state, and re-runs
// resolveIntent (which now skips the name search). The conversation row also
// holds user_id/org_id, so we can rebuild the account without a fresh lookup.
export const resumeDisambiguation = async (
  admin: SupabaseClient,
  provider: AgentProvider,
  chatId: string,
  callback: string,
): Promise<AgentReply> => {
  const pick = parsePickCallback(callback);
  if (!pick) {
    return { kind: "text", text: "Please rephrase the message with the full name." };
  }
  const { data } = await admin
    .from("agent_conversation_state")
    .select("partial_intent, user_id, org_id, expires_at")
    .eq("provider", provider)
    .eq("chat_id", chatId)
    .maybeSingle();
  if (!data || new Date(data.expires_at as string).getTime() < Date.now()) {
    await clearConvo(admin, provider, chatId);
    return { kind: "text", text: "That choice expired — please resend the command." };
  }
  const account: LinkedAccount = {
    user_id: data.user_id as string,
    current_org_id: data.org_id as string,
    external_id: chatId,
  };
  const base = data.partial_intent as Intent;
  const intent: Intent = {
    ...base,
    resolved_ids: { ...(base.resolved_ids ?? {}), [pick.idField]: pick.id },
  };
  await clearConvo(admin, provider, chatId);
  return resolveIntent(admin, provider, account, chatId, intent);
};

export const resolveIntent = async (
  admin: SupabaseClient,
  provider: AgentProvider,
  account: LinkedAccount,
  chatId: string,
  intent: Intent,
): Promise<AgentReply> => {
  switch (intent.action) {
    case "help":
      return { kind: "text", text: HELP_TEXT };
    case "list_orgs":
      return { kind: "text", text: await formatOrgs(admin, account) };
    case "switch_org":
      return { kind: "text", text: "Use `/switchorg <name>` (e.g. `/switchorg Acme Corp`)." };
    case "unknown":
      return { kind: "text", text: "I didn't catch that. Try `/help`, or rephrase." };

    case "create_workspace": {
      const name = (intent.name ?? intent.workspace ?? "").trim();
      if (!name) {
        await queueConvo(admin, provider, account, chatId, "name", intent);
        return { kind: "text", text: "What should the workspace be called?" };
      }
      await clearConvo(admin, provider, chatId);
      const pendingId = await queuePending(admin, provider, account, chatId, intent, {});
      return { kind: "confirm", summary: `Create workspace *${name}*?`, pendingActionId: pendingId };
    }

    case "create_project": {
      const name = (intent.name ?? intent.project ?? intent.title ?? "").trim();
      if (!name) {
        await queueConvo(admin, provider, account, chatId, "name", intent);
        return { kind: "text", text: "What should the project be called?" };
      }
      let workspaceId: string | null = null;
      if (intent.resolved_ids?.workspace_id || intent.workspace) {
        const ref = await resolveRef(admin, account.current_org_id, intent, "workspace_id", intent.workspace, "workspaces", "name", "workspace_id");
        if (ref.status === "missing") {
          return { kind: "text", text: `No workspace called *${intent.workspace}*. Create it first or omit the workspace.` };
        }
        if (ref.status === "ambiguous") {
          return ambiguate(admin, provider, account, chatId, intent, "workspace_id", ref.matches, `Multiple workspaces match *${intent.workspace}*. Pick one:`, "pickws");
        }
        workspaceId = ref.id;
      }
      await clearConvo(admin, provider, chatId);
      const pendingId = await queuePending(admin, provider, account, chatId, intent, workspaceId ? { workspace_id: workspaceId } : {});
      return {
        kind: "confirm",
        summary: `Create project *${name}*${intent.workspace ? ` in *${intent.workspace}*` : ""}?`,
        pendingActionId: pendingId,
      };
    }

    case "create_task": {
      const title = (intent.title ?? "").trim();
      if (!title) {
        await queueConvo(admin, provider, account, chatId, "title", intent);
        return { kind: "text", text: "What's the task title?" };
      }
      if (!intent.resolved_ids?.project_id && !intent.project) {
        await queueConvo(admin, provider, account, chatId, "project", intent);
        return { kind: "text", text: "Which project? e.g. `task: X in Q1 launch`." };
      }
      const ref = await resolveRef(admin, account.current_org_id, intent, "project_id", intent.project, "projects", "name", "project_id");
      if (ref.status === "missing") {
        return { kind: "text", text: `No project called *${intent.project}*.` };
      }
      if (ref.status === "ambiguous") {
        return ambiguate(admin, provider, account, chatId, intent, "project_id", ref.matches, `Multiple projects match *${intent.project}*. Pick one:`, "pickproj");
      }
      await clearConvo(admin, provider, chatId);
      const pendingId = await queuePending(admin, provider, account, chatId, intent, { project_id: ref.id });
      const dueBit = intent.due ? ` due *${intent.due}*` : "";
      return { kind: "confirm", summary: `Create task *${title}* in *${intent.project ?? "project"}*${dueBit}?`, pendingActionId: pendingId };
    }

    case "create_client": {
      const name = (intent.name ?? intent.client ?? "").trim();
      if (!name) {
        await queueConvo(admin, provider, account, chatId, "name", intent);
        return { kind: "text", text: "What's the client name?" };
      }
      await clearConvo(admin, provider, chatId);
      const pendingId = await queuePending(admin, provider, account, chatId, intent, {});
      return { kind: "confirm", summary: `Create client *${name}*?`, pendingActionId: pendingId };
    }

    case "create_client_task": {
      const title = (intent.title ?? "").trim();
      if (!title) {
        await queueConvo(admin, provider, account, chatId, "title", intent);
        return { kind: "text", text: "What's the task title?" };
      }
      let clientId: string | null = null;
      if (intent.resolved_ids?.client_id || intent.client) {
        const ref = await resolveRef(admin, account.current_org_id, intent, "client_id", intent.client, "clients", "name", "client_id");
        if (ref.status === "missing") {
          return { kind: "text", text: `No client called *${intent.client}*.` };
        }
        if (ref.status === "ambiguous") {
          return ambiguate(admin, provider, account, chatId, intent, "client_id", ref.matches, `Multiple clients match *${intent.client}*. Pick one:`, "pickclient");
        }
        clientId = ref.id;
      }
      await clearConvo(admin, provider, chatId);
      const pendingId = await queuePending(admin, provider, account, chatId, intent, clientId ? { client_id: clientId } : {});
      const onBit = intent.client ? ` for *${intent.client}*` : "";
      const dueBit = intent.due ? ` due *${intent.due}*` : "";
      return { kind: "confirm", summary: `Create client task *${title}*${onBit}${dueBit}?`, pendingActionId: pendingId };
    }

    // ─── CRM intents ──────────────────────────────────────────────────
    case "create_lead": {
      // A lead needs a last_name + a company; the LLM fills both via
      // the `name` (last name) + `company` fields. Prompt for whatever
      // the user didn't supply.
      const lastName = (intent.name ?? "").trim();
      const company = (intent.company ?? "").trim();
      if (!lastName) {
        await queueConvo(admin, provider, account, chatId, "name", intent);
        return { kind: "text", text: "What's the lead's name?" };
      }
      if (!company) {
        await queueConvo(admin, provider, account, chatId, "company", intent);
        return { kind: "text", text: `Got *${lastName}* — what company are they from?` };
      }
      await clearConvo(admin, provider, chatId);
      const pendingId = await queuePending(admin, provider, account, chatId, intent, {});
      const emailBit = intent.email ? ` (${intent.email})` : "";
      return { kind: "confirm", summary: `Create lead *${lastName}* at *${company}*${emailBit}?`, pendingActionId: pendingId };
    }

    case "create_contact": {
      const lastName = (intent.name ?? "").trim();
      if (!lastName) {
        await queueConvo(admin, provider, account, chatId, "name", intent);
        return { kind: "text", text: "What's the contact's name?" };
      }
      if (!intent.resolved_ids?.client_id && !intent.client) {
        return { kind: "text", text: `Which client does *${lastName}* belong to?` };
      }
      const ref = await resolveRef(admin, account.current_org_id, intent, "client_id", intent.client, "clients", "name", "client_id");
      if (ref.status === "missing") {
        return { kind: "text", text: `No client called *${intent.client}*.` };
      }
      if (ref.status === "ambiguous") {
        return ambiguate(admin, provider, account, chatId, intent, "client_id", ref.matches, `Multiple clients match *${intent.client}*. Pick one:`, "pickclient");
      }
      await clearConvo(admin, provider, chatId);
      const pendingId = await queuePending(admin, provider, account, chatId, intent, { client_id: ref.id });
      return { kind: "confirm", summary: `Add contact *${lastName}* under *${intent.client ?? "client"}*?`, pendingActionId: pendingId };
    }

    case "create_deal": {
      const title = (intent.title ?? intent.name ?? "").trim();
      if (!title) {
        await queueConvo(admin, provider, account, chatId, "title", intent);
        return { kind: "text", text: "What's the deal title?" };
      }
      let clientId: string | null = null;
      if (intent.resolved_ids?.client_id || intent.client) {
        const ref = await resolveRef(admin, account.current_org_id, intent, "client_id", intent.client, "clients", "name", "client_id");
        if (ref.status === "ambiguous") {
          return ambiguate(admin, provider, account, chatId, intent, "client_id", ref.matches, `Multiple clients match *${intent.client}*. Pick one:`, "pickclient");
        }
        if (ref.status === "resolved") clientId = ref.id;
        // "missing" → create the deal without a client, as before.
      }
      await clearConvo(admin, provider, chatId);
      const pendingId = await queuePending(admin, provider, account, chatId, intent, clientId ? { client_id: clientId } : {});
      const valueBit = intent.value ? ` worth *${intent.value} ${intent.currency ?? ""}*`.trim() : "";
      const clientBit = intent.client ? ` for *${intent.client}*` : "";
      return { kind: "confirm", summary: `Create deal *${title}*${clientBit}${valueBit}?`, pendingActionId: pendingId };
    }

    case "create_meeting": {
      const title = (intent.title ?? "").trim();
      if (!title) {
        await queueConvo(admin, provider, account, chatId, "title", intent);
        return { kind: "text", text: "What should the meeting be called?" };
      }
      if (!intent.due) {
        await queueConvo(admin, provider, account, chatId, "due", intent);
        return { kind: "text", text: `When is *${title}*? (e.g. tomorrow 3pm)` };
      }
      // Optional client resolution — meetings can be standalone.
      let clientId: string | null = null;
      if (intent.client) {
        const { matches } = await findByName(admin, "clients", "name", "client_id", account.current_org_id, intent.client);
        if (matches.length === 1) clientId = matches[0].id;
      }
      await clearConvo(admin, provider, chatId);
      const pendingId = await queuePending(admin, provider, account, chatId, intent, clientId ? { client_id: clientId } : {});
      return { kind: "confirm", summary: `Schedule meeting *${title}* at *${intent.due}*?`, pendingActionId: pendingId };
    }

    case "create_call": {
      const subject = (intent.title ?? intent.name ?? "").trim();
      if (!subject) {
        await queueConvo(admin, provider, account, chatId, "title", intent);
        return { kind: "text", text: "What's the call about?" };
      }
      let clientId: string | null = null;
      if (intent.client) {
        const { matches } = await findByName(admin, "clients", "name", "client_id", account.current_org_id, intent.client);
        if (matches.length === 1) clientId = matches[0].id;
      }
      await clearConvo(admin, provider, chatId);
      const pendingId = await queuePending(admin, provider, account, chatId, intent, clientId ? { client_id: clientId } : {});
      const whenBit = intent.due ? ` for *${intent.due}*` : intent.outcome ? " (completed)" : "";
      return { kind: "confirm", summary: `Log call *${subject}*${whenBit}?`, pendingActionId: pendingId };
    }

    case "log_note": {
      const body = (intent.body ?? intent.description ?? "").trim();
      if (!body) {
        await queueConvo(admin, provider, account, chatId, "body", intent);
        return { kind: "text", text: "What's the note?" };
      }
      if (!intent.resolved_ids?.client_id && !intent.client) {
        return { kind: "text", text: "Which client is the note for?" };
      }
      const ref = await resolveRef(admin, account.current_org_id, intent, "client_id", intent.client, "clients", "name", "client_id");
      if (ref.status === "missing") {
        return { kind: "text", text: `No client called *${intent.client}*.` };
      }
      if (ref.status === "ambiguous") {
        return ambiguate(admin, provider, account, chatId, intent, "client_id", ref.matches, `Multiple clients match *${intent.client}*. Pick one:`, "pickclient");
      }
      await clearConvo(admin, provider, chatId);
      const pendingId = await queuePending(admin, provider, account, chatId, intent, { client_id: ref.id });
      const preview = body.length > 60 ? `${body.slice(0, 60)}…` : body;
      return { kind: "confirm", summary: `Add note *"${preview}"* on *${intent.client ?? "client"}*?`, pendingActionId: pendingId };
    }
  }
};

export const executePending = async (
  admin: SupabaseClient,
  pendingId: string,
): Promise<string> => {
  const { data: row, error } = await admin
    .from("agent_pending_actions")
    .select("*")
    .eq("id", pendingId)
    .maybeSingle();
  if (error || !row) throw new Error("Pending action not found or expired.");
  if (new Date(row.expires_at).getTime() < Date.now()) {
    await admin.from("agent_pending_actions").delete().eq("id", pendingId);
    throw new Error("That request expired. Please resend the message.");
  }

  const a = row.action as Intent & { resolved_ids?: Record<string, string> };

  try {
    switch (a.action) {
      case "create_workspace": {
        const name = (a.name ?? a.workspace ?? "").trim();
        const { data, error: e } = await admin.rpc("agent_create_workspace", {
          p_user_id: row.user_id, p_organization_id: row.org_id, p_name: name,
        });
        if (e) throw e;
        return `✅ Workspace *${data.name}* created.`;
      }
      case "create_project": {
        const name = (a.name ?? a.project ?? a.title ?? "").trim();
        const wsId = a.resolved_ids?.workspace_id ?? null;
        const { data, error: e } = await admin.rpc("agent_create_project", {
          p_user_id: row.user_id,
          p_organization_id: row.org_id,
          p_workspace_id: wsId,
          p_name: name,
          p_description: a.description ?? null,
        });
        if (e) throw e;
        return `✅ Project *${data.name}* created.`;
      }
      case "create_task": {
        const title = (a.title ?? "").trim();
        const projId = a.resolved_ids?.project_id;
        if (!projId) throw new Error("Project not resolved.");
        const { data, error: e } = await admin.rpc("agent_create_task", {
          p_user_id: row.user_id,
          p_organization_id: row.org_id,
          p_project_id: projId,
          p_title: title,
          p_due_at: a.due ?? null,
          p_description: a.description ?? null,
        });
        if (e) throw e;
        return `✅ Task *${data.title}* created.`;
      }
      case "create_client": {
        const name = (a.name ?? a.client ?? "").trim();
        const { data, error: e } = await admin.rpc("crm_create_client_as", {
          p_user_id: row.user_id,
          p_organization_id: row.org_id,
          p_client: { name },
        });
        if (e) throw e;
        return `✅ Client *${data.name}* created.`;
      }
      case "create_client_task": {
        const title = (a.title ?? "").trim();
        const clientId = a.resolved_ids?.client_id ?? null;
        const { data, error: e } = await admin.rpc("crm_create_client_task_as", {
          p_user_id: row.user_id,
          p_organization_id: row.org_id,
          p_task: {
            title,
            client_id: clientId,
            due_at: a.due ?? null,
            description: a.description ?? null,
          },
        });
        if (e) throw e;
        return `✅ Client task *${data.title}* created.`;
      }

      // ─── CRM intent execution ────────────────────────────────────────
      // Use direct INSERTs (admin client = service role) rather than
      // adding new agent_*_as RPCs for every entity. The existing
      // org-membership check happens above (loadAccount in the calling
      // webhooks); we trust that boundary.
      case "create_lead": {
        // workspace_id required by RLS — pick the org's first workspace.
        const { data: ws } = await admin
          .from("workspaces").select("workspace_id")
          .eq("organization_id", row.org_id)
          .order("created_at", { ascending: true })
          .limit(1).maybeSingle();
        const workspaceId = (ws as { workspace_id?: string } | null)?.workspace_id ?? null;
        // lead_number from RPC or synthetic fallback.
        let leadNumber: string;
        const { data: numData } = await admin
          .rpc("next_lead_number", { p_organization_id: row.org_id });
        leadNumber = numData ? String(numData) : `L-BOT-${Date.now().toString(36).toUpperCase()}`;

        const { data, error: e } = await admin.from("leads").insert({
          organization_id: row.org_id,
          workspace_id: workspaceId,
          lead_number: leadNumber,
          last_name: (a.name ?? "").trim() || "Lead",
          company: (a.company ?? "").trim() || "Bot-created lead",
          email: a.email ?? null,
          phone: a.phone ?? null,
          description: a.description ?? null,
          lead_source: "Chat bot",
          created_by: row.user_id,
        }).select("lead_number, last_name, company").single();
        if (e) throw e;
        const r = data as { lead_number: string; last_name: string; company: string };
        return `✅ Lead *${r.last_name}* at *${r.company}* created (${r.lead_number}).`;
      }

      case "create_contact": {
        const clientId = a.resolved_ids?.client_id ?? null;
        if (!clientId) throw new Error("Contact needs a parent client.");
        const { data, error: e } = await admin.from("client_contacts").insert({
          organization_id: row.org_id,
          client_id: clientId,
          last_name: (a.name ?? "").trim() || "Contact",
          email: a.email ?? null,
          phone: a.phone ?? null,
          mobile: a.phone ?? null,
          created_by: row.user_id,
        }).select("last_name").single();
        if (e) throw e;
        return `✅ Contact *${(data as { last_name: string }).last_name}* added.`;
      }

      case "create_deal": {
        const clientId = a.resolved_ids?.client_id ?? null;
        const title = (a.title ?? a.name ?? "").trim() || "New deal";
        // Pick the default pipeline + first stage so the deal lands
        // somewhere sensible even when the bot doesn't know about
        // pipelines.
        const { data: pipeline } = await admin
          .from("pipelines").select("pipeline_id")
          .eq("organization_id", row.org_id)
          .order("created_at", { ascending: true })
          .limit(1).maybeSingle();
        const pipelineId = (pipeline as { pipeline_id?: string } | null)?.pipeline_id ?? null;
        let stageId: string | null = null;
        if (pipelineId) {
          const { data: stage } = await admin
            .from("pipeline_stages").select("stage_id")
            .eq("pipeline_id", pipelineId)
            .order("position", { ascending: true })
            .limit(1).maybeSingle();
          stageId = (stage as { stage_id?: string } | null)?.stage_id ?? null;
        }
        const { data, error: e } = await admin.from("deals").insert({
          organization_id: row.org_id,
          pipeline_id: pipelineId,
          stage_id: stageId,
          client_id: clientId,
          title,
          owner_id: row.user_id,
          value: a.value ?? 0,
          currency: (a.currency ?? "USD").toUpperCase(),
          stage: a.stage ?? "lead",
          expected_close_date: a.due ? a.due.slice(0, 10) : null,
        }).select("title").single();
        if (e) throw e;
        return `✅ Deal *${(data as { title: string }).title}* created.`;
      }

      case "create_meeting": {
        const clientId = a.resolved_ids?.client_id ?? null;
        const title = (a.title ?? "").trim() || "Meeting";
        const startAt = a.due ? new Date(a.due) : new Date(Date.now() + 60 * 60 * 1000);
        const endAt = new Date(startAt.getTime() + 30 * 60 * 1000);
        const { data, error: e } = await admin.from("meetings").insert({
          organization_id: row.org_id,
          title,
          start_at: startAt.toISOString(),
          end_at: endAt.toISOString(),
          host_user_id: row.user_id,
          client_id: clientId,
          related_to_type: clientId ? "client" : null,
          related_to_id: clientId,
          description: a.description ?? null,
          created_by: row.user_id,
        }).select("title").single();
        if (e) throw e;
        return `✅ Meeting *${(data as { title: string }).title}* scheduled.`;
      }

      case "create_call": {
        const clientId = a.resolved_ids?.client_id ?? null;
        const subject = (a.title ?? a.name ?? "Call").trim();
        const completed = !!a.outcome;
        const { data, error: e } = await admin.from("calls").insert({
          organization_id: row.org_id,
          subject,
          call_status: completed ? "completed" : "scheduled",
          call_type: completed ? "outbound" : "scheduled",
          call_start_at: a.due ? new Date(a.due).toISOString() : null,
          caller_user_id: row.user_id,
          client_id: clientId,
          related_to_type: clientId ? "client" : null,
          related_to_id: clientId,
          outcome: a.outcome ?? null,
          description: a.description ?? null,
          created_by: row.user_id,
        }).select("subject").single();
        if (e) throw e;
        return `✅ Call *${(data as { subject: string }).subject}* logged.`;
      }

      case "log_note": {
        const clientId = a.resolved_ids?.client_id ?? null;
        if (!clientId) throw new Error("Note needs a client.");
        const body = (a.body ?? a.description ?? "").trim();
        const { error: e } = await admin.from("client_notes").insert({
          organization_id: row.org_id,
          client_id: clientId,
          kind: "note",
          body,
          occurred_at: new Date().toISOString(),
          author_id: row.user_id,
        });
        if (e) throw e;
        const preview = body.length > 50 ? `${body.slice(0, 50)}…` : body;
        return `✅ Note *"${preview}"* logged.`;
      }
      default:
        throw new Error("Unsupported pending action.");
    }
  } finally {
    await admin.from("agent_pending_actions").delete().eq("id", pendingId);
  }
};

const HELP_TEXT = `*TaskCalendar bot — natural-language commands*

*Projects + tasks*
• \`add workspace Acme Onboarding\`
• \`new project Q1 launch in Acme Onboarding\`
• \`task: call John tomorrow 3pm in Q1 launch\`

*CRM*
• \`new client Acme Corp\`
• \`new lead Jane Smith from Acme jane@acme.com\`
• \`add contact Bob Jones under Acme Corp\`
• \`new deal Website redesign for Acme worth 10000 USD\`
• \`schedule meeting Discovery call with Acme tomorrow 3pm\`
• \`log call: pricing chat with Acme — they want to renew\`
• \`note on Acme: spoke to legal, contract going through\`
• \`client task: follow up with Acme on Friday\`

*Commands*
• \`/orgs\` — list your orgs
• \`/switchorg <name>\` — switch current org
• \`/cancel\` — drop a pending prompt
• \`/unlink\` — disconnect this chat
• \`/help\` — show this message`;

const formatOrgs = async (admin: SupabaseClient, account: LinkedAccount): Promise<string> => {
  const { data: owned } = await admin
    .from("organizations")
    .select("organization_id, name")
    .eq("owner_id", account.user_id);
  const { data: memberOf } = await admin
    .from("organizations")
    .select("organization_id, name, members")
    .contains("members", [{ userId: account.user_id }]);
  const map = new Map<string, string>();
  for (const r of (owned ?? []) as Array<{ organization_id: string; name: string }>) {
    map.set(r.organization_id, r.name);
  }
  for (const r of (memberOf ?? []) as Array<{ organization_id: string; name: string }>) {
    if (!map.has(r.organization_id)) map.set(r.organization_id, r.name);
  }
  if (map.size === 0) return "You're not in any orgs yet.";
  return Array.from(map.entries())
    .map(([id, name]) => `${id === account.current_org_id ? "▶" : " "} ${name}`)
    .join("\n");
};
