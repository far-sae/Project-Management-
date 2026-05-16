// src/hooks/useLeadForms.ts
import { useEffect, useState } from "react";
import { useOrganization } from "@/context/OrganizationContext";
import { LeadForm, getOrganizationForms } from "@/services/supabase/leadForms";
import { supabase } from "@/services/supabase/config";

export const useLeadForms = () => {
  const { organization, isOwner, isAdmin } = useOrganization();
  const orgId = organization?.organizationId ?? null;
  const [forms, setForms] = useState<LeadForm[]>([]);

  useEffect(() => {
    if (!orgId) return;
    let cancelled = false;
    getOrganizationForms(orgId).then((next) => { if (!cancelled) setForms(next); });
    const channel = supabase.channel(`forms-${orgId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "lead_forms",
        filter: `organization_id=eq.${orgId}` }, () => getOrganizationForms(orgId).then(setForms))
      .subscribe();
    return () => { cancelled = true; channel.unsubscribe(); };
  }, [orgId]);

  return { organizationId: orgId, forms, canManage: isOwner || isAdmin };
};
