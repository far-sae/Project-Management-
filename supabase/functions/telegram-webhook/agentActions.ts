// supabase/functions/telegram-webhook/agentActions.ts
// Platform-agnostic resolver. Takes a parsed Intent + a linked user and either
// returns a ConfirmReply (with a pending-action id), a choices reply for
// disambiguation, or a plain text error/help reply.

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { AgentReply, Intent, LinkedAccount } from "./types.ts";

const PENDING_TTL_MIN = 10;
const CONVO_TTL_MIN = 5;

// Queue a conversation state row: "I'm waiting for the user to send me X for
// this partial intent". The next inbound text on the same chat will be plugged
// into intent[awaitingField] and re-resolved.
const queueConvo = async (
  admin: SupabaseClient,
  account: LinkedAccount,
  chatId: string,
  awaitingField: "name" | "title" | "project" | "client" | "workspace",
  partialIntent: Intent,
): Promise<void> => {
  const expiresAt = new Date(Date.now() + CONVO_TTL_MIN * 60_000).toISOString();
  await admin.from("agent_conversation_state").upsert({
    provider: "telegram",
    chat_id: chatId,
    user_id: account.user_id,
    org_id: account.current_org_id,
    awaiting_field: awaitingField,
    partial_intent: partialIntent,
    expires_at: expiresAt,
  }, { onConflict: "provider,chat_id" });
};

export const clearConvo = async (
  admin: SupabaseClient,
  chatId: string,
): Promise<void> => {
  await admin
    .from("agent_conversation_state")
    .delete()
    .eq("provider", "telegram")
    .eq("chat_id", chatId);
};

export interface LoadedConvo {
  awaiting_field: "name" | "title" | "project" | "client" | "workspace";
  partial_intent: Intent;
}

export const loadConvo = async (
  admin: SupabaseClient,
  chatId: string,
): Promise<LoadedConvo | null> => {
  const { data } = await admin
    .from("agent_conversation_state")
    .select("awaiting_field, partial_intent, expires_at")
    .eq("provider", "telegram")
    .eq("chat_id", chatId)
    .maybeSingle();
  if (!data) return null;
  if (new Date((data.expires_at as string)).getTime() < Date.now()) {
    await clearConvo(admin, chatId);
    return null;
  }
  return {
    awaiting_field: data.awaiting_field as LoadedConvo["awaiting_field"],
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
  const rows = (data ?? []) as Array<Record<string, string>>;
  return {
    matches: rows.map((r) => ({ id: r[pkCol], name: r[nameCol] })),
  };
};

const queuePending = async (
  admin: SupabaseClient,
  account: LinkedAccount,
  chatId: string,
  intent: Intent,
  resolvedIds: Record<string, string>,
): Promise<string> => {
  const expiresAt = new Date(Date.now() + PENDING_TTL_MIN * 60_000).toISOString();
  // Opportunistic GC.
  await admin.from("agent_pending_actions").delete().lt("expires_at", new Date().toISOString());
  const { data, error } = await admin
    .from("agent_pending_actions")
    .insert({
      provider: "telegram",
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

export const resolveIntent = async (
  admin: SupabaseClient,
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
      return { kind: "text", text: "Use `/switchorg <name>` — e.g. `/switchorg Acme Corp`." };
    case "unknown":
      return { kind: "text", text: "I didn't catch that. Try `/help`, or rephrase." };

    case "create_workspace": {
      const name = (intent.name ?? intent.workspace ?? "").trim();
      if (!name) {
        await queueConvo(admin, account, chatId, "name", intent);
        return { kind: "text", text: "What should the workspace be called?" };
      }
      await clearConvo(admin, chatId);
      const pendingId = await queuePending(admin, account, chatId, intent, {});
      return {
        kind: "confirm",
        summary: `Create workspace *${name}*?`,
        pendingActionId: pendingId,
      };
    }

    case "create_project": {
      const name = (intent.name ?? intent.project ?? intent.title ?? "").trim();
      if (!name) {
        await queueConvo(admin, account, chatId, "name", intent);
        return { kind: "text", text: "What should the project be called?" };
      }
      let workspaceId: string | null = null;
      if (intent.workspace) {
        const { matches } = await findByName(admin, "workspaces", "name", "workspace_id", account.current_org_id, intent.workspace);
        if (matches.length === 0) {
          return {
            kind: "text",
            text: `No workspace called *${intent.workspace}*. Create it first or omit the workspace.`,
          };
        }
        if (matches.length > 1) {
          return {
            kind: "choices",
            prompt: `Multiple workspaces match *${intent.workspace}*. Pick one:`,
            choices: matches.map((m) => ({
              label: m.name,
              callback: `pickws:${m.id}`,
            })),
          };
        }
        workspaceId = matches[0].id;
      }
      await clearConvo(admin, chatId);
      const pendingId = await queuePending(admin, account, chatId, intent, workspaceId ? { workspace_id: workspaceId } : {});
      return {
        kind: "confirm",
        summary: `Create project *${name}*${intent.workspace ? ` in *${intent.workspace}*` : ""}?`,
        pendingActionId: pendingId,
      };
    }

    case "create_task": {
      const title = (intent.title ?? "").trim();
      if (!title) {
        await queueConvo(admin, account, chatId, "title", intent);
        return { kind: "text", text: "What's the task title?" };
      }
      if (!intent.project) {
        await queueConvo(admin, account, chatId, "project", intent);
        return { kind: "text", text: "Which project? e.g. `task: X in Q1 launch`." };
      }
      const { matches } = await findByName(admin, "projects", "name", "project_id", account.current_org_id, intent.project);
      if (matches.length === 0) {
        return { kind: "text", text: `No project called *${intent.project}*.` };
      }
      if (matches.length > 1) {
        return {
          kind: "choices",
          prompt: `Multiple projects match *${intent.project}*. Pick one:`,
          choices: matches.map((m) => ({ label: m.name, callback: `pickproj:${m.id}` })),
        };
      }
      await clearConvo(admin, chatId);
      const pendingId = await queuePending(admin, account, chatId, intent, { project_id: matches[0].id });
      const dueBit = intent.due ? ` due *${intent.due}*` : "";
      return {
        kind: "confirm",
        summary: `Create task *${title}* in *${matches[0].name}*${dueBit}?`,
        pendingActionId: pendingId,
      };
    }

    case "create_client": {
      const name = (intent.name ?? intent.client ?? "").trim();
      if (!name) {
        await queueConvo(admin, account, chatId, "name", intent);
        return { kind: "text", text: "What's the client name?" };
      }
      await clearConvo(admin, chatId);
      const pendingId = await queuePending(admin, account, chatId, intent, {});
      return {
        kind: "confirm",
        summary: `Create client *${name}*?`,
        pendingActionId: pendingId,
      };
    }

    case "create_client_task": {
      const title = (intent.title ?? "").trim();
      if (!title) {
        await queueConvo(admin, account, chatId, "title", intent);
        return { kind: "text", text: "What's the task title?" };
      }
      let clientId: string | null = null;
      if (intent.client) {
        const { matches } = await findByName(admin, "clients", "name", "client_id", account.current_org_id, intent.client);
        if (matches.length === 0) {
          return { kind: "text", text: `No client called *${intent.client}*.` };
        }
        if (matches.length > 1) {
          return {
            kind: "choices",
            prompt: `Multiple clients match *${intent.client}*. Pick one:`,
            choices: matches.map((m) => ({ label: m.name, callback: `pickclient:${m.id}` })),
          };
        }
        clientId = matches[0].id;
      }
      await clearConvo(admin, chatId);
      const pendingId = await queuePending(admin, account, chatId, intent, clientId ? { client_id: clientId } : {});
      const onBit = intent.client ? ` for *${intent.client}*` : "";
      const dueBit = intent.due ? ` due *${intent.due}*` : "";
      return {
        kind: "confirm",
        summary: `Create client task *${title}*${onBit}${dueBit}?`,
        pendingActionId: pendingId,
      };
    }
  }
};

export const executePending = async (
  admin: SupabaseClient,
  pendingId: string,
): Promise<string> => {
  // Returns a short success message; throws on error.
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
      default:
        throw new Error("Unsupported pending action.");
    }
  } finally {
    await admin.from("agent_pending_actions").delete().eq("id", pendingId);
  }
};

const HELP_TEXT = `*TaskCalendar bot — natural-language commands*

Examples:
• \`add workspace Acme Onboarding\`
• \`new project Q1 launch in Acme Onboarding\`
• \`task: call John tomorrow 3pm in Q1 launch\`
• \`new client Acme Corp\`
• \`client task: follow up with Acme on Friday\`

Slash commands:
• \`/orgs\` — list your orgs
• \`/switchorg <name>\` — switch current org
• \`/unlink\` — disconnect this chat
• \`/help\` — show this message`;

const formatOrgs = async (admin: SupabaseClient, account: LinkedAccount): Promise<string> => {
  // Membership lives on organizations.owner_id + organizations.members[] jsonb.
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
