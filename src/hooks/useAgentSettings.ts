import { useEffect, useState } from "react";
import { useOrganization } from "@/context/OrganizationContext";
import { supabase } from "@/services/supabase/config";

export interface AgentSettings {
  enabled: boolean;
  apolloDailyCap: number;
  draftDailyCap: number;
}

const DEFAULTS: AgentSettings = {
  enabled: false,
  apolloDailyCap: 20,
  draftDailyCap: 50,
};

export const useAgentSettings = () => {
  const { organization, isOwner, isAdmin } = useOrganization();
  const orgId = organization?.organizationId ?? null;
  const [settings, setSettings] = useState<AgentSettings>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!orgId) { setLoading(false); return; }
      const { data } = await supabase.from("organizations")
        .select("ai_agent_enabled, ai_agent_apollo_daily_cap, ai_agent_draft_daily_cap")
        .eq("organization_id", orgId).maybeSingle();
      if (cancelled) return;
      if (data) {
        setSettings({
          enabled: !!data.ai_agent_enabled,
          apolloDailyCap: Number(data.ai_agent_apollo_daily_cap ?? 20),
          draftDailyCap: Number(data.ai_agent_draft_daily_cap ?? 50),
        });
      }
      setLoading(false);
    };
    load();
    return () => { cancelled = true; };
  }, [orgId]);

  const save = async (patch: Partial<AgentSettings>) => {
    if (!orgId) return;
    setSaving(true);
    try {
      const next = { ...settings, ...patch };
      const { error } = await supabase.from("organizations").update({
        ai_agent_enabled: next.enabled,
        ai_agent_apollo_daily_cap: next.apolloDailyCap,
        ai_agent_draft_daily_cap: next.draftDailyCap,
      }).eq("organization_id", orgId);
      if (error) throw error;
      setSettings(next);
    } finally {
      setSaving(false);
    }
  };

  return {
    organizationId: orgId,
    settings, loading, saving, save,
    canManage: isOwner || isAdmin,
  };
};
