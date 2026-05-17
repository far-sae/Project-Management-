import React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AgentSuggestion } from "@/services/supabase/agentSuggestions";
import { Clock, Edit3, MailX, Send } from "lucide-react";

interface Props {
  suggestion: AgentSuggestion;
  onSend: () => void;
  onEdit: () => void;
  onReject: () => void;
  onSnooze: (days: number) => void;
}

export const SuggestionCard: React.FC<Props> = ({
  suggestion, onSend, onEdit, onReject, onSnooze,
}) => {
  const conf = suggestion.confidence ?? 0;
  const confBar = Math.max(0, Math.min(1, conf));
  const enrichment = suggestion.enrichment as {
    title?: string;
    organization?: { name?: string };
  } | null;
  const enrichmentLine = enrichment
    ? [enrichment.title, enrichment.organization?.name].filter(Boolean).join(" · ")
    : null;

  return (
    <Card>
      <CardContent className="py-4 space-y-2">
        <div className="flex items-center gap-2">
          <div className="w-12 h-1.5 bg-muted rounded overflow-hidden">
            <div
              className="h-full bg-emerald-500"
              style={{ width: `${confBar * 100}%` }}
            />
          </div>
          <span className="text-xs text-muted-foreground tabular-nums">{conf.toFixed(2)}</span>
          <Badge variant="outline" className="capitalize">
            {suggestion.triggerType.replace("_", " ")}
          </Badge>
          {!suggestion.enrichment && (
            <Badge variant="outline" className="text-amber-600">no enrichment</Badge>
          )}
        </div>

        {enrichmentLine && (
          <p className="text-xs text-muted-foreground">{enrichmentLine}</p>
        )}

        <div>
          <p className="font-medium text-sm">{suggestion.draft.subject || "(no subject)"}</p>
          <p className="text-xs text-muted-foreground line-clamp-3 mt-1 whitespace-pre-wrap">
            {suggestion.draft.bodyText}
          </p>
        </div>

        {suggestion.reasoning && (
          <p className="text-[11px] text-muted-foreground italic border-l-2 border-muted pl-2">
            {suggestion.reasoning}
          </p>
        )}

        <div className="flex flex-wrap gap-2 pt-1">
          <Button size="sm" onClick={onSend}>
            <Send className="w-3.5 h-3.5 mr-1" /> Approve &amp; send
          </Button>
          <Button size="sm" variant="outline" onClick={onEdit}>
            <Edit3 className="w-3.5 h-3.5 mr-1" /> Edit
          </Button>
          <Button size="sm" variant="outline" onClick={onReject}>
            <MailX className="w-3.5 h-3.5 mr-1" /> Reject
          </Button>
          <div className="flex items-center gap-1">
            <Clock className="w-3.5 h-3.5 text-muted-foreground" />
            <Button size="sm" variant="ghost" onClick={() => onSnooze(1)}>1d</Button>
            <Button size="sm" variant="ghost" onClick={() => onSnooze(3)}>3d</Button>
            <Button size="sm" variant="ghost" onClick={() => onSnooze(7)}>7d</Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
