import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useSignroom } from '@/hooks/useSignroom';
import { shortDate } from '@/lib/signroom/agreementFormat';
import { roleSummaries } from '@/lib/signroom/templates';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import type { AgreementTemplate, AgreementTemplateSummary } from '../../../../api/_signroom/shared/types';
import { messageOf } from './files';

interface TemplatePreviewDialogProps {
  /** The template to look at, or null while the dialog is closed. */
  template: AgreementTemplateSummary | null;
  onClose: () => void;
  /** Starts an agreement from the template being looked at. */
  onUse: (template: AgreementTemplateSummary) => void;
}

const plural = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`;

/** A look at one template before using it: its text, and who signs it and what they fill in. */
export const TemplatePreviewDialog: React.FC<TemplatePreviewDialogProps> = ({ template, onClose, onUse }) => (
  <Dialog open={template !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
    <DialogContent className="sm:max-w-3xl">
      {template && (
        <>
          <DialogHeader>
            <DialogTitle className="break-words">{template.name}</DialogTitle>
            <DialogDescription>
              {template.type} · v{template.version} · Created {shortDate(template.created)}
            </DialogDescription>
          </DialogHeader>
          <TemplateBody key={template.id} id={template.id} />
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>Close preview</Button>
            <Button onClick={() => onUse(template)}>Use template</Button>
          </DialogFooter>
        </>
      )}
    </DialogContent>
  </Dialog>
);

/** The list carries summaries, so the text, the roles and the fields come from the full template. */
const TemplateBody: React.FC<{ id: string }> = ({ id }) => {
  const { client } = useSignroom();
  const [full, setFull] = useState<AgreementTemplate | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    client.call<AgreementTemplate>(`templates/${id}`)
      .then((loaded) => { if (active) setFull(loaded); })
      .catch((e) => { if (active) setError(messageOf(e, 'Could not load this template.')); });
    return () => { active = false; };
  }, [client, id]);

  if (error) return (
    <p role="alert" className="rounded-lg border border-dashed border-border px-4 py-10 text-center text-sm text-destructive">{error}</p>
  );
  if (!full) return (
    <div className="py-10 text-center">
      <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" aria-label="Loading template" />
    </div>
  );

  const roles = roleSummaries(full);
  const pages = full.pages?.length ?? 0;
  const uploaded = full.sourceKind === 'upload';

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-foreground">Signers and fields</h3>
        {roles.length === 0 ? (
          <p className="text-sm text-muted-foreground">No signer roles are saved with this template.</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {roles.map((r, index) => (
              <li key={`${index}-${r.role}`} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 px-3 py-2 text-sm">
                <span className="font-medium text-foreground">{r.role}</span>
                <span className="text-muted-foreground">{r.fields.length ? r.fields.join(', ') : 'No fields'}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-foreground">Document</h3>
        {uploaded ? (
          <p className="rounded-lg border border-border bg-secondary/50 px-3 py-3 text-sm text-muted-foreground">
            {pages > 0
              ? `This template uses an uploaded PDF of ${plural(pages, 'page', 'pages')}, so there is no text to show here.`
              : 'This template uses an uploaded PDF, so there is no text to show here.'}
          </p>
        ) : (
          <>
            <div
              role="region"
              aria-label="Template text"
              tabIndex={0}
              className="max-h-[45vh] overflow-auto rounded-lg border border-border bg-secondary/50 p-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-foreground">
                {full.content || 'This template has no text.'}
              </pre>
            </div>
            {full.content.includes('{{client_name}}') && (
              <p className="text-xs text-muted-foreground">
                {'{{client_name}}'} becomes the company’s name when an agreement is started from this template.
              </p>
            )}
          </>
        )}
      </section>
    </div>
  );
};

export default TemplatePreviewDialog;
