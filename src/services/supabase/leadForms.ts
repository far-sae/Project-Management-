// src/services/supabase/leadForms.ts
import { supabase } from "./config";
import { logger } from "@/lib/logger";

export type FieldType = "text" | "email" | "tel" | "url" | "textarea" | "select" | "number";

export interface FormField {
  key: string;
  label: string;
  type: FieldType;
  required: boolean;
  maxLength?: number;
  options?: string[];
}

export interface LeadForm {
  formId: string;
  organizationId: string;
  pipelineId: string;
  slug: string;
  title: string;
  description: string | null;
  fields: FormField[];
  thankYouMessage: string;
  redirectUrl: string | null;
  turnstileEnabled: boolean;
  rateLimitPerMinute: number;
  rateLimitPerHour: number;
  status: "active" | "paused" | "archived";
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const SLUG_RE = /^[a-z0-9-]{3,40}$/;
const RESERVED_KEYS = new Set(["_hp"]);

export const validateSlug = (slug: string): void => {
  if (!SLUG_RE.test(slug)) throw new Error("Slug must be 3–40 chars, lowercase letters, digits, hyphens.");
};

export const validateFormFields = (fields: FormField[]): void => {
  if (!Array.isArray(fields) || fields.length === 0) {
    throw new Error("Form must have at least one field.");
  }
  const keys = new Set<string>();
  let hasName = false;
  let hasEmail = false;
  for (const f of fields) {
    if (!f.key || RESERVED_KEYS.has(f.key)) throw new Error(`Invalid field key '${f.key}'`);
    if (keys.has(f.key)) throw new Error(`Duplicate field key '${f.key}'`);
    keys.add(f.key);
    if (!f.label?.trim()) throw new Error(`Field '${f.key}' missing label`);
    if (f.type === "select" && (!f.options || f.options.length === 0)) {
      throw new Error(`Select field '${f.key}' must have options`);
    }
    if (f.key === "name") hasName = true;
    if (f.key === "email") hasEmail = true;
  }
  if (!hasName) throw new Error("A 'name' field is required.");
  if (!hasEmail) throw new Error("An 'email' field is required.");
};

const mapForm = (r: Record<string, unknown>): LeadForm => ({
  formId: r.form_id as string,
  organizationId: r.organization_id as string,
  pipelineId: r.pipeline_id as string,
  slug: r.slug as string,
  title: r.title as string,
  description: (r.description as string) ?? null,
  fields: Array.isArray(r.fields) ? (r.fields as FormField[]) : [],
  thankYouMessage: r.thank_you_message as string,
  redirectUrl: (r.redirect_url as string) ?? null,
  turnstileEnabled: Boolean(r.turnstile_enabled),
  rateLimitPerMinute: Number(r.rate_limit_per_minute ?? 10),
  rateLimitPerHour: Number(r.rate_limit_per_hour ?? 100),
  status: (r.status as LeadForm["status"]) ?? "active",
  createdBy: (r.created_by as string) ?? null,
  createdAt: new Date(r.created_at as string),
  updatedAt: new Date(r.updated_at as string),
});

export const getOrganizationForms = async (
  organizationId: string,
): Promise<LeadForm[]> => {
  const { data, error } = await supabase
    .from("lead_forms")
    .select("*")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false });
  if (error) {
    logger.error("Failed to load lead forms:", error);
    return [];
  }
  return (data || []).map(mapForm);
};

export interface CreateFormInput {
  pipelineId: string;
  slug: string;
  title: string;
  description?: string | null;
  fields: FormField[];
  thankYouMessage?: string;
  redirectUrl?: string | null;
  turnstileEnabled?: boolean;
  rateLimitPerMinute?: number;
  rateLimitPerHour?: number;
}

export const createForm = async (
  organizationId: string,
  input: CreateFormInput,
): Promise<LeadForm> => {
  validateSlug(input.slug);
  validateFormFields(input.fields);
  if (input.redirectUrl && input.thankYouMessage) {
    // Treat redirect as mutually exclusive (server keeps either, prefers redirect).
  }
  const { data, error } = await supabase
    .from("lead_forms")
    .insert({
      organization_id: organizationId,
      pipeline_id: input.pipelineId,
      slug: input.slug,
      title: input.title,
      description: input.description ?? null,
      fields: input.fields,
      thank_you_message: input.thankYouMessage ?? "Thanks — we got it.",
      redirect_url: input.redirectUrl ?? null,
      turnstile_enabled: input.turnstileEnabled ?? false,
      rate_limit_per_minute: input.rateLimitPerMinute ?? 10,
      rate_limit_per_hour: input.rateLimitPerHour ?? 100,
    })
    .select()
    .single();
  if (error) {
    if ((error as { code?: string }).code === "23505") {
      throw new Error("Slug already in use. Pick a different one.");
    }
    throw error;
  }
  return mapForm(data);
};

export const updateForm = async (
  formId: string,
  patch: Partial<CreateFormInput & { status: LeadForm["status"] }>,
): Promise<LeadForm> => {
  if (patch.slug) validateSlug(patch.slug);
  if (patch.fields) validateFormFields(patch.fields);
  const update: Record<string, unknown> = {};
  if (patch.pipelineId) update.pipeline_id = patch.pipelineId;
  if (patch.slug) update.slug = patch.slug;
  if (patch.title) update.title = patch.title;
  if (patch.description !== undefined) update.description = patch.description;
  if (patch.fields) update.fields = patch.fields;
  if (patch.thankYouMessage !== undefined) update.thank_you_message = patch.thankYouMessage;
  if (patch.redirectUrl !== undefined) update.redirect_url = patch.redirectUrl;
  if (patch.turnstileEnabled !== undefined) update.turnstile_enabled = patch.turnstileEnabled;
  if (patch.rateLimitPerMinute !== undefined) update.rate_limit_per_minute = patch.rateLimitPerMinute;
  if (patch.rateLimitPerHour !== undefined) update.rate_limit_per_hour = patch.rateLimitPerHour;
  if (patch.status) update.status = patch.status;

  const { data, error } = await supabase
    .from("lead_forms")
    .update(update)
    .eq("form_id", formId)
    .select()
    .single();
  if (error) throw error;
  return mapForm(data);
};

export const deleteForm = async (formId: string): Promise<void> => {
  const { error } = await supabase.from("lead_forms").delete().eq("form_id", formId);
  if (error) throw error;
};

export interface SubmissionSummary {
  submissionId: string;
  clientId: string | null;
  formSlug: string;
  formTitle: string;
  createdAt: Date;
  rejectedReason: string | null;
}

export const getRecentSubmissions = async (
  organizationId: string,
  formId?: string,
  limit = 20,
): Promise<SubmissionSummary[]> => {
  let q = supabase
    .from("form_submissions")
    .select("submission_id, client_id, form_slug, form_title, created_at, rejected_reason")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (formId) q = q.eq("form_id", formId);
  const { data, error } = await q;
  if (error) {
    logger.error("Failed to load submissions:", error);
    return [];
  }
  return (data || []).map((r) => ({
    submissionId: (r as Record<string, string>).submission_id,
    clientId: (r as Record<string, string>).client_id ?? null,
    formSlug: (r as Record<string, string>).form_slug,
    formTitle: (r as Record<string, string>).form_title,
    createdAt: new Date((r as Record<string, string>).created_at),
    rejectedReason: (r as Record<string, string>).rejected_reason ?? null,
  }));
};
