import React, { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Bot, Loader2, PlayCircle } from "lucide-react";
import { useAgentSuggestions } from "@/hooks/useAgentSuggestions";
import { AgentSuggestion, decideSuggestion, runAgentNow } from "@/services/supabase/agentSuggestions";
import { SuggestionCard } from "./SuggestionCard";
import { EditDraftModal } from "./EditDraftModal";
import { RejectModal } from "./RejectModal";
import { toast } from "sonner";

type Filter = "all" | "intake" | "re_engagement" | "no_enrichment";

export const AgentQueueTab: React.FC = () => {
  const { organizationId, pending, loading, refresh } = useAgentSuggestions();
  const [filter, setFilter] = useState<Filter>("all");
  const [editing, setEditing] = useState<AgentSuggestion | null>(null);
  const [rejecting, setRejecting] = useState<AgentSuggestion | null>(null);
  const [running, setRunning] = useState(false);

  const filtered = pending.filter((s) => {
    if (filter === "intake") return s.triggerType === "intake";
    if (filter === "re_engagement") return s.triggerType === "re_engagement";
    if (filter === "no_enrichment") return !s.enrichment;
    return true;
  });

  const send = async (
    s: AgentSuggestion,
    payload?: { subject: string; bodyText: string; bodyHtml: string },
  ) => {
    try {
      await decideSuggestion({
        suggestionId: s.suggestionId,
        action: "send",
        draftOverride: payload
          ? { subject: payload.subject, bodyText: payload.bodyText, bodyHtml: payload.bodyHtml }
          : undefined,
      });
      toast.success("Sent");
      setEditing(null);
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Send failed");
    }
  };

  const snooze = async (s: AgentSuggestion, days: number) => {
    try {
      await decideSuggestion({ suggestionId: s.suggestionId, action: "snooze", snoozeDays: days });
      toast.success(`Snoozed ${days}d`);
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Snooze failed");
    }
  };

  const reject = async (s: AgentSuggestion, reasons: string[], note: string) => {
    try {
      await decideSuggestion({
        suggestionId: s.suggestionId,
        action: "reject",
        rejectReasons: reasons,
        rejectNote: note || undefined,
      });
      toast.success("Rejected");
      setRejecting(null);
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Reject failed");
    }
  };

  const runNow = async () => {
    if (!organizationId) return;
    setRunning(true);
    try {
      const checked = await runAgentNow(organizationId);
      toast.success(`AI agent checked ${checked} recent client${checked === 1 ? "" : "s"}`);
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Agent run failed");
    } finally {
      setRunning(false);
    }
  };

  if (loading) return (
    <p className="text-sm text-muted-foreground flex items-center gap-2">
      <Loader2 className="w-4 h-4 animate-spin" /> Loading queue…
    </p>
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 text-xs">
        {(["all", "intake", "re_engagement", "no_enrichment"] as const).map((f) => (
          <button
            key={f}
            className={`px-2 py-1 rounded border ${
              filter === f ? "bg-foreground text-background" : "bg-background"
            }`}
            onClick={() => setFilter(f)}
          >
            {f.replace("_", " ")}
          </button>
        ))}
        <Button size="sm" variant="outline" onClick={runNow} disabled={running || !organizationId}>
          {running ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <PlayCircle className="w-3 h-3 mr-1" />}
          Run agent now
        </Button>
      </div>

      {filtered.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground flex flex-col items-center gap-2">
            <Bot className="w-6 h-6 text-indigo-500" />
            No suggestions right now. Click <strong>Run agent now</strong> to scan recent clients and stuck deals.
          </CardContent>
        </Card>
      ) : (
        filtered.map((s) => (
          <SuggestionCard
            key={s.suggestionId}
            suggestion={s}
            onSend={() => send(s)}
            onEdit={() => setEditing(s)}
            onReject={() => setRejecting(s)}
            onSnooze={(d) => snooze(s, d)}
          />
        ))
      )}

      {editing && (
        <EditDraftModal
          open
          initial={editing.draft}
          onCancel={() => setEditing(null)}
          onSend={(payload) => send(editing, payload)}
        />
      )}

      {rejecting && (
        <RejectModal
          open
          onCancel={() => setRejecting(null)}
          onReject={(reasons, note) => reject(rejecting, reasons, note)}
        />
      )}
    </div>
  );
};
