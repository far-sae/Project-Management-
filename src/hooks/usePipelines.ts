import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { useOrganization } from "@/context/OrganizationContext";
import {
  Pipeline,
  PipelineStage,
  getPipelineStages,
  subscribePipelines,
} from "@/services/supabase/pipelines";

export const usePipelines = () => {
  const { user } = useAuth();
  const { organization, isOwner, isAdmin } = useOrganization();
  const orgId =
    organization?.organizationId ?? user?.organizationId ?? null;

  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!orgId) {
      setPipelines([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    return subscribePipelines(orgId, (next) => {
      setPipelines(next);
      setLoading(false);
    });
  }, [orgId]);

  const defaultPipeline = useMemo(
    () => pipelines.find((p) => p.isDefault) ?? pipelines[0] ?? null,
    [pipelines],
  );

  const [stagesByPipeline, setStagesByPipeline] = useState<
    Record<string, PipelineStage[]>
  >({});

  useEffect(() => {
    let cancelled = false;
    Promise.all(
      pipelines.map(async (p) => [p.pipelineId, await getPipelineStages(p.pipelineId)] as const),
    ).then((pairs) => {
      if (cancelled) return;
      const next: Record<string, PipelineStage[]> = {};
      for (const [id, stages] of pairs) next[id] = stages;
      setStagesByPipeline(next);
    });
    return () => {
      cancelled = true;
    };
  }, [pipelines]);

  return {
    organizationId: orgId,
    pipelines,
    defaultPipeline,
    stagesByPipeline,
    loading,
    canManage: isOwner || isAdmin,
  };
};
