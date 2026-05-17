import { useEffect, useRef, useState } from "react";
import { useOrganization } from "@/context/OrganizationContext";
import { Recipe, kickAutomationWorker, listRecipes } from "@/services/supabase/automations";
import { supabase } from "@/services/supabase/config";
import { toast } from "sonner";

export const useAutomations = () => {
  const { organization, isOwner, isAdmin } = useOrganization();
  const orgId = organization?.organizationId ?? null;
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [loading, setLoading] = useState(true);

  // Keep the latest recipes in a ref so the realtime run-toast handler can read
  // the current list without making the setup effect depend on `recipes`.
  // Without this, `recipes` in the dep array + setRecipes inside the effect =
  // infinite re-subscribe loop (each fetch makes a new array reference, which
  // re-runs the effect, which fetches again).
  const recipesRef = useRef<Recipe[]>([]);
  useEffect(() => {
    recipesRef.current = recipes;
  }, [recipes]);

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

    const recipeChannel = supabase
      .channel(`automation-recipes-${orgId}-${Math.random().toString(36).slice(2, 9)}`)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "automation_recipes",
        filter: `organization_id=eq.${orgId}`,
      }, () => listRecipes(orgId).then(setRecipes))
      .subscribe();

    const runChannel = supabase
      .channel(`automation-runs-${orgId}-${Math.random().toString(36).slice(2, 9)}`)
      .on("postgres_changes", {
        event: "INSERT",
        schema: "public",
        table: "automation_runs",
        filter: `organization_id=eq.${orgId}`,
      }, (payload) => {
        const row = payload.new as { status: string; recipe_id: string };
        const recipe = recipesRef.current.find((r) => r.recipeId === row.recipe_id);
        const name = recipe?.name ?? "Automation";
        if (row.status === "success") toast.success(`${name} ran`);
        if (row.status === "failure") toast.error(`${name} failed`);
        if (row.status === "partial") toast.warning(`${name} ran with skipped actions`);
        // skipped suppressed — too chatty
      })
      .subscribe();

    return () => {
      cancelled = true;
      recipeChannel.unsubscribe();
      runChannel.unsubscribe();
    };
  }, [orgId]);

  useEffect(() => {
    if (!orgId) return;
    void kickAutomationWorker({ force: true });
    const id = window.setInterval(() => {
      void kickAutomationWorker();
    }, 30_000);
    return () => window.clearInterval(id);
  }, [orgId]);

  return { organizationId: orgId, recipes, loading, canManage: isOwner || isAdmin };
};
