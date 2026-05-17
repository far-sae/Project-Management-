// src/hooks/useAiUsage.ts
import { useEffect, useState } from "react";
import { useOrganization } from "@/context/OrganizationContext";
import { AiBlockUsage, getUsage } from "@/services/supabase/aiBlocks";
import { supabase } from "@/services/supabase/config";

export const useAiUsage = () => {
  const { organization, isOwner, isAdmin } = useOrganization();
  const orgId = organization?.organizationId ?? null;
  const [usage, setUsage] = useState<AiBlockUsage | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!orgId) {
      setUsage(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    getUsage(orgId).then((u) => {
      if (cancelled) return;
      setUsage(u);
      setLoading(false);
    });
    const refreshUsage = () => {
      getUsage(orgId).then((u) => {
        if (!cancelled) setUsage(u);
      });
    };
    const channel = supabase
      .channel(`ai-usage-${orgId}-${Math.random().toString(36).slice(2, 9)}`)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "ai_block_runs",
        filter: `organization_id=eq.${orgId}`,
      }, refreshUsage)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "ai_block_usage_caps",
        filter: `organization_id=eq.${orgId}`,
      }, refreshUsage)
      .subscribe();
    const interval = window.setInterval(refreshUsage, 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      channel.unsubscribe();
    };
  }, [orgId]);

  return { organizationId: orgId, usage, loading, canManage: isOwner || isAdmin };
};
