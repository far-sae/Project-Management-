import { supabase } from "./config";
import { logger } from "@/lib/logger";

export interface TemplateTaskDef {
  title: string;
  offsetDays: number;
}

export interface ProjectTemplate {
  templateId: string;
  organizationId: string;
  name: string;
  description: string | null;
  taskDefinitions: TemplateTaskDef[];
  createdAt: Date;
}

export const mapTemplateRow = (r: Record<string, unknown>): ProjectTemplate => ({
  templateId: r.template_id as string,
  organizationId: r.organization_id as string,
  name: r.name as string,
  description: (r.description as string) ?? null,
  taskDefinitions: Array.isArray(r.task_definitions)
    ? (r.task_definitions as TemplateTaskDef[])
    : [],
  createdAt: new Date(r.created_at as string),
});

export const getOrganizationTemplates = async (
  organizationId: string,
): Promise<ProjectTemplate[]> => {
  const { data, error } = await supabase
    .from("crm_project_templates")
    .select("*")
    .eq("organization_id", organizationId)
    .order("name", { ascending: true });
  if (error) {
    logger.error("Failed to load project templates:", error);
    return [];
  }
  return (data || []).map(mapTemplateRow);
};
