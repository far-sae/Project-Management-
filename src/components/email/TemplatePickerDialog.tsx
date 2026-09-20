import React, { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { FileText, Loader2, Search } from 'lucide-react';
import { listTemplates } from '@/services/supabase/emailAudience';
import { loadFailureMessage } from '@/lib/email/schemaErrors';
import type { EmailTemplate } from '@/lib/email/types';
import { LoadFailure } from './LoadFailure';

interface TemplatePickerDialogProps {
  orgId: string;
  workspaceId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Called with the chosen template. The caller COPIES its wording — it never
   * stores a reference to it.
   *
   * That is the same rule campaigns follow and it is deliberate: a template
   * edited six weeks later must not silently rewrite a sequence step that
   * people are already receiving, or mail that is already in the queue. A
   * linked template would make editing one an act with consequences nobody
   * can see from the template screen.
   */
  onPick: (template: EmailTemplate) => void;
}

/**
 * Choose a saved template, from anywhere that writes a message.
 *
 * It exists because template reuse was wired to exactly one destination — the
 * campaign composer — while sequence steps, which are where follow-up wording
 * is most worth reusing, had their own editor and no way to reach a template
 * at all. The only route between them was copy and paste.
 */
export const TemplatePickerDialog: React.FC<TemplatePickerDialogProps> = ({
  orgId, workspaceId, open, onOpenChange, onPick,
}) => {
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    if (!orgId) { setTemplates([]); setLoading(false); return; }
    setLoading(true);
    setLoadError(null);
    try {
      setTemplates(await listTemplates(orgId, workspaceId));
    } catch (err) {
      // Named rather than swallowed: on a database that has not run migration
      // 162 this is the difference between "you have no templates" and "this
      // needs a migration", and they call for opposite actions.
      setLoadError(loadFailureMessage(err, 'Failed to load templates'));
    } finally {
      setLoading(false);
    }
  }, [orgId, workspaceId]);

  useEffect(() => { if (open) void load(); }, [open, load]);

  const term = search.trim().toLowerCase();
  const visible = term
    ? templates.filter(
        (t) => t.name.toLowerCase().includes(term) || t.subject.toLowerCase().includes(term),
      )
    : templates;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Use a template</DialogTitle>
          <DialogDescription>
            {/* Said here, once, so nobody has to wonder later what editing a
                template does to what they have already written. */}
            Its wording is copied in. Editing the template afterwards will not change
            what you write here.
          </DialogDescription>
        </DialogHeader>

        {templates.length > 3 && (
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              placeholder="Search templates"
              className="pl-8"
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        )}

        <div className="max-h-80 space-y-2 overflow-y-auto">
          {loading ? (
            <div className="py-10 text-center text-muted-foreground">
              <Loader2 className="mx-auto mb-3 h-8 w-8 animate-spin text-muted-foreground/60" />
              <p className="text-sm">Loading templates…</p>
            </div>
          ) : loadError ? (
            <LoadFailure message={loadError} onRetry={() => void load()} />
          ) : visible.length === 0 ? (
            <div className="py-10 text-center text-muted-foreground">
              <FileText className="mx-auto mb-3 h-8 w-8 text-muted-foreground/60" />
              <p className="text-sm">
                {templates.length === 0
                  ? 'No templates saved yet — write one on the Templates tab.'
                  : 'Nothing matches that.'}
              </p>
            </div>
          ) : (
            visible.map((template) => (
              <button
                key={template.id}
                type="button"
                className="w-full rounded-lg border border-border p-3 text-left transition-colors hover:bg-secondary/60"
                onClick={() => { onPick(template); onOpenChange(false); }}
              >
                <p className="font-medium text-foreground">{template.name}</p>
                <p className="truncate text-sm text-muted-foreground">
                  {template.subject || 'No subject'}
                </p>
              </button>
            ))
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
