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
  const m = matches[0];
  return (
    <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
      <div className="flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 text-destructive mt-0.5" />
        <div className="flex-1">
          <p>
            <strong>{m.name}</strong> already exists{" "}
            {m.matchedOn === "email" && m.email ? `with email ${m.email}` : "with the same company name"}.
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Choose what to do with this match, like a Salesforce duplicate review.
          </p>
          <div className="flex flex-wrap gap-2 mt-2">
            <Button size="sm" variant="outline" onClick={() => onOpenExisting(m.clientId)}>
              <ExternalLink className="w-3 h-3 mr-1" /> View existing
            </Button>
            {onUpdateExisting && (
              <Button size="sm" variant="outline" onClick={() => onUpdateExisting(m.clientId)}>
                Update existing
              </Button>
            )}
            <Button size="sm" variant="destructive" onClick={onOverride}>
              {overrideActive ? "Create anyway enabled" : "Create anyway"}
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
