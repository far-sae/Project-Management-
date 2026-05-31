import React, { useEffect, useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Zap, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useOrganization } from '@/context/OrganizationContext';
import {
  listRecipes, enrollInAutomation, type Recipe,
} from '@/services/supabase/automations';

interface EnrollAutomationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** What we're enrolling — controls which recipes are offered. */
  clientId?: string | null;
  dealId?: string | null;
  /** Optional display label so the title reads "Enrol Sam's Cafe…". */
  entityName?: string | null;
}

/**
 * Pick an enabled automation / sequence recipe and synthesise an
 * enrolment event for the supplied client/deal. The worker
 * (crm-run-automations edge function, pg_cron-driven) picks the
 * event up on its next tick and runs every action in the recipe —
 * including send_email + wait chains, which is how sequences work.
 *
 * Filters the recipe list to only those whose trigger can sensibly
 * fire for the supplied entity (client_created / client_tagged for
 * clients, deal_* for deals, "anything goes" triggers in both).
 */
export const EnrollAutomationDialog: React.FC<EnrollAutomationDialogProps> = ({
  open, onOpenChange, clientId, dealId, entityName,
}) => {
  const { organization } = useOrganization();
  const orgId = organization?.organizationId ?? null;

  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [recipeId, setRecipeId] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [enrolling, setEnrolling] = useState(false);

  useEffect(() => {
    if (!open || !orgId) return;
    setLoading(true);
    listRecipes(orgId)
      .then((rows) => {
        // Filter to recipes whose trigger can fire with the inputs we
        // have. clientId-only inputs can only enrol into client_*
        // triggers; dealId can fire deal_*. Generic ones (scheduled,
        // agent_intake) are always allowed.
        const trigger = (r: Recipe) => r.triggerType;
        const ok = rows.filter((r) => {
          if (!r.enabled) return false;
          const t = trigger(r);
          if (clientId && (t === 'client_created' || t === 'client_tagged')) return true;
          if (dealId && (t === 'deal_stage_entered' || t === 'deal_score_band_changed' || t === 'deal_field_changed')) return true;
          // Generic triggers we'll accept either way.
          if (t === 'scheduled' || t === 'agent_intake') return true;
          return false;
        });
        setRecipes(ok);
      })
      .finally(() => setLoading(false));
  }, [open, orgId, clientId, dealId]);

  useEffect(() => {
    if (!open) { setRecipeId(''); }
  }, [open]);

  const handleEnrol = async () => {
    if (!recipeId) { toast.error('Pick a sequence first'); return; }
    setEnrolling(true);
    try {
      await enrollInAutomation({ recipeId, clientId, dealId });
      const r = recipes.find((x) => x.recipeId === recipeId);
      toast.success(`Enrolled in "${r?.name ?? 'sequence'}" — first step fires on the next worker tick`);
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Enrolment failed');
    } finally {
      setEnrolling(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Zap className="w-5 h-5 text-amber-500" />
            Run automation{entityName ? ` on ${entityName}` : ''}
          </DialogTitle>
          <DialogDescription>
            Pick an enabled recipe from Settings → Automations / Sequences.
            We&apos;ll synthesise a trigger event so the recipe runs against this record
            on the worker&apos;s next tick (usually within a minute).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label>Recipe</Label>
          <Select value={recipeId} onValueChange={setRecipeId} disabled={loading || recipes.length === 0}>
            <SelectTrigger>
              <SelectValue placeholder={
                loading ? 'Loading…'
                : recipes.length === 0 ? 'No enabled recipes that fit this record'
                : 'Choose a recipe'
              } />
            </SelectTrigger>
            <SelectContent>
              {recipes.map((r) => (
                <SelectItem key={r.recipeId} value={r.recipeId}>
                  {r.name} <span className="text-muted-foreground text-xs">· {r.triggerType}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {recipes.length === 0 && !loading && (
            <p className="text-[11px] text-muted-foreground">
              Build a recipe in Settings → Automations or Sequences, then come back.
              Triggers that fit a {clientId ? 'contact / account' : 'deal'} are
              {' '}<code>client_created</code> / <code>client_tagged</code>
              {dealId ? <> / <code>deal_*</code></> : null}.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={enrolling}>
            Cancel
          </Button>
          <Button onClick={handleEnrol} disabled={enrolling || !recipeId}>
            {enrolling ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Zap className="w-4 h-4 mr-1.5" />}
            Enrol
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
