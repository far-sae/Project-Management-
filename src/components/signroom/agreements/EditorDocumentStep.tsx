import React, { useId, useRef } from 'react';
import {
  ArrowRight, Download, FilePlus, FileUp, Heading1, List, Loader2, PenLine, ShieldCheck, Table, TriangleAlert,
} from 'lucide-react';
import { AI_REVIEW_SENTENCE } from '@/lib/signroom/aiDraft';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import PdfViewer from '@/components/signroom/PdfViewer';
import type { Agreement } from '../../../../api/_signroom/shared/types';
import { Card, Notice } from './Card';

const INSERTS: { label: string; icon: React.ReactNode; text: string }[] = [
  { label: 'Heading', icon: <Heading1 aria-hidden />, text: '\n# Heading\n' },
  { label: 'List', icon: <List aria-hidden />, text: '\n- First item\n- Second item\n' },
  { label: 'Table', icon: <Table aria-hidden />, text: '\n| Item | Details |\n| --- | --- |\n| Service | Description |\n' },
  { label: 'Page break', icon: <FilePlus aria-hidden />, text: '\n---PAGE BREAK---\n' },
];

interface EditorDocumentStepProps {
  draft: Agreement;
  busy: boolean;
  /** Show the uploaded PDF's summary instead of the text editor. */
  uploaded: boolean;
  onTitle: (title: string) => void;
  /** The whole new text of the agreement. */
  onText: (content: string) => void;
  onUpload: (file: File) => void;
  onWriteInstead: () => void;
  onPrepare: () => void;
  onDownloadSource: () => void;
  /** Opens Draft with AI. Offered only while the text is written here, never for an uploaded PDF. */
  onDraftWithAi?: () => void;
  /** The text came from an AI draft and the person has not saved since: keep the reminder to check it in view. */
  aiWritten?: boolean;
}

/** Step 1: the document itself, written here or uploaded as a PDF, and the exact PDF signers will see. */
export const EditorDocumentStep: React.FC<EditorDocumentStepProps> = ({
  draft, busy, uploaded, onTitle, onText, onUpload, onWriteInstead, onPrepare, onDownloadSource, onDraftWithAi, aiWritten = false,
}) => {
  const id = useId();
  const file = useRef<HTMLInputElement>(null);
  const editor = useRef<HTMLTextAreaElement>(null);

  const insert = (value: string) => {
    const area = editor.current;
    if (!area) return;
    onText(draft.content.slice(0, area.selectionStart) + value + draft.content.slice(area.selectionEnd));
    area.focus();
  };

  return (
    <Card
      title="Start with the document"
      note="Write your terms, or upload a PDF. Every signer reviews the same frozen PDF."
      action={(
        <div className="flex flex-wrap items-center gap-2">
          {!uploaded && onDraftWithAi && (
            <Button type="button" variant="outline" disabled={busy} onClick={onDraftWithAi}>
              <PenLine aria-hidden /> Draft with AI
            </Button>
          )}
          <input
            ref={file}
            type="file"
            accept="application/pdf,.pdf"
            aria-label="Upload agreement PDF"
            className="sr-only"
            tabIndex={-1}
            disabled={busy}
            onChange={(e) => {
              const chosen = e.target.files?.[0];
              if (chosen) onUpload(chosen);
              e.target.value = '';
            }}
          />
          <Button type="button" variant="outline" disabled={busy} onClick={() => file.current?.click()}>
            <FileUp aria-hidden /> Upload PDF
          </Button>
        </div>
      )}
    >
      <div className="flex flex-col gap-4 p-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${id}-title`}>Agreement title</Label>
          <Input id={`${id}-title`} value={draft.title} maxLength={150} onChange={(e) => onTitle(e.target.value)} />
        </div>

        {uploaded ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-secondary/50 px-4 py-3">
            <div className="flex min-w-0 items-center gap-3">
              <FileUp className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
              <div className="min-w-0">
                <p className="text-sm font-medium">Uploaded PDF is ready</p>
                <p className="text-xs tabular-nums text-muted-foreground">
                  {draft.pages.length} pages · rotation and crop normalised · private storage
                </p>
              </div>
            </div>
            <Button type="button" variant="outline" disabled={busy} onClick={onWriteInstead}>Write instead</Button>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {aiWritten && (
              <Notice icon={<TriangleAlert />} className="text-foreground">
                <span className="font-medium">This text was written by AI.</span>{' '}
                <span>{AI_REVIEW_SENTENCE}</span>
              </Notice>
            )}
            <div className="flex flex-wrap items-center gap-1.5" role="toolbar" aria-label="Document formatting">
              {INSERTS.map((item) => (
                <Button key={item.label} type="button" variant="outline" size="sm" onClick={() => insert(item.text)}>
                  {item.icon} {item.label}
                </Button>
              ))}
            </div>
            <Label htmlFor={`${id}-content`} className="sr-only">Agreement content</Label>
            <Textarea
              id={`${id}-content`}
              ref={editor}
              value={draft.content}
              onChange={(e) => onText(e.target.value)}
              className="min-h-[24rem] resize-y font-mono leading-relaxed"
              placeholder="Write the agreement terms here. Use the toolbar for headings, lists, tables and page breaks. The sender is responsible for the terms."
            />
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="min-w-0 flex-1 basis-60 text-xs text-muted-foreground">
                Formatting uses # headings, - lists and | table cells |. HTML is removed when preparing the PDF.
              </p>
              <Button type="button" disabled={busy} onClick={onPrepare}>
                {busy && <Loader2 className="animate-spin" aria-hidden />}
                {busy ? 'Preparing…' : draft.documentHash ? 'Rebuild PDF' : 'Prepare signing PDF'}
                {!busy && <ArrowRight aria-hidden />}
              </Button>
            </div>
          </div>
        )}

        {draft.documentHash && (
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">Exact PDF preview</h3>
              <Button type="button" variant="ghost" size="sm" onClick={onDownloadSource}>
                <Download aria-hidden /> Download source
              </Button>
            </div>
            <PdfViewer
              key={draft.documentHash}
              agreement={{ id: draft.id, kind: 'source', version: draft.documentHash }}
            />
          </div>
        )}

        <Notice icon={<ShieldCheck />}>
          Uploads require a clean virus check, then receive structural checks and PDF normalisation before signing.
        </Notice>
      </div>
    </Card>
  );
};

export default EditorDocumentStep;
