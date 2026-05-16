// src/components/clients/ActivityTimeline.tsx
import React from "react";
import { StickyNote, GitBranch, CheckSquare, MailPlus, Loader2 } from "lucide-react";
import { ActivityEvent } from "@/services/supabase/activityFeed";
import { useActivity, UseActivityParams } from "@/hooks/useActivity";
import { Button } from "@/components/ui/button";

const ICON: Record<ActivityEvent["eventType"], React.FC<{ className?: string }>> = {
  note: StickyNote,
  deal_stage: GitBranch,
  task: CheckSquare,
  form_submission: MailPlus,
};

const formatDateTime = (d: Date) =>
  d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

interface Props extends UseActivityParams {
  emptyHint?: string;
}

export const ActivityTimeline: React.FC<Props> = (props) => {
  const { events, loading, hasMore, loadMore } = useActivity(props);

  if (loading && !events.length) {
    return (
      <p className="text-sm text-muted-foreground flex items-center gap-2">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading activity…
      </p>
    );
  }
  if (!events.length) {
    return (
      <p className="text-sm text-muted-foreground">
        {props.emptyHint ?? "No activity yet."}
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {events.map((e, i) => {
        const Icon = ICON[e.eventType] ?? StickyNote;
        return (
          <div key={i} className="flex gap-3">
            <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center shrink-0">
              <Icon className="w-3.5 h-3.5 text-muted-foreground" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm">{e.title}</p>
              <p className="text-xs text-muted-foreground">
                {e.actorName ? `${e.actorName} · ` : ""}
                {formatDateTime(e.occurredAt)}
                {e.subtype ? ` · ${e.subtype}` : ""}
              </p>
              {e.body && (
                <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{e.body}</p>
              )}
            </div>
          </div>
        );
      })}
      {hasMore && (
        <Button variant="outline" size="sm" onClick={loadMore}>
          Load more
        </Button>
      )}
    </div>
  );
};
