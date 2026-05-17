import { useEffect, useState } from "react";
import { useOrganization } from "@/context/OrganizationContext";
import { Recipe } from "@/services/supabase/automations";
import { useAutomations } from "@/hooks/useAutomations";
import { SequenceCounts, getSequenceCounts } from "@/services/supabase/sequences";
import { supabase } from "@/services/supabase/config";

export interface Sequence {
  recipe: Recipe;
  counts: SequenceCounts;
}

const isSequence = (r: Recipe): boolean =>
  r.actions.some((a) => a.type === "send_email") &&
  r.actions.some((a) => a.type === "wait");

export const useSequences = () => {
  const { organization, isOwner, isAdmin } = useOrganization();
  const orgId = organization?.organizationId ?? null;
  const { recipes, loading: recipesLoading } = useAutomations();
  const [sequences, setSequences] = useState<Sequence[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    if (!orgId) {
      setSequences([]);
      setLoading(false);
      return;
    }
    const matching = recipes.filter(isSequence);
    const withCounts = await Promise.all(
      matching.map(async (recipe) => ({
        recipe,
        counts: await getSequenceCounts(orgId, recipe.recipeId),
      })),
    );
    setSequences(withCounts);
    setLoading(false);
  };

  useEffect(() => {
    if (recipesLoading) return;
    refresh();
    if (!orgId) return;
    const channel = supabase
      .channel(`sequences-${orgId}-${Math.random().toString(36).slice(2, 9)}`)
      .on("postgres_changes", {
        event: "*", schema: "public", table: "pending_actions",
        filter: `organization_id=eq.${orgId}`,
      }, () => refresh())
      .on("postgres_changes", {
        event: "*", schema: "public", table: "sequence_replies",
        filter: `organization_id=eq.${orgId}`,
      }, () => refresh())
      .subscribe();
    return () => { channel.unsubscribe(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, recipes, recipesLoading]);

  return { organizationId: orgId, sequences, loading, canManage: isOwner || isAdmin };
};
