import React, { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Plus, Trash2, Zap, AlertCircle } from "lucide-react";
import { useAutomations } from "@/hooks/useAutomations";
import { Recipe, deleteRecipe, setRecipeEnabled, summarizeRecipe } from "@/services/supabase/automations";
import { RecipeBuilder } from "./RecipeBuilder";
import { RecipeRunsList } from "./RecipeRunsList";
import { toast } from "sonner";

export const AutomationsSettingsTab: React.FC = () => {
  const { organizationId, recipes, loading, canManage } = useAutomations();
  const [editing, setEditing] = useState<Recipe | "new" | null>(null);
  const [selectedRecipeId, setSelectedRecipeId] = useState<string | null>(null);

  if (!canManage) {
    return <p className="text-sm text-muted-foreground">Only admins can manage automations.</p>;
  }
  if (!organizationId) return null;

  const toggle = async (recipe: Recipe, next: boolean) => {
    try {
      await setRecipeEnabled(recipe.recipeId, next);
      toast.success(next ? "Recipe enabled" : "Recipe disabled");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Toggle failed");
    }
  };

  const remove = async (recipe: Recipe) => {
    if (!confirm(`Delete "${recipe.name}"?`)) return;
    try {
      await deleteRecipe(recipe.recipeId);
      toast.success("Recipe deleted");
      if (selectedRecipeId === recipe.recipeId) setSelectedRecipeId(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    }
  };

  return (
    <div className="grid lg:grid-cols-3 gap-4">
      <div className="lg:col-span-2 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Zap className="w-5 h-5 text-amber-500" />
            Automations
          </h2>
          <Button onClick={() => setEditing("new")}>
            <Plus className="w-4 h-4 mr-1" /> New automation
          </Button>
        </div>

        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : recipes.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              No automations yet. Click <strong>New automation</strong> to create one.
            </CardContent>
          </Card>
        ) : (
          recipes.map((r) => (
            <Card
              key={r.recipeId}
              className={selectedRecipeId === r.recipeId ? "ring-2 ring-primary/40" : ""}
            >
              <CardContent className="py-4 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 min-w-0">
                    <Switch checked={r.enabled} onCheckedChange={(v) => toggle(r, v)} />
                    <button
                      className="font-medium text-left truncate"
                      onClick={() => setSelectedRecipeId(r.recipeId)}
                    >
                      {r.name}
                    </button>
                    {r.failCount > 0 && (
                      <Badge variant="outline" className="text-destructive border-destructive/40">
                        <AlertCircle className="w-3 h-3 mr-1" /> {r.failCount} failed
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="sm" onClick={() => setEditing(r)}>Edit</Button>
                    <Button variant="ghost" size="icon" onClick={() => remove(r)}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">{summarizeRecipe(r as any)}</p>
                <p className="text-[11px] text-muted-foreground">
                  {r.runCount} runs · {r.lastRunAt ? `last ${r.lastRunAt.toLocaleString()}` : "never run"}
                </p>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Run history
        </h3>
        {selectedRecipeId ? (
          <RecipeRunsList recipeId={selectedRecipeId} />
        ) : (
          <p className="text-xs text-muted-foreground">Select a recipe to view its run history.</p>
        )}
      </div>

      {editing && (
        <RecipeBuilder
          organizationId={organizationId}
          recipe={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
};
