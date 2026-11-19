import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, Copy, Loader2, MoreHorizontal, Search } from 'lucide-react';
import { toast } from 'sonner';
import { useSignroom } from '@/hooks/useSignroom';
import { shortDate } from '@/lib/signroom/agreementFormat';
import { filterTemplates, isOlderVersion } from '@/lib/signroom/templates';
import { PageHeader } from '@/components/common/PageHeader';
import { StatusPill } from '@/components/common/StatusPill';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { NewAgreementDialog } from '@/components/signroom/agreements/NewAgreementDialog';
import { TemplatePreviewDialog } from '@/components/signroom/agreements/TemplatePreviewDialog';
import { TextPromptDialog } from '@/components/signroom/agreements/TextPromptDialog';
import { useConfirm } from '@/components/signroom/agreements/useConfirm';
import { messageOf } from '@/components/signroom/agreements/files';
import type { AgreementTemplateSummary } from '../../../api/_signroom/shared/types';

/** What the server says the person is in this workspace. `unknown` when it could not be asked. */
type Role = 'Owner' | 'Member' | 'unknown';

const DELETE_REASON: Record<Exclude<Role, 'Owner'>, string> = {
  Member: 'Only a workspace owner can delete templates.',
  unknown: 'Your role could not be checked. Reload the page to delete templates.',
};

const plural = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`;

/** The workspace's agreement templates: look at one, rename it, delete it, or start an agreement from it. */
export const TemplatesPage: React.FC = () => {
  const { client, workspaceId } = useSignroom();
  const { ask, dialog: confirmDialog } = useConfirm();

  const [templates, setTemplates] = useState<AgreementTemplateSummary[]>([]);
  const [role, setRole] = useState<Role | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<AgreementTemplateSummary | null>(null);
  const [using, setUsing] = useState<AgreementTemplateSummary | null>(null);
  const [renaming, setRenaming] = useState<AgreementTemplateSummary | null>(null);
  const [renameError, setRenameError] = useState('');

  const load = useCallback(async () => {
    if (!workspaceId) { setTemplates([]); setRole(null); return; }
    setLoading(true);
    setError('');
    // Deleting is for the workspace's owners; the server says who that is, and checks again on the delete itself.
    client.call<{ role?: string }>('session')
      .then((session) => setRole(session.role === 'Owner' ? 'Owner' : 'Member'))
      .catch(() => setRole('unknown'));
    try {
      setTemplates(await client.call<AgreementTemplateSummary[]>('templates'));
    } catch (e) {
      setError(messageOf(e, 'Could not load templates.'));
    } finally {
      setLoading(false);
    }
  }, [client, workspaceId]);

  useEffect(() => { void load(); }, [load]);

  const visible = useMemo(() => filterTemplates(templates, search), [templates, search]);

  const rename = async (template: AgreementTemplateSummary, name: string) => {
    if (name === template.name) { setRenaming(null); return; }
    setBusy(true);
    setRenameError('');
    try {
      const renamed = await client.call<AgreementTemplateSummary>(`templates/${template.id}/rename`, { name });
      setTemplates((list) => list.map((t) => (t.id === renamed.id ? renamed : t)));
      setRenaming(null);
      toast.success('Template renamed.');
      // Other versions may carry the name too; the list is read again quietly so every row shows what the server has.
      client.call<AgreementTemplateSummary[]>('templates').then(setTemplates).catch(() => {});
    } catch (e) {
      // The dialog stays open with the reason, so the person can pick another name.
      setRenameError(messageOf(e, 'Could not rename the template.'));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (template: AgreementTemplateSummary) => {
    if (role !== 'Owner') return;
    const yes = await ask({
      title: `Delete “${template.name}”?`,
      description: `Version ${template.version} of this template is removed for everyone in the workspace. Agreements already started from it keep their text. This cannot be undone.`,
      confirmLabel: 'Delete template',
      cancelLabel: 'Keep template',
      destructive: true,
    });
    if (!yes) return;
    setBusy(true);
    try {
      await client.call<{ ok: true }>(`templates/${template.id}`, undefined, 'DELETE');
      setTemplates((list) => list.filter((t) => t.id !== template.id));
      toast.success('Template deleted.');
    } catch (e) {
      toast.error(messageOf(e, 'Could not delete the template.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="min-w-0 flex-1 overflow-y-auto bg-background">
      <div className="flex w-full flex-col gap-6 px-4 py-6 lg:px-6">
        <PageHeader
          title="Templates"
          description="Agreements you can start again and again, with their text, signer roles and field positions already in place."
          actions={(
            <Button asChild variant="outline">
              <Link to="/crm/agreements"><ChevronLeft aria-hidden /> Agreements</Link>
            </Button>
          )}
        />

        {!workspaceId ? (
          <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border px-4 py-16 text-center">
            <Copy className="h-5 w-5 text-muted-foreground" aria-hidden />
            <p className="text-sm text-muted-foreground">
              Pick a workspace in the sidebar to see its templates. Each template belongs to one workspace.
            </p>
          </div>
        ) : loading && templates.length === 0 ? (
          <div className="py-16 text-center">
            <Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" aria-label="Loading templates" />
          </div>
        ) : error ? (
          <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border px-4 py-16 text-center">
            <p role="alert" className="text-sm text-destructive">{error}</p>
            <Button variant="outline" onClick={() => void load()}>Try again</Button>
          </div>
        ) : templates.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border px-4 py-16 text-center">
            <Copy className="h-5 w-5 text-muted-foreground" aria-hidden />
            <div className="flex max-w-md flex-col gap-1">
              <p className="text-sm font-medium text-foreground">No templates yet.</p>
              <p className="text-sm text-muted-foreground">
                To make one, open a draft agreement and choose “Save as template” on its last step, Review and send.
                The template keeps the text, the signer roles and the field positions.
              </p>
            </div>
            <Button asChild variant="outline">
              <Link to="/crm/agreements">Open agreements</Link>
            </Button>
          </div>
        ) : (
          <>
            <div className="relative max-w-md">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name or type"
                aria-label="Search templates"
                className="pl-8"
              />
            </div>

            {visible.length === 0 ? (
              <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border px-4 py-16 text-center">
                <p className="text-sm text-muted-foreground">No templates match your search.</p>
                <Button variant="outline" onClick={() => setSearch('')}>Clear search</Button>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <div
                  className="overflow-x-auto rounded-lg border border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  role="region"
                  aria-label="Templates table"
                  tabIndex={0}
                >
                  <table className="w-full min-w-[44rem] text-sm">
                    <thead>
                      <tr className="border-b border-border text-xs text-muted-foreground">
                        <th scope="col" className="px-3 py-2 text-left font-medium">Name</th>
                        <th scope="col" className="px-3 py-2 text-left font-medium">Type</th>
                        <th scope="col" className="px-3 py-2 text-left font-medium">Version</th>
                        <th scope="col" className="px-3 py-2 text-left font-medium">Created</th>
                        <th scope="col" className="px-3 py-2 text-right font-medium"><span className="sr-only">Actions</span></th>
                      </tr>
                    </thead>
                    <tbody>
                      {visible.map((t) => (
                        <tr key={t.id} className="border-b border-border last:border-b-0 hover:bg-muted/40">
                          <td className="px-3 py-2">
                            <div className="flex min-w-0 items-center gap-2.5">
                              <span aria-hidden className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-secondary text-muted-foreground">
                                <Copy className="h-4 w-4" />
                              </span>
                              <button
                                type="button"
                                onClick={() => setPreview(t)}
                                className="block max-w-[26rem] truncate rounded-md text-left font-medium text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              >
                                {t.name}
                              </button>
                            </div>
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">{t.type}</td>
                          <td className="px-3 py-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="tabular-nums text-muted-foreground">v{t.version}</span>
                              {isOlderVersion(t, templates) && (
                                <StatusPill tone="muted" dot={false} title="A newer version of this template exists.">Older version</StatusPill>
                              )}
                            </div>
                          </td>
                          <td className="whitespace-nowrap px-3 py-2 tabular-nums text-muted-foreground">{shortDate(t.created)}</td>
                          <td className="px-3 py-1.5">
                            <div className="flex items-center justify-end gap-1.5">
                              <Button size="sm" variant="outline" onClick={() => setUsing(t)}>Use template</Button>
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button size="icon" variant="ghost" aria-label={`More actions for ${t.name}, version ${t.version}`} disabled={busy}>
                                    <MoreHorizontal />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem onClick={() => setPreview(t)}>Preview</DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => { setRenameError(''); setRenaming(t); }}>Rename</DropdownMenuItem>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem
                                    className="text-destructive focus:text-destructive"
                                    disabled={role !== 'Owner'}
                                    onClick={() => void remove(t)}
                                  >
                                    Delete
                                  </DropdownMenuItem>
                                  {role && role !== 'Owner' && (
                                    <p className="max-w-[15rem] px-2 pb-1.5 pt-0.5 text-xs text-muted-foreground">{DELETE_REASON[role]}</p>
                                  )}
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-xs tabular-nums text-muted-foreground">{plural(visible.length, 'template', 'templates')}</p>
              </div>
            )}
          </>
        )}
      </div>

      {confirmDialog}
      <TemplatePreviewDialog
        template={preview}
        onClose={() => setPreview(null)}
        onUse={(template) => { setPreview(null); setUsing(template); }}
      />
      <TextPromptDialog
        open={renaming !== null}
        onOpenChange={(open) => { if (!open) setRenaming(null); }}
        title="Rename template"
        description="The new name is what people see when they start an agreement from this template."
        label="Template name"
        initialValue={renaming?.name ?? ''}
        maxLength={120}
        confirmLabel="Rename"
        busy={busy}
        error={renameError}
        onConfirm={(name) => { if (renaming) void rename(renaming, name); }}
      />
      <NewAgreementDialog
        open={using !== null}
        onOpenChange={(open) => { if (!open) setUsing(null); }}
        template={using ?? undefined}
      />
    </main>
  );
};

export default TemplatesPage;
