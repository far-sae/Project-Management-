import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Loader2, RefreshCw, Plus, Save, Pencil, Trash2, FileText, PenLine, Info } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { useAuth } from '@/context/AuthContext';
import { listTemplates, saveTemplate, deleteTemplate } from '@/services/supabase/emailAudience';
import { listCampaigns } from '@/services/supabase/email';
import { templateStats, replyRate, EMPTY_TEMPLATE_STATS } from '@/lib/email/templateStats';
import type { TemplateStats } from '@/lib/email/templateStats';
import type { EmailTemplate } from '@/lib/email/types';
import { RichTextEditor } from './RichTextEditor';

interface TemplatesTabProps {
  orgId: string;
  workspaceId: string | null;
  /**
   * Hands a template's wording to the composer. The point of the whole
   * screen: a template nobody can start a message from is a notepad.
   */
  onUseTemplate: (template: EmailTemplate) => void;
}

interface TemplateFormState {
  name: string;
  subject: string;
  bodyHtml: string;
}

const EMPTY_TEMPLATE_FORM: TemplateFormState = { name: '', subject: '', bodyHtml: '' };

/**
 * What a contact-sourced recipient actually carries, and therefore the only
 * placeholders a template may offer. Written out rather than derived from a
 * particular campaign's recipients, because a template is written before
 * anybody has chosen who it goes to — `pain_point` and the group's `angle`
 * are the two that make it worth having a template at all.
 */
const TEMPLATE_MERGE_FIELDS = [
  'first_name', 'last_name', 'full_name', 'email',
  'job_title', 'pain_point', 'angle', 'group_name',
];

/** Strips tags for the one-line preview under the name. */
const textOf = (html: string): string =>
  html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

export const TemplatesTab: React.FC<TemplatesTabProps> = ({ orgId, workspaceId, onUseTemplate }) => {
  const { user } = useAuth();
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  /**
   * Every campaign, kept only to total per template. One read, handed
   * straight to `templateStats` — the counts it sums are columns the send and
   * inbox paths already maintain, and a second place that counts sends is a
   * second place for the two to disagree.
   */
  const [campaignStats, setCampaignStats] = useState<Record<string, TemplateStats>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [showDialog, setShowDialog] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<TemplateFormState>(EMPTY_TEMPLATE_FORM);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!orgId) { setTemplates([]); setCampaignStats({}); setLoading(false); return; }
    if (silent) setRefreshing(true); else setLoading(true);
    try {
      const [rows, campaigns] = await Promise.all([
        listTemplates(orgId, workspaceId),
        listCampaigns(orgId, workspaceId),
      ]);
      setTemplates(rows);
      setCampaignStats(templateStats(campaigns));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load templates');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [orgId, workspaceId]);

  useEffect(() => { void load(); }, [load]);

  const unused = useMemo(
    () => templates.filter((t) => (campaignStats[t.id]?.campaigns ?? 0) === 0).length,
    [templates, campaignStats],
  );

  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY_TEMPLATE_FORM);
    setSaveError(null);
    setShowDialog(true);
  };

  const openEdit = (template: EmailTemplate) => {
    setEditingId(template.id);
    setForm({ name: template.name, subject: template.subject, bodyHtml: template.bodyHtml });
    setSaveError(null);
    setShowDialog(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgId || !form.name.trim()) return;
    setSaving(true);
    setSaveError(null);
    try {
      await saveTemplate({
        ...(editingId ? { id: editingId } : {}),
        organizationId: orgId,
        workspaceId,
        createdBy: user?.userId ?? null,
        name: form.name,
        subject: form.subject,
        bodyHtml: form.bodyHtml,
      });
      setShowDialog(false);
      await load(true);
      toast.success(editingId ? 'Template saved' : 'Template created');
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save template');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (template: EmailTemplate) => {
    const used = campaignStats[template.id]?.campaigns ?? 0;
    // The reassurance people need before clicking. A campaign COPIES from a
    // template, so its own subject and body are untouched; `template_id` is
    // `on delete set null` (migration 162c) and all that is lost is the
    // record of where the wording came from — and with it, this screen's
    // ability to attribute those sends to anything.
    const consequence = used === 0
      ? 'No campaign has been written from it yet.'
      : `The ${used} campaign${used === 1 ? '' : 's'} written from it keep their own wording — `
        + 'they only lose the record of where it came from, and their sends stop being counted here.';
    if (!window.confirm(`Delete the template "${template.name}"? ${consequence}`)) return;
    setDeletingId(template.id);
    try {
      await deleteTemplate(template.id);
      setTemplates((prev) => prev.filter((t) => t.id !== template.id));
      toast.success('Template deleted');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete template');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <div>
            <CardTitle>Templates</CardTitle>
            <p className="text-sm text-muted-foreground">
              Wording you start a message from, and how the messages started from it did.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button variant="outline" size="sm" onClick={() => load(true)} disabled={refreshing}>
              {refreshing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
              Refresh
            </Button>
            <Button size="sm" onClick={openCreate}>
              <Plus className="w-4 h-4 mr-2" />New template
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Not an error. But a template with no campaigns behind it has no
              stats to compare against the others, which is half of what this
              screen is for — and the fix is one button away. */}
          {!loading && templates.length > 0 && unused > 0 && (
            <div className="rounded-lg border border-border bg-secondary/40 p-3 text-sm text-muted-foreground">
              {unused === 1 ? '1 template has' : `${unused} templates have`} never been used. Start a
              message from one and its numbers appear here.
            </div>
          )}

          {loading ? (
            <div className="text-center py-16 text-muted-foreground">
              <Loader2 className="w-10 h-10 mx-auto mb-4 animate-spin text-muted-foreground/60" />
              <p>Loading templates...</p>
            </div>
          ) : templates.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              <FileText className="w-14 h-14 mx-auto mb-4 text-muted-foreground/60" />
              <p className="text-lg font-medium text-foreground">No templates yet</p>
              <p className="text-sm">
                Save the wording that works, then start every message from it.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {templates.map((template) => {
                const stats = campaignStats[template.id] ?? EMPTY_TEMPLATE_STATS;
                const rate = replyRate(stats);
                const preview = textOf(template.bodyHtml);
                return (
                  <div
                    key={template.id}
                    className="flex items-start justify-between gap-4 p-3 bg-secondary/40 border border-border rounded-lg"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-medium text-foreground truncate">{template.name}</p>
                        <Badge variant="outline">
                          {stats.campaigns} campaign{stats.campaigns === 1 ? '' : 's'}
                        </Badge>
                        {/* Replies over sends, and no equivalent for opens.
                            An open rate computed from a number the product
                            itself calls an estimate is a figure with a decimal
                            point and no meaning, and it is the one people
                            quote. Null rather than 0% before anything has gone
                            out: a template nobody has used yet reading "0%"
                            looks like a template that does not work. */}
                        {rate !== null && (
                          <Badge variant="outline" title={`${stats.replied} replies from ${stats.sent} sent`}>
                            {(rate * 100).toFixed(1)}% replied
                          </Badge>
                        )}
                      </div>
                      {template.subject.trim() ? (
                        <p className="text-sm text-muted-foreground mt-1 truncate">{template.subject}</p>
                      ) : (
                        <p className="text-sm text-muted-foreground mt-1 italic">No subject yet</p>
                      )}
                      {preview && (
                        <p className="text-xs text-muted-foreground mt-1 truncate">{preview}</p>
                      )}
                      {/* The same counts, in the same order and the same
                          colours, as the Campaigns list — including two open
                          figures rather than one. `opened` excludes the opens
                          that looked automatic and `openedAutomatically` is how
                          many those were, so the second is what says how much
                          to trust the first. Added together this would report a
                          template as read by people who never saw it. */}
                      <div className="flex items-center gap-4 text-xs mt-2 flex-wrap">
                        <span className="text-emerald-600 dark:text-emerald-400" title="Sent">S {stats.sent}</span>
                        <span
                          className="text-violet-600 dark:text-violet-400"
                          title={
                            stats.openedAutomatically > 0
                              ? `Opened by a person (estimate). A further ${stats.openedAutomatically} `
                                + 'were opened automatically — Apple Mail and most security scanners load '
                                + 'images without anybody reading the message — and are not counted here.'
                              : 'Opened (estimate — clients that block images record nothing, so this is a floor)'
                          }
                        >
                          O {stats.opened}
                          {stats.openedAutomatically > 0 && (
                            <span className="text-muted-foreground"> +{stats.openedAutomatically} auto</span>
                          )}
                        </span>
                        <span className="text-blue-600 dark:text-blue-400" title="Replied">R {stats.replied}</span>
                        <span className="text-amber-600 dark:text-amber-400" title="Bounced">B {stats.bounced}</span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        Updated {format(template.updatedAt, 'MMM d, yyyy')}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button variant="outline" size="sm" onClick={() => onUseTemplate(template)}>
                        <PenLine className="w-4 h-4 mr-2" />Use this template
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Edit ${template.name}`}
                        onClick={() => openEdit(template)}
                      >
                        <Pencil className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Delete ${template.name}`}
                        disabled={deletingId === template.id}
                        onClick={() => handleDelete(template)}
                      >
                        {deletingId === template.id
                          ? <Loader2 className="w-4 h-4 animate-spin" />
                          : <Trash2 className="w-4 h-4 text-red-600" />}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="sm:max-w-[680px]">
          <DialogHeader>
            <DialogTitle>{editingId ? 'Edit template' : 'New template'}</DialogTitle>
            <DialogDescription>
              Wording to start a message from. A campaign copies this text rather than pointing at
              it, so editing a template never changes mail that has already gone out.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSave} className="space-y-4">
            {saveError && (
              <div className="p-3 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 rounded-md">
                <p className="text-sm text-red-700 dark:text-red-300">{saveError}</p>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="template-name">Name *</Label>
              <Input
                id="template-name"
                value={form.name}
                placeholder="Agency cold open"
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                required
              />
              <p className="text-xs text-muted-foreground">
                What you call it here. The recipient never sees it.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="template-subject">Subject</Label>
              <Input
                id="template-subject"
                value={form.subject}
                placeholder="{{first_name}}, a thought on {{pain_point}}"
                onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))}
              />
            </div>

            <div className="space-y-2">
              <Label>Body</Label>
              <RichTextEditor
                value={form.bodyHtml} mergeFields={TEMPLATE_MERGE_FIELDS}
                placeholder="Write the message. Source shows the raw HTML."
                onChange={(html) => setForm((f) => ({ ...f, bodyHtml: html }))}
              />
              <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                Personalize with {TEMPLATE_MERGE_FIELDS.map((f) => `{{${f}}}`).join(', ')} in the
                subject or body. They fill in from the prospect and their group when the campaign
                is composed.
              </p>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowDialog(false)} disabled={saving}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving || !form.name.trim()}>
                {saving
                  ? <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  : editingId ? <Save className="w-4 h-4 mr-2" /> : <Plus className="w-4 h-4 mr-2" />}
                {editingId ? 'Save' : 'Create template'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default TemplatesTab;
