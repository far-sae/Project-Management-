import { supabase } from "./config";
import { logger } from "@/lib/logger";

export type RequiredFieldKey =
  | "value"
  | "expected_close_date"
  | "description"
  | "primary_contact";

export interface Pipeline {
  pipelineId: string;
  organizationId: string;
  name: string;
  description: string | null;
  isDefault: boolean;
  position: number;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PipelineStage {
  stageId: string;
  pipelineId: string;
  organizationId: string;
  key: string;
  label: string;
  color: string;
  position: number;
  defaultProbability: number;
  isWon: boolean;
  isLost: boolean;
  requiredFields: RequiredFieldKey[];
  createdAt: Date;
}

export const mapPipelineRow = (r: Record<string, unknown>): Pipeline => ({
  pipelineId: r.pipeline_id as string,
  organizationId: r.organization_id as string,
  name: r.name as string,
  description: (r.description as string) ?? null,
  isDefault: Boolean(r.is_default),
  position: Number(r.position ?? 0),
  createdBy: (r.created_by as string) ?? null,
  createdAt: new Date(r.created_at as string),
  updatedAt: new Date(r.updated_at as string),
});

export const mapStageRow = (r: Record<string, unknown>): PipelineStage => ({
  stageId: r.stage_id as string,
  pipelineId: r.pipeline_id as string,
  organizationId: r.organization_id as string,
  key: r.key as string,
  label: r.label as string,
  color: (r.color as string) ?? "#94A3B8",
  position: Number(r.position ?? 0),
  defaultProbability: Number(r.default_probability ?? 10),
  isWon: Boolean(r.is_won),
  isLost: Boolean(r.is_lost),
  requiredFields: Array.isArray(r.required_fields)
    ? (r.required_fields as RequiredFieldKey[])
    : [],
  createdAt: new Date(r.created_at as string),
});

export const getOrganizationPipelines = async (
  organizationId: string,
): Promise<Pipeline[]> => {
  const { data, error } = await supabase
    .from("pipelines")
    .select("*")
    .eq("organization_id", organizationId)
    .order("position", { ascending: true });
  if (error) {
    logger.error("Failed to load pipelines:", error);
    return [];
  }
  return (data || []).map(mapPipelineRow);
};

export const getPipelineStages = async (
  pipelineId: string,
): Promise<PipelineStage[]> => {
  const { data, error } = await supabase
    .from("pipeline_stages")
    .select("*")
    .eq("pipeline_id", pipelineId)
    .order("position", { ascending: true });
  if (error) {
    logger.error("Failed to load stages:", error);
    return [];
  }
  return (data || []).map(mapStageRow);
};

export interface CreatePipelineInput {
  name: string;
  description?: string | null;
  isDefault?: boolean;
}

export const createPipeline = async (
  organizationId: string,
  input: CreatePipelineInput,
): Promise<Pipeline> => {
  if (!input.name?.trim()) throw new Error("Pipeline name is required");
  const { data, error } = await supabase
    .from("pipelines")
    .insert({
      organization_id: organizationId,
      name: input.name.trim(),
      description: input.description ?? null,
      is_default: Boolean(input.isDefault),
    })
    .select()
    .single();
  if (error) throw error;
  return mapPipelineRow(data);
};

export interface UpdatePipelineInput {
  name?: string;
  description?: string | null;
  isDefault?: boolean;
  position?: number;
}

export const updatePipeline = async (
  pipelineId: string,
  input: UpdatePipelineInput,
): Promise<Pipeline> => {
  const update: Record<string, unknown> = {};
  if (input.name !== undefined) update.name = input.name.trim();
  if (input.description !== undefined) update.description = input.description;
  if (input.isDefault !== undefined) update.is_default = input.isDefault;
  if (input.position !== undefined) update.position = input.position;
  const { data, error } = await supabase
    .from("pipelines")
    .update(update)
    .eq("pipeline_id", pipelineId)
    .select()
    .single();
  if (error) throw error;
  return mapPipelineRow(data);
};

export const deletePipeline = async (pipelineId: string): Promise<void> => {
  const { error } = await supabase
    .from("pipelines")
    .delete()
    .eq("pipeline_id", pipelineId);
  if (error) throw error;
};

export interface UpsertStageInput {
  stageId?: string;
  key: string;
  label: string;
  color?: string;
  position: number;
  defaultProbability?: number;
  isWon?: boolean;
  isLost?: boolean;
  requiredFields?: RequiredFieldKey[];
}

export const upsertStages = async (
  pipelineId: string,
  organizationId: string,
  stages: UpsertStageInput[],
): Promise<PipelineStage[]> => {
  // Server-side: replace the stage set atomically. Stages with stageId update;
  // stages without it insert; existing stages not in the list are deleted.
  const { data, error } = await supabase.rpc("crm_replace_pipeline_stages", {
    p_pipeline_id: pipelineId,
    p_organization_id: organizationId,
    p_stages: stages.map((s) => ({
      stage_id: s.stageId ?? null,
      key: s.key,
      label: s.label,
      color: s.color ?? "#94A3B8",
      position: s.position,
      default_probability: s.defaultProbability ?? 10,
      is_won: Boolean(s.isWon),
      is_lost: Boolean(s.isLost),
      required_fields: s.requiredFields ?? [],
    })),
  });
  if (error) throw error;
  return (data as Record<string, unknown>[]).map(mapStageRow);
};

export const subscribePipelines = (
  organizationId: string,
  callback: (pipelines: Pipeline[]) => void,
): (() => void) => {
  getOrganizationPipelines(organizationId).then(callback);
  const channel = supabase
    .channel(`pipelines-${organizationId}-${Math.random().toString(36).slice(2, 9)}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "pipelines",
        filter: `organization_id=eq.${organizationId}`,
      },
      () => getOrganizationPipelines(organizationId).then(callback),
    )
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "pipeline_stages",
        filter: `organization_id=eq.${organizationId}`,
      },
      () => getOrganizationPipelines(organizationId).then(callback),
    )
    .subscribe();
  return () => {
    channel.unsubscribe();
  };
};
