import React, { useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { duplicateGroups } from '@/lib/crmDuplicates';
import { leadName } from '@/lib/crmFlow';
import { mergeContacts } from '@/services/supabase/crmHub/contacts';
import { syncLeadStepWithDeals } from '@/services/supabase/crmHub/deals';
import type { CrmContact } from '@/types/crmHub';

/**
 * Leads that share an email address, one group at a time. For each group you
 * choose the lead to keep; the others are merged into it: their deals,
 * follow-ups, notes, timeline and tags move over, and they are removed.
 */

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leads: CrmContact[];
  /** Company names by id, to tell two leads of one group apart. */
  companyNames: Map<string, string>;
  ownerNames: Map<string, string>;
  /** Called after each merge, so the list behind the window is fresh. */
  onMerged: () => void | Promise<void>;
}

const added = (date: Date) => date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

export const DuplicateLeadsDialog: React.FC<Props> = ({ open, onOpenChange, leads, companyNames, ownerNames, onMerged }) => {
  const groups = useMemo(() => duplicateGroups(leads), [leads]);
  /** The lead to keep in each group, by the group's email. The oldest unless changed. */
  const [keep, setKeep] = useState<Record<string, string>>({});
  const [busyGroup, setBusyGroup] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (open) { setKeep({}); setProblem(null); }
  }, [open]);

  const merge = async (groupKey: string, group: CrmContact[]) => {
    const keepId = keep[groupKey] ?? group[0].id;
    setBusyGroup(groupKey);
    setProblem(null);
    try {
      // One at a time: a merge either happens completely or not at all, and a later one must see the result of the earlier one.
      for (const lead of group) {
        if (lead.id !== keepId) await mergeContacts(keepId, lead.id);
      }
      // The lead now has the deals of the others, so its step follows them.
      await syncLeadStepWithDeals(keepId);
      toast.success(`Merged ${group.length} leads into one.`);
      await onMerged();
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'The leads could not be merged.');
      // Some of the group may already be merged.
      await onMerged();
    } finally {
      setBusyGroup(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!busyGroup) onOpenChange(next); }}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Duplicate leads</DialogTitle>
          <DialogDescription>
            Leads with the same email address. Choose the one to keep: the deals, follow-ups, notes, calls and history of the
            others move to it, and the others are removed. This cannot be undone.
          </DialogDescription>
        </DialogHeader>

        {problem && <p role="alert" className="text-sm text-destructive">{problem}</p>}

        {groups.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
            No two leads share an email address.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {groups.map((group) => {
              const key = (group[0].email ?? '').trim().toLowerCase();
              const keepId = keep[key] ?? group[0].id;
              const busy = busyGroup === key;
              return (
                <li key={key}>
                  <fieldset className="overflow-hidden rounded-lg border border-border" disabled={busyGroup !== null}>
                    <legend className="sr-only">Leads with the email {key}</legend>
                    <div className="flex items-center justify-between gap-3 border-b border-border bg-secondary/40 px-3 py-2">
                      <p className="min-w-0 truncate text-sm font-medium">{key}</p>
                      <Button size="sm" onClick={() => void merge(key, group)} disabled={busyGroup !== null}>
                        {busy && <Loader2 className="animate-spin" aria-hidden />}Merge {group.length} into one
                      </Button>
                    </div>
                    {group.map((lead, index) => (
                      <label key={lead.id} className="flex cursor-pointer items-start gap-3 border-b border-border/60 px-3 py-2.5 last:border-0">
                        <input
                          type="radio"
                          className="mt-1 size-4 accent-primary"
                          name={`keep-${key}`}
                          checked={keepId === lead.id}
                          onChange={() => setKeep((k) => ({ ...k, [key]: lead.id }))}
                          aria-label={`Keep ${leadName(lead)}, added ${added(lead.createdAt)}`}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-foreground">
                            {leadName(lead)}
                            {keepId === lead.id && <span className="ml-2 text-xs font-normal text-muted-foreground">kept</span>}
                          </span>
                          <span className="block text-xs text-muted-foreground">
                            {[
                              lead.companyId ? companyNames.get(lead.companyId) : null,
                              lead.phone,
                              lead.ownerId ? ownerNames.get(lead.ownerId) : null,
                              `added ${added(lead.createdAt)}${index === 0 ? ' (oldest)' : ''}`,
                            ].filter(Boolean).join(' · ')}
                          </span>
                        </span>
                      </label>
                    ))}
                  </fieldset>
                </li>
              );
            })}
          </ul>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busyGroup !== null}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
