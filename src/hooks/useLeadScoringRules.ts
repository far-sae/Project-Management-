// src/hooks/useLeadScoringRules.ts
import { useEffect, useState } from "react";
import { useOrganization } from "@/context/OrganizationContext";
import { LeadScoringRule, Thresholds, getRules, getThresholds } from "@/services/supabase/leadScoring";
import { supabase } from "@/services/supabase/config";

export const useLeadScoringRules = () => {
  const { organization, isOwner, isAdmin } = useOrganization();
  const orgId = organization?.organizationId ?? null;
  const [rules, setRules] = useState<LeadScoringRule[]>([]);
  const [thresholds, setThresholds] = useState<Thresholds>({ hot: 70, warm: 40 });

  useEffect(() => {
    if (!orgId) return;
    let cancelled = false;
    Promise.all([getRules(orgId), getThresholds(orgId)]).then(([r, t]) => {
      if (cancelled) return;
      setRules(r);
      setThresholds(t);
    });
    const channel = supabase
      .channel(`scoring-${orgId}`)
      .on("postgres_changes", {
        event: "*", schema: "public", table: "lead_scoring_rules",
        filter: `organization_id=eq.${orgId}`,
      }, () => getRules(orgId).then(setRules))
      .on("postgres_changes", {
        event: "*", schema: "public", table: "lead_scoring_thresholds",
        filter: `organization_id=eq.${orgId}`,
      }, () => getThresholds(orgId).then(setThresholds))
      .subscribe();
    return () => {
      cancelled = true;
      channel.unsubscribe();
    };
  }, [orgId]);

  return { organizationId: orgId, rules, thresholds, canManage: isOwner || isAdmin };
};
