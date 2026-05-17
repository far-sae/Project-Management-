// src/components/settings/AiUsageSettingsTab.tsx
import React, { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Loader2, Sparkles, CheckCircle2, XCircle, MinusCircle } from "lucide-react";
import { useAiUsage } from "@/hooks/useAiUsage";
import { AiBlockRun, listRuns, setUsageCap } from "@/services/supabase/aiBlocks";
import { toast } from "sonner";

const STATUS_ICON: Record<AiBlockRun["status"], React.FC<{ className?: string }>> = {
  success: CheckCircle2,
  failure: XCircle,
  skipped: MinusCircle,
};

const STATUS_COLOR: Record<AiBlockRun["status"], string> = {
  success: "text-emerald-600",
  failure: "text-destructive",
  skipped: "text-muted-foreground",
};

const formatUsd = (cents: number): string => `$${(cents / 100).toFixed(2)}`;

export const AiUsageSettingsTab: React.FC = () => {
  const { organizationId, usage, loading, canManage } = useAiUsage();
  const [runs, setRuns] = useState<AiBlockRun[]>([]);
  const [capDraft, setCapDraft] = useState<number>(0);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!organizationId) return;
    listRuns(organizationId, 50).then(setRuns);
  }, [organizationId]);

  useEffect(() => {
    if (usage) setCapDraft(usage.monthlyRunCap);
  }, [usage?.monthlyRunCap]);

  if (!canManage) {
    return <p className="text-sm text-muted-foreground">Only admins can view AI usage.</p>;
  }
  if (loading || !usage) {
    return (
      <p className="text-sm text-muted-foreground flex items-center gap-2">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading AI usage…
      </p>
    );
  }

  const pct = usage.monthlyRunCap > 0
    ? Math.min(100, Math.round((usage.currentMonthRuns / usage.monthlyRunCap) * 100))
    : 0;

  const avgCost = usage.currentMonthRuns > 0
    ? usage.currentMonthSpendCents / usage.currentMonthRuns
    : 0;

  // Reset date = first of next month.
  const next = new Date(usage.currentMonthStartedAt);
  next.setMonth(next.getMonth() + 1);

  const saveCap = async () => {
    if (!organizationId) return;
    setSaving(true);
    try {
      await setUsageCap(organizationId, capDraft);
      toast.success("Cap updated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Update failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid lg:grid-cols-2 gap-4">
      {/* Left — This month */}
      <Card>
        <CardContent className="pt-4 space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-amber-500" />
            This month
          </h2>
          <div>
            <div className="flex justify-between text-sm mb-1">
              <span>Runs used</span>
              <span className="font-mono">{usage.currentMonthRuns} / {usage.monthlyRunCap}</span>
            </div>
            <Progress value={pct} className="h-2" />
            <p className="text-xs text-muted-foreground mt-1">{pct}%</p>
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-xs uppercase text-muted-foreground">Spend</p>
              <p className="font-mono text-lg">{formatUsd(usage.currentMonthSpendCents)}</p>
            </div>
            <div>
              <p className="text-xs uppercase text-muted-foreground">Avg / run</p>
              <p className="font-mono text-lg">{formatUsd(avgCost)}</p>
            </div>
          </div>
          <div className="border-t pt-3 space-y-2">
            <Label>Monthly cap</Label>
            <div className="flex gap-2">
              <Input
                type="number"
                value={capDraft}
                onChange={(e) => setCapDraft(Number(e.target.value))}
                min={0}
                max={1000000}
              />
              <Button onClick={saveCap} disabled={saving}>
                {saving ? "Saving…" : "Update"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Resets on {next.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}
            </p>
          </div>
          {usage.currentMonthRuns >= usage.monthlyRunCap && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
              AI quota for this month exhausted. Recipes using AI actions will
              skip those steps until reset or until you raise the cap above.
            </div>
          )}
        </CardContent>
      </Card>

      {/* Right — Recent runs */}
      <Card>
        <CardContent className="pt-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-3">
            Recent runs
          </h2>
          {runs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No AI runs yet.</p>
          ) : (
            <div className="space-y-1 max-h-[26rem] overflow-y-auto pr-1">
              {runs.map((run) => {
                const Icon = STATUS_ICON[run.status];
                return (
                  <div key={run.runId} className="flex items-center gap-2 text-xs py-1 border-b border-border/40">
                    <span className="text-muted-foreground tabular-nums w-[5.5rem] shrink-0">
                      {run.createdAt.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                    </span>
                    <Badge variant="outline" className="text-[10px] shrink-0">
                      {run.actionType.replace("ai_", "")}
                    </Badge>
                    <Icon className={`w-3.5 h-3.5 shrink-0 ${STATUS_COLOR[run.status]}`} />
                    <span className="flex-1 min-w-0 truncate text-muted-foreground">
                      {run.errorMessage ?? `${run.inputTokens ?? 0}→${run.outputTokens ?? 0} tok`}
                    </span>
                    <span className="font-mono tabular-nums text-muted-foreground shrink-0">
                      {run.costUsdCents != null ? formatUsd(run.costUsdCents) : "—"}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
