import React, { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, MailPlus, PlayCircle } from "lucide-react";
import { useSequences } from "@/hooks/useSequences";
import { kickAutomationWorker, summarizeRecipe } from "@/services/supabase/automations";
import { listSequenceReplies, SequenceReply } from "@/services/supabase/sequences";

export const SequencesSettingsTab: React.FC = () => {
  const { organizationId, sequences, loading, canManage } = useSequences();
  const [replies, setReplies] = useState<SequenceReply[]>([]);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    if (!organizationId) return;
    listSequenceReplies(organizationId, undefined, 50).then(setReplies);
  }, [organizationId, sequences]);

  if (!canManage) {
    return <p className="text-sm text-muted-foreground">Only admins can view sequences.</p>;
  }
  if (loading) {
    return (
      <p className="text-sm text-muted-foreground flex items-center gap-2">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading sequences…
      </p>
    );
  }

  const runPending = async () => {
    setRunning(true);
    try {
      await kickAutomationWorker({ force: true });
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="grid lg:grid-cols-3 gap-4">
      <div className="lg:col-span-2 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-2">
            <MailPlus className="w-4 h-4 text-indigo-500" />
            Sequences ({sequences.length})
          </h2>
          <Button size="sm" variant="outline" onClick={runPending} disabled={running || !organizationId}>
            {running ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <PlayCircle className="w-3 h-3 mr-1" />}
            Run sequence steps
          </Button>
        </div>
        {sequences.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              No sequences yet. A recipe with at least one <code>send_email</code> AND one <code>wait</code> action shows up here.
            </CardContent>
          </Card>
        ) : (
          sequences.map(({ recipe, counts }) => (
            <Card key={recipe.recipeId}>
              <CardContent className="py-4 space-y-2">
                <div className="flex justify-between items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate flex items-center gap-2">
                      {recipe.enabled
                        ? <span className="w-2 h-2 rounded-full bg-emerald-500" />
                        : <span className="w-2 h-2 rounded-full bg-muted" />}
                      {recipe.name}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">{summarizeRecipe(recipe)}</p>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div>
                    <p className="text-muted-foreground">Active enrollments</p>
                    <p className="font-mono text-base">{counts.activeEnrollments}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Replies (30d)</p>
                    <p className="font-mono text-base">{counts.repliesLast30d}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Stopped (30d)</p>
                    <p className="font-mono text-base">
                      {counts.stoppedByStage + counts.stoppedByAdmin + counts.stoppedByReply}
                    </p>
                  </div>
                </div>
                {(counts.stoppedByStage + counts.stoppedByAdmin + counts.stoppedByReply) > 0 && (
                  <div className="flex gap-2 text-[10px] text-muted-foreground">
                    {counts.stoppedByStage > 0 && <Badge variant="outline">stage: {counts.stoppedByStage}</Badge>}
                    {counts.stoppedByAdmin > 0 && <Badge variant="outline">admin: {counts.stoppedByAdmin}</Badge>}
                    {counts.stoppedByReply > 0 && <Badge variant="outline">reply: {counts.stoppedByReply}</Badge>}
                  </div>
                )}
              </CardContent>
            </Card>
          ))
        )}
      </div>

      <div className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Recent replies
        </h2>
        {replies.length === 0 ? (
          <p className="text-sm text-muted-foreground">No replies yet.</p>
        ) : (
          <div className="space-y-2 max-h-[36rem] overflow-y-auto pr-1">
            {replies.map((r) => (
              <div key={r.id} className="border rounded-md p-2 text-xs space-y-1">
                <p className="font-medium truncate">{r.fromAddress}</p>
                <p className="text-muted-foreground truncate">{r.subject ?? "(no subject)"}</p>
                <p className="text-muted-foreground line-clamp-2">{r.bodyPreview ?? ""}</p>
                <p className="text-[10px] text-muted-foreground tabular-nums">
                  {r.receivedAt.toLocaleString()}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
