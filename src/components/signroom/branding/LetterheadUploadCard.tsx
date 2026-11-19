// The person's own letterhead PDF: upload one, replace it, remove it, and choose what is printed on top of it.
import React, { useId } from 'react';
import { FileText, Loader2, Trash2 } from 'lucide-react';
import type { TemplateFile } from '../../../../api/_signroom/shared/types';
import { StatusPill } from '@/components/common/StatusPill';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, FIELD, Tick } from '@/components/signroom/billing/shared';

interface Props {
  /** The letterhead PDF on the page now, saved or not; null for none. */
  template: TemplateFile | null;
  /** True when that PDF is the one already saved for the workspace. */
  saved: boolean;
  /** Whether the logo, company details and text boxes are also printed on top of the PDF. */
  overlay: boolean;
  onOverlay: (overlay: boolean) => void;
  onFile: (file: File | undefined) => void;
  onRemove: () => void;
  /** A chosen file is with the server being checked. */
  uploading: boolean;
  locked: boolean;
  /** The PDF could not be fetched or drawn for the designer's page. */
  pictureFailed: boolean;
}

const RULES = 'one A4 portrait page, up to 4 MB';

export const LetterheadUploadCard: React.FC<Props> = ({
  template, saved, overlay, onOverlay, onFile, onRemove, uploading, locked, pictureFailed,
}) => {
  const id = useId();
  const chooser = (label: string) => (
    <div className={FIELD}>
      <Label htmlFor={`${id}-file`}>{label}</Label>
      <Input
        id={`${id}-file`} type="file" accept="application/pdf,.pdf" disabled={locked || uploading} className="max-w-md"
        onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; onFile(file); }}
      />
    </div>
  );

  return (
    <Card title="Your own letterhead PDF">
      <div className="flex flex-col gap-4 p-4">
        <p className="max-w-3xl text-sm text-muted-foreground">
          If you already have a letterhead, upload it as a blank page saved from Word, Canva or your designer. It is printed behind every
          page of every document, so leave the middle of the page empty. It is checked for viruses before it is stored.
        </p>

        {template && (
          <div className="flex flex-col gap-3 rounded-lg border border-border bg-background p-3">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <FileText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="min-w-0 break-all text-sm font-medium text-foreground">{template.name}</span>
              {saved
                ? <StatusPill tone="success">In use</StatusPill>
                : <StatusPill tone="warning">Not saved yet</StatusPill>}
              <Button type="button" variant="ghost" size="sm" className="ml-auto" disabled={locked || uploading} onClick={onRemove}>
                <Trash2 aria-hidden /> Remove the letterhead PDF
              </Button>
            </div>
            <Tick checked={overlay} disabled={locked || uploading} onChange={onOverlay}>
              Also print my logo, company details and text boxes on top of this PDF
            </Tick>
            <p className="text-xs text-muted-foreground">
              Leave this off if your PDF already shows your logo and contact details. With it off, the PDF is printed as it is and only
              the header and footer heights below apply.
            </p>
            {pictureFailed && (
              <p role="status" className="text-xs text-muted-foreground">
                Your letterhead PDF could not be shown on the page below. It is still used on your documents.
              </p>
            )}
          </div>
        )}

        {chooser(template ? `Replace the letterhead PDF (${RULES})` : `Letterhead PDF (${RULES})`)}
        {uploading && (
          <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Checking the PDF
          </p>
        )}
      </div>
    </Card>
  );
};

export default LetterheadUploadCard;
