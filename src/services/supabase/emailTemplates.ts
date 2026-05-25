import { supabase } from "./config";
import { logger } from "@/lib/logger";

export interface EmailTemplate {
  templateId: string;
  organizationId: string;
  name: string;
  subject: string | null;
  body: string | null;
  createdBy: string | null;
  createdByName: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateEmailTemplateInput {
  name: string;
  subject?: string | null;
  body?: string | null;
}

export type UpdateEmailTemplateInput = Partial<CreateEmailTemplateInput>;

const STORE_KEY = (orgId: string) => `pm_email_templates_${orgId}`;
const isLocalOrg = (orgId: string) => orgId.startsWith("local-");

const reviveTemplate = (t: EmailTemplate): EmailTemplate => ({
  ...t,
  createdAt: new Date(t.createdAt),
  updatedAt: new Date(t.updatedAt),
});

const readLocal = (orgId: string): EmailTemplate[] => {
  try {
    const raw = localStorage.getItem(STORE_KEY(orgId));
    if (!raw) return [];
    return (JSON.parse(raw) as EmailTemplate[]).map(reviveTemplate);
  } catch {
    return [];
  }
};

const writeLocal = (orgId: string, items: EmailTemplate[]) => {
  try {
    localStorage.setItem(STORE_KEY(orgId), JSON.stringify(items));
  } catch {
    /* ignore */
  }
};

const mapTemplate = (row: Record<string, unknown>): EmailTemplate => ({
  templateId: row.template_id as string,
  organizationId: row.organization_id as string,
  name: row.name as string,
  subject: (row.subject as string) ?? null,
  body: (row.body as string) ?? null,
  createdBy: (row.created_by as string) ?? null,
  createdByName: (row.created_by_name as string) ?? null,
  createdAt: new Date(row.created_at as string),
  updatedAt: new Date(row.updated_at as string),
});

const sanitize = (v: string | null | undefined): string | null => {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length === 0 ? null : s;
};

const validateInput = (input: CreateEmailTemplateInput) => {
  if (!input.name || !sanitize(input.name)) {
    throw new Error("Template name is required");
  }
  if (input.name.length > 120) {
    throw new Error("Template name must be 120 characters or fewer");
  }
};

export const listEmailTemplates = async (
  organizationId: string,
): Promise<EmailTemplate[]> => {
  if (isLocalOrg(organizationId)) {
    return readLocal(organizationId).sort(
      (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime(),
    );
  }
  const { data, error } = await supabase
    .from("crm_email_templates")
    .select("*")
    .eq("organization_id", organizationId)
    .order("updated_at", { ascending: false });
  if (error) {
    logger.error("Failed to load email templates:", error);
    return [];
  }
  return (data || []).map(mapTemplate);
};

export const createEmailTemplate = async (
  organizationId: string,
  userId: string | null,
  userName: string | null,
  input: CreateEmailTemplateInput,
): Promise<EmailTemplate> => {
  validateInput(input);

  if (isLocalOrg(organizationId)) {
    const now = new Date();
    const tpl: EmailTemplate = {
      templateId: crypto.randomUUID(),
      organizationId,
      name: sanitize(input.name)!,
      subject: sanitize(input.subject ?? null),
      body: sanitize(input.body ?? null),
      createdBy: userId,
      createdByName: userName,
      createdAt: now,
      updatedAt: now,
    };
    const all = readLocal(organizationId);
    writeLocal(organizationId, [tpl, ...all]);
    return tpl;
  }

  const { data, error } = await supabase
    .from("crm_email_templates")
    .insert({
      organization_id: organizationId,
      name: sanitize(input.name)!,
      subject: sanitize(input.subject ?? null),
      body: sanitize(input.body ?? null),
      created_by: userId,
      created_by_name: userName,
    })
    .select()
    .single();

  if (error) {
    const code = (error as { code?: string }).code;
    const msg = String((error as { message?: string }).message ?? "");
    if (code === "23505") {
      throw new Error(
        "A template with this name already exists in this workspace. Pick a different name.",
      );
    }
    if (code === "42501" || /row-level security|permission denied/i.test(msg)) {
      throw new Error(
        "You do not have permission to create email templates in this workspace.",
      );
    }
    logger.error("Failed to create email template:", error);
    throw error;
  }
  return mapTemplate(data as Record<string, unknown>);
};

export const updateEmailTemplate = async (
  organizationId: string,
  templateId: string,
  input: UpdateEmailTemplateInput,
): Promise<EmailTemplate> => {
  if (input.name !== undefined && !sanitize(input.name)) {
    throw new Error("Template name cannot be empty");
  }

  if (isLocalOrg(organizationId)) {
    const all = readLocal(organizationId);
    const idx = all.findIndex((t) => t.templateId === templateId);
    if (idx === -1) throw new Error("Template not found");
    const merged: EmailTemplate = { ...all[idx] };
    if (input.name !== undefined) merged.name = sanitize(input.name) ?? merged.name;
    if (input.subject !== undefined) merged.subject = sanitize(input.subject);
    if (input.body !== undefined) merged.body = sanitize(input.body);
    merged.updatedAt = new Date();
    all[idx] = merged;
    writeLocal(organizationId, all);
    return merged;
  }

  const patch: Record<string, unknown> = {};
  if (input.name !== undefined) patch.name = sanitize(input.name);
  if (input.subject !== undefined) patch.subject = sanitize(input.subject);
  if (input.body !== undefined) patch.body = sanitize(input.body);

  const { data, error } = await supabase
    .from("crm_email_templates")
    .update(patch)
    .eq("organization_id", organizationId)
    .eq("template_id", templateId)
    .select()
    .single();

  if (error) {
    const code = (error as { code?: string }).code;
    if (code === "23505") {
      throw new Error("A template with this name already exists in this workspace.");
    }
    logger.error("Failed to update email template:", error);
    throw error;
  }
  return mapTemplate(data as Record<string, unknown>);
};

export const deleteEmailTemplate = async (
  organizationId: string,
  templateId: string,
): Promise<void> => {
  if (isLocalOrg(organizationId)) {
    writeLocal(
      organizationId,
      readLocal(organizationId).filter((t) => t.templateId !== templateId),
    );
    return;
  }
  const { error } = await supabase
    .from("crm_email_templates")
    .delete()
    .eq("organization_id", organizationId)
    .eq("template_id", templateId);
  if (error) {
    logger.error("Failed to delete email template:", error);
    throw error;
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Merge tokens — keep tiny and explicit. The composer expands these client-side
// before opening a mailto: link, so there is no server-side eval risk.
// ─────────────────────────────────────────────────────────────────────────────

export interface MergeContext {
  client?: {
    name?: string | null;
    legalName?: string | null;
    email?: string | null;
    industry?: string | null;
    country?: string | null;
    accountOwnerName?: string | null;
  } | null;
  user?: {
    name?: string | null;
    email?: string | null;
  } | null;
}

export const MERGE_TOKENS: { token: string; label: string }[] = [
  { token: "{{client.name}}",           label: "Client name" },
  { token: "{{client.legalName}}",      label: "Legal name" },
  { token: "{{client.email}}",          label: "Client email" },
  { token: "{{client.industry}}",       label: "Industry" },
  { token: "{{client.country}}",        label: "Country" },
  { token: "{{client.accountOwner}}",   label: "Account owner" },
  { token: "{{user.name}}",             label: "Your name" },
  { token: "{{user.email}}",            label: "Your email" },
];

const tokenValue = (token: string, ctx: MergeContext): string => {
  const key = token.replace(/[{}]/g, "").trim();
  const [scope, field] = key.split(".");
  if (scope === "client" && ctx.client) {
    switch (field) {
      case "name":         return ctx.client.name ?? "";
      case "legalName":    return ctx.client.legalName ?? "";
      case "email":        return ctx.client.email ?? "";
      case "industry":     return ctx.client.industry ?? "";
      case "country":      return ctx.client.country ?? "";
      case "accountOwner": return ctx.client.accountOwnerName ?? "";
    }
  }
  if (scope === "user" && ctx.user) {
    switch (field) {
      case "name":  return ctx.user.name ?? "";
      case "email": return ctx.user.email ?? "";
    }
  }
  return "";
};

export const expandTemplate = (
  text: string | null | undefined,
  ctx: MergeContext,
): string => {
  if (!text) return "";
  return text.replace(/\{\{\s*[\w.]+\s*\}\}/g, (m) => tokenValue(m, ctx));
};
