import { useEffect, useRef, useState } from "react";
import { useOrganization } from "@/context/OrganizationContext";
import { supabase } from "@/services/supabase/config";
import {
  AgentSuggestion, listPendingSuggestions, listSuggestionActivity,
} from "@/services/supabase/agentSuggestions";

export const useAgentSuggestions = () => {
  const { organization, isOwner, isAdmin } = useOrganization();
  const orgId = organization?.organizationId ?? null;
  const [pending, setPending] = useState<AgentSuggestion[]>([]);
  const [activity, setActivity] = useState<AgentSuggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const orgIdRef = useRef(orgId);
  orgIdRef.current = orgId;

  const refresh = async () => {
    const id = orgIdRef.current;
    if (!id) { setPending([]); setActivity([]); setLoading(false); return; }
    const [p, a] = await Promise.all([
      listPendingSuggestions(id),
      listSuggestionActivity(id, 7),
    ]);
    setPending(p);
    setActivity(a);
    setLoading(false);
  };

  useEffect(() => {
    refresh();
    if (!orgId) return;
    const ch = supabase
      .channel(`agent-suggestions-${orgId}-${Math.random().toString(36).slice(2, 9)}`)
      .on("postgres_changes", {
        event: "*", schema: "public", table: "agent_suggestions",
        filter: `organization_id=eq.${orgId}`,
      }, () => refresh())
      .subscribe();
    return () => { ch.unsubscribe(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  return {
    organizationId: orgId,
    pending, activity, loading,
    canManage: isOwner || isAdmin,
    refresh,
  };
};
