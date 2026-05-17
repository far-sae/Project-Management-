import React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";
import { useAgentSuggestions } from "@/hooks/useAgentSuggestions";

const STATUS_VARIANT: Record<string, "default" | "outline" | "destructive"> = {
  sent: "default",
  rejected: "outline",
  expired: "outline",
  failed: "destructive",
  cap_reached: "outline",
};

export const AgentActivityTab: React.FC = () => {
  const { activity, loading } = useAgentSuggestions();

  if (loading) return (
    <p className="text-sm text-muted-foreground flex items-center gap-2">
      <Loader2 className="w-4 h-4 animate-spin" /> Loading activity…
    </p>
  );
  if (activity.length === 0) return (
    <p className="text-sm text-muted-foreground">No activity in the last 7 days.</p>
  );

  return (
    <div className="space-y-2">
      {activity.map((s) => (
        <Card key={s.suggestionId}>
          <CardContent className="py-3 text-xs space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant={STATUS_VARIANT[s.status] ?? "outline"} className="capitalize">
                {s.status.replace("_", " ")}
              </Badge>
              <Badge variant="outline" className="capitalize">
                {s.triggerType.replace("_", " ")}
              </Badge>
              <span className="text-muted-foreground tabular-nums">
                {s.decidedAt?.toLocaleString() ?? s.createdAt.toLocaleString()}
              </span>
            </div>
            <p className="font-medium truncate">{s.draft.subject || "(no subject)"}</p>
            {s.rejectedReasons && s.rejectedReasons.length > 0 && (
              <p className="text-muted-foreground">
                Reasons: {s.rejectedReasons.join(", ")}
                {s.rejectedNote ? ` — ${s.rejectedNote}` : ""}
              </p>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
};
