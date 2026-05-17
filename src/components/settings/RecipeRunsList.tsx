import React, { useEffect, useState } from "react";
import { listRuns, RecipeRun } from "@/services/supabase/automations";
import { stopSequenceRun } from "@/services/supabase/sequences";
import { Loader2, CheckCircle2, XCircle, AlertTriangle, MinusCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

const STATUS_ICON: Record<RecipeRun["status"], React.FC<{ className?: string }>> = {
  success: CheckCircle2,
  failure: XCircle,
  partial: AlertTriangle,
  skipped: MinusCircle,
};

const STATUS_COLOR: Record<RecipeRun["status"], string> = {
  success: "text-emerald-600",
  failure: "text-destructive",
  partial: "text-amber-600",
  skipped: "text-muted-foreground",
};

interface Props { recipeId: string }

export const RecipeRunsList: React.FC<Props> = ({ recipeId }) => {
  const [runs, setRuns] = useState<RecipeRun[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    listRuns(recipeId, 50).then((rs) => {
      setRuns(rs);
      setLoading(false);
    });
  }, [recipeId]);

  if (loading) return (
    <p className="text-sm text-muted-foreground flex items-center gap-2">
      <Loader2 className="w-4 h-4 animate-spin" /> Loading runs…
    </p>
  );
  if (runs.length === 0) return <p className="text-sm text-muted-foreground">No runs yet.</p>;

  return (
    <div className="space-y-2">
      {runs.map((run) => {
        const Icon = STATUS_ICON[run.status];
        return (
          <div key={run.runId} className="border rounded-md p-2 text-xs space-y-1">
            <div className={`flex items-center gap-2 font-medium ${STATUS_COLOR[run.status]}`}>
              <Icon className="w-3.5 h-3.5" />
              <span className="capitalize">{run.status}</span>
              <span className="text-muted-foreground font-normal">
                · {run.startedAt.toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })}
                · {Math.max(0, run.finishedAt.getTime() - run.startedAt.getTime())}ms
              </span>
            </div>
            {run.actionResults.length > 0 && (
              <ul className="pl-5 list-none space-y-0.5">
                {run.actionResults.map((a, i) => (
                  <li key={i} className={STATUS_COLOR[a.status as RecipeRun["status"]]}>
                    {a.status === "success" ? "✓" : a.status === "failure" ? "✗" : "·"} {a.type}
                    {a.message && <span className="text-muted-foreground"> — {a.message}</span>}
                  </li>
                ))}
              </ul>
            )}
            {run.hasPendingActions && (
              <Button
                variant="outline"
                size="sm"
                onClick={async () => {
                  try {
                    const n = await stopSequenceRun(run.runId);
                    toast.success(`Cancelled ${n} pending action(s)`);
                    listRuns(recipeId, 50).then(setRuns);
                  } catch (err) {
                    toast.error(err instanceof Error ? err.message : "Stop failed");
                  }
                }}
              >
                Stop sequence
              </Button>
            )}
          </div>
        );
      })}
      <Button variant="ghost" size="sm" onClick={() => listRuns(recipeId, 50).then(setRuns)}>
        Refresh
      </Button>
    </div>
  );
};
