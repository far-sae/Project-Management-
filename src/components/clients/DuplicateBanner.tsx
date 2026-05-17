// src/components/clients/DuplicateBanner.tsx
import React from "react";
import { AlertTriangle, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DuplicateMatch } from "@/services/supabase/dupDetection";

interface Props {
  matches: DuplicateMatch[];
  onOpenExisting: (clientId: string) => void;
  onUpdateExisting?: (clientId: string) => void;
  onOverride: () => void;
  onSkip?: () => void;
  overrideActive?: boolean;
}

export const DuplicateBanner: React.FC<Props> = ({
  matches,
  onOpenExisting,
  onUpdateExisting,
  onOverride,
  onSkip,
  overrideActive,
}) => {
  if (matches.length === 0) return null;
  const topMatches = matches.slice(0, 3);
  return (
    <div className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
      <div className="flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
        <div className="flex-1 space-y-3">
          <p className="font-medium">
            Possible duplicate client found
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Review the matching data before saving, like a Salesforce duplicate review.
          </p>

          <div className="space-y-2">
            {topMatches.map((m) => (
              <div
                key={m.clientId}
                className="rounded-md border bg-background/80 p-2"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-medium">{m.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {[m.email, m.website, m.phone, [m.city, m.state, m.country].filter(Boolean).join(", ")]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                  <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-300">
                    {m.score}% match
                  </span>
                </div>

                <div className="mt-2 flex flex-wrap gap-1.5">
                  {(m.reasons ?? [m.matchedOn]).map((reason) => (
                    <span
                      key={reason}
                      className="rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground"
                    >
                      {reason}
                    </span>
                  ))}
                </div>

                <div className="flex flex-wrap gap-2 mt-2">
                  <Button size="sm" variant="outline" onClick={() => onOpenExisting(m.clientId)}>
                    <ExternalLink className="w-3 h-3 mr-1" /> View existing
                  </Button>
                  {onUpdateExisting && (
                    <Button size="sm" variant="outline" onClick={() => onUpdateExisting(m.clientId)}>
                      Add data to existing
                    </Button>
                  )}
                </div>
              </div>
            ))}
            {matches.length > topMatches.length && (
              <p className="text-xs text-muted-foreground">
                And {matches.length - topMatches.length} more possible match
                {matches.length - topMatches.length === 1 ? "" : "es"}.
              </p>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="destructive" onClick={onOverride}>
              {overrideActive ? "Add as new enabled" : "Add as new anyway"}
            </Button>
            {onSkip && (
              <Button size="sm" variant="ghost" onClick={onSkip}>
                Skip
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
