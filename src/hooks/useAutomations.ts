import { useEffect, useState } from "react";
import { useOrganization } from "@/context/OrganizationContext";
import { Recipe, listRecipes } from "@/services/supabase/automations";
import { supabase } from "@/services/supabase/config";

export const useAutomations = () => {
  const { organization, isOwner, isAdmin } = useOrganization();
  const orgId = organization?.organizationId ?? null;
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!orgId) {
      setRecipes([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    listRecipes(orgId).then((next) => {
      if (cancelled) return;
      setRecipes(next);
      setLoading(false);
    });
    const channel = supabase
      .channel(`automation-recipes-${orgId}-${Math.random().toString(36).slice(2, 9)}`)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "automation_recipes",
        filter: `organization_id=eq.${orgId}`,
      }, () => listRecipes(orgId).then(setRecipes))
      .subscribe();
    return () => {
      cancelled = true;
      channel.unsubscribe();
    };
  }, [orgId]);

  return { organizationId: orgId, recipes, loading, canManage: isOwner || isAdmin };
};
