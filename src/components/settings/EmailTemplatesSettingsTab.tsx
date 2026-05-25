import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, Save, Loader2, MailPlus, Code2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { useEmailTemplates } from '@/hooks/useEmailTemplates';
import { EmailTemplate, MERGE_TOKENS } from '@/services/supabase/emailTemplates';
import { toast } from 'sonner';

const blank = { name: '', subject: '', body: '' };

export const EmailTemplatesSettingsTab: React.FC = () => {
  const { templates, loading, create, update, remove } = useEmailTemplates();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [form, setForm] = useState(blank);
  const [busy, setBusy] = useState(false);
  const [isNew, setIsNew] = useState(false);

  const active = useMemo<EmailTemplate | null>(
    () => templates.find((t) => t.templateId === activeId) ?? null,
    [templates, activeId],
  );

  useEffect(() => {
    if (active && !isNew) {
      setForm({
        name: active.name,
        subject: active.subject ?? '',
        body: active.body ?? '',
      });
    }
  }, [active, isNew]);

  useEffect(() => {
    if (!activeId && !isNew && templates.length > 0) {
      setActiveId(templates[0].templateId);
    }
  }, [templates, activeId, isNew]);

  const startNew = () => {
    setIsNew(true);
    setActiveId(null);
    setForm(blank);
  };

  const insertToken = (token: string) => {
    setForm((f) => ({ ...f, body: `${f.body}${f.body && !f.body.endsWith(' ') ? ' ' : ''}${token}` }));
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      toast.error('Template name is required');
      return;
    }
    setBusy(true);
    try {
      if (isNew || !active) {
        const created = await create({
          name: form.name,
          subject: form.subject,
          body: form.body,
        });
        toast.success(`Saved "${created.name}"`);
        setIsNew(false);
        setActiveId(created.templateId);
      } else {
        await update(active.templateId, {
          name: form.name,
          subject: form.subject,
          body: form.body,
        });
        toast.success(`Saved "${form.name}"`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save template');
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!active) return;
    if (!confirm(`Delete template "${active.name}"? This cannot be undone.`)) return;
    setBusy(true);
    try {
      await remove(active.templateId);
      toast.success('Template deleted');
      setActiveId(null);
      setForm(blank);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardContent className="pt-5">
        <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
          {/* Left — list */}
          <aside className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Templates</h3>
              <Button size="sm" variant="outline" onClick={startNew} disabled={busy}>
                <Plus className="w-3.5 h-3.5 mr-1" /> New
              </Button>
            </div>
            <div className="border rounded-md divide-y max-h-[420px] overflow-y-auto">
              {loading ? (
                <div className="p-3 text-xs text-muted-foreground inline-flex items-center gap-2">
                  <Loader2 className="w-3 h-3 animate-spin" /> Loading…
                </div>
              ) : templates.length === 0 && !isNew ? (
                <div className="p-3 text-xs text-muted-foreground">
                  No templates yet. Click "New" to write one.
                </div>
              ) : (
                <>
                  {isNew && (
                    <button
                      type="button"
                      className="w-full text-left p-2 text-xs bg-muted/40"
                    >
                      <div className="font-medium truncate">
                        {form.name.trim() || 'Untitled template'}
                      </div>
                      <Badge variant="outline" className="mt-1 text-[9px]">draft</Badge>
                    </button>
                  )}
                  {templates.map((t) => (
                    <button
                      key={t.templateId}
                      type="button"
                      onClick={() => {
                        if (busy) return;
                        setIsNew(false);
                        setActiveId(t.templateId);
                      }}
                      className={
                        'w-full text-left p-2 text-xs hover:bg-muted/40 ' +
                        (activeId === t.templateId && !isNew ? 'bg-muted/40' : '')
                      }
                    >
                      <div className="font-medium truncate">{t.name}</div>
                      {t.subject && (
                        <div className="text-[11px] text-muted-foreground truncate">
                          {t.subject}
                        </div>
                      )}
                    </button>
                  ))}
                </>
              )}
            </div>
          </aside>

          {/* Right — editor */}
          <section className="space-y-3">
            {!isNew && !active ? (
              <div className="border rounded-md p-6 text-sm text-muted-foreground text-center">
                <MailPlus className="w-8 h-8 mx-auto mb-2 text-muted-foreground/60" />
                Pick a template on the left, or click "New" to create one.
              </div>
            ) : (
              <>
                <div>
                  <Label className="text-xs">Template name</Label>
                  <Input
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="e.g. Initial outreach"
                    maxLength={120}
                    disabled={busy}
                  />
                </div>
                <div>
                  <Label className="text-xs">Subject</Label>
                  <Input
                    value={form.subject}
                    onChange={(e) => setForm({ ...form, subject: e.target.value })}
                    placeholder="Hi {{client.name}} — quick intro"
                    maxLength={300}
                    disabled={busy}
                  />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <Label className="text-xs">Body</Label>
                    <span className="text-[10px] text-muted-foreground inline-flex items-center gap-1">
                      <Code2 className="w-3 h-3" />
                      Use the buttons below to insert merge tokens.
                    </span>
                  </div>
                  <Textarea
                    value={form.body}
                    onChange={(e) => setForm({ ...form, body: e.target.value })}
                    placeholder={'Hi {{client.name}},\n\nI saw you work in {{client.industry}} and wanted to reach out…\n\nThanks,\n{{user.name}}'}
                    rows={9}
                    maxLength={8000}
                    disabled={busy}
                  />
                </div>
                <div>
                  <p className="text-[11px] text-muted-foreground mb-1">
                    Available tokens — click to insert into the body:
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {MERGE_TOKENS.map((tk) => (
                      <button
                        key={tk.token}
                        type="button"
                        disabled={busy}
                        onClick={() => insertToken(tk.token)}
                        className="text-[10px] px-2 py-0.5 rounded border bg-card hover:bg-muted/60"
                        title={tk.label}
                      >
                        {tk.token}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex items-center justify-end gap-2 pt-1">
                  {active && !isNew && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleDelete}
                      disabled={busy}
                      className="text-destructive hover:text-destructive"
                    >
                      <Trash2 className="w-4 h-4 mr-1" /> Delete
                    </Button>
                  )}
                  <Button onClick={handleSave} disabled={busy || !form.name.trim()}>
                    {busy ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <Save className="w-4 h-4 mr-2" />
                    )}
                    {isNew ? 'Save template' : 'Save changes'}
                  </Button>
                </div>
              </>
            )}
          </section>
        </div>
      </CardContent>
    </Card>
  );
};
