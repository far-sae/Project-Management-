// Rename or delete a lead category after it was made. Both act on every lead
// that carries the category; no lead is ever deleted here.
import React, { useEffect, useState } from 'react';
import { Loader2, Pencil, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { categoryProblem, CATEGORY_MAX } from '@/lib/crmCategories';
import { publicMessage } from '@/lib/publicError';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categories: Array<{ name: string; count: number }>;
  /** Change the category on every lead that has it. Throws when it could not be done. */
  onRename: (from: string, to: string) => Promise<void>;
  /** Take the category off every lead that has it. Throws when it could not be done. */
  onDelete: (name: string) => Promise<void>;
}

const leadsWord = (count: number): string => `${count.toLocaleString('en-GB')} ${count === 1 ? 'lead' : 'leads'}`;

export const LeadCategoriesDialog: React.FC<Props> = ({ open, onOpenChange, categories, onRename, onDelete }) => {
  /** The category being renamed, and what is typed for it. */
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  /** The category whose delete is waiting to be confirmed. */
  const [deleting, setDeleting] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Each time it opens, nothing is half-done.
  useEffect(() => {
    if (open) { setRenaming(null); setDeleting(null); setDraft(''); }
  }, [open]);

  const next = draft.trim();
  const problem = renaming ? categoryProblem(draft) : null;
  /** Another category with the name typed (whatever the capitals): the two would become one. */
  const joins = renaming ? categories.find((c) => c.name !== renaming && c.name.toLowerCase() === next.toLowerCase()) ?? null : null;
  const canSave = Boolean(renaming) && !problem && next !== renaming && !busy;

  const run = async (work: () => Promise<void>, failed: string) => {
    setBusy(true);
    try {
      await work();
      setRenaming(null);
      setDeleting(null);
    } catch (err) {
      toast.error(publicMessage(err, failed));
    } finally {
      setBusy(false);
    }
  };

  const save = () => {
    if (!renaming || !canSave) return;
    const from = renaming;
    // Joining an existing category keeps its spelling, so there is one category afterwards and not two.
    void run(() => onRename(from, joins ? joins.name : next), 'The category could not be renamed. Please try again.');
  };

  return (
    <Dialog open={open} onOpenChange={(value) => !busy && onOpenChange(value)}>
      <DialogContent
        className="sm:max-w-lg"
        // Escape while a name is being typed gives up that rename, not the whole window.
        onEscapeKeyDown={(event) => { if (renaming) event.preventDefault(); }}
      >
        <DialogHeader>
          <DialogTitle>Edit categories</DialogTitle>
          <DialogDescription>
            Rename a category or delete it. The change is made on every lead in that category. No lead is deleted.
          </DialogDescription>
        </DialogHeader>

        {categories.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No categories yet. Type one in the Category box when you add or edit a lead.
          </p>
        ) : (
          <ul className="max-h-[60vh] divide-y divide-border overflow-y-auto rounded-md border border-border">
            {categories.map((category) => {
              const isRenaming = renaming === category.name;
              const isDeleting = deleting === category.name;
              return (
                <li key={category.name} className="flex flex-col gap-2 px-3 py-2.5">
                  {isRenaming ? (
                    <>
                      <span className="sr-only">{category.name}</span>
                      <div className="flex flex-wrap items-center gap-2">
                        <Input
                          autoFocus
                          aria-label={`New name for ${category.name}`}
                          className="min-w-40 flex-1"
                          maxLength={CATEGORY_MAX + 20}
                          value={draft}
                          disabled={busy}
                          onChange={(e) => setDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') { e.preventDefault(); save(); }
                            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setRenaming(null); }
                          }}
                        />
                        <Button size="sm" disabled={!canSave} onClick={save}>
                          {busy && <Loader2 className="animate-spin" aria-hidden />}Save
                        </Button>
                        <Button size="sm" variant="outline" disabled={busy} onClick={() => setRenaming(null)}>Cancel</Button>
                      </div>
                      {problem && <p className="text-xs text-destructive">{problem}</p>}
                      {!problem && joins && (
                        <p className="text-xs text-muted-foreground">
                          “{joins.name}” exists already. The {leadsWord(category.count)} move into it.
                        </p>
                      )}
                    </>
                  ) : (
                    <div className="flex items-center gap-3">
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{category.name}</span>
                      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{leadsWord(category.count)}</span>
                      <Button
                        size="icon" variant="ghost" aria-label={`Rename ${category.name}`} title="Rename" disabled={busy}
                        onClick={() => { setDeleting(null); setRenaming(category.name); setDraft(category.name); }}
                      >
                        <Pencil />
                      </Button>
                      <Button
                        size="icon" variant="ghost" aria-label={`Delete ${category.name}`} title="Delete" disabled={busy}
                        onClick={() => { setRenaming(null); setDeleting(category.name); }}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  )}
                  {isDeleting && (
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted/50 px-3 py-2">
                      <p className="text-xs text-foreground">
                        Delete this category? The {leadsWord(category.count)} are kept, with no category.
                      </p>
                      <div className="flex items-center gap-2">
                        <Button size="sm" variant="outline" disabled={busy} onClick={() => setDeleting(null)}>Cancel</Button>
                        <Button
                          size="sm" variant="destructive" disabled={busy}
                          onClick={() => void run(() => onDelete(category.name), 'The category could not be deleted. Please try again.')}
                        >
                          {busy && <Loader2 className="animate-spin" aria-hidden />}Delete category
                        </Button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default LeadCategoriesDialog;
