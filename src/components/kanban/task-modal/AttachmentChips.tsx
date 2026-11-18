import React, { useState } from 'react';
import { Download, FileText, Image as ImageIcon, Paperclip } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface AttachmentChip {
  fileId: string;
  fileName: string;
  fileUrl: string;
  fileType?: string;
}

export type AttachmentKind = 'image' | 'pdf' | 'other';

/** What a file is, from its MIME type or (failing that) its extension. */
export function attachmentKind(file: { fileName?: string; fileType?: string }): AttachmentKind {
  const name = file.fileName?.toLowerCase() || '';
  const type = file.fileType?.toLowerCase() || '';
  if (type.startsWith('image/') || /\.(jpg|jpeg|png|gif|webp|svg|bmp)$/.test(name)) return 'image';
  if (type === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
  return 'other';
}

const KIND_ICON: Record<AttachmentKind, typeof Paperclip> = {
  image: ImageIcon,
  pdf: FileText,
  other: Paperclip,
};

const CHIP =
  'inline-flex h-8 max-w-full items-center gap-2 rounded-md border border-border bg-background px-2.5 text-sm font-medium text-foreground transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

/**
 * The task's files as compact bordered chips. Images and PDFs open in a
 * preview (with a download link); other files open in a new tab.
 */
export const AttachmentChips: React.FC<{ attachments: AttachmentChip[] }> = ({ attachments }) => {
  const [preview, setPreview] = useState<AttachmentChip | null>(null);
  const previewKind = preview ? attachmentKind(preview) : null;

  return (
    <>
      <ul className="flex flex-wrap gap-2">
        {attachments.map((file) => {
          const kind = attachmentKind(file);
          const Icon = KIND_ICON[kind];
          const content = (
            <>
              <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="truncate">{file.fileName}</span>
            </>
          );
          return (
            <li key={file.fileId || file.fileUrl} className="min-w-0 max-w-full sm:max-w-[260px]">
              {kind === 'other' ? (
                <a
                  href={file.fileUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={file.fileName}
                  className={CHIP}
                >
                  {content}
                </a>
              ) : (
                <button type="button" title={file.fileName} onClick={() => setPreview(file)} className={CHIP}>
                  {content}
                </button>
              )}
            </li>
          );
        })}
      </ul>

      <Dialog open={preview !== null} onOpenChange={(next) => { if (!next) setPreview(null); }}>
        {preview && (
          <DialogContent
            aria-describedby={undefined}
            className="flex flex-col gap-0 overflow-hidden p-0 pt-0 pb-0 focus-visible:outline-none sm:max-w-4xl sm:p-0 sm:pt-0 sm:pb-0"
          >
            <div className="flex min-h-[52px] shrink-0 items-center gap-3 border-b border-border py-2 pl-4 pr-14">
              <DialogTitle className="min-w-0 flex-1 truncate text-sm" title={preview.fileName}>
                {preview.fileName}
              </DialogTitle>
              <a
                href={preview.fileUrl}
                download={preview.fileName}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'shrink-0')}
              >
                <Download aria-hidden />
                Download
              </a>
            </div>
            <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-surface-2">
              {previewKind === 'image' ? (
                <img
                  src={preview.fileUrl}
                  alt={preview.fileName}
                  className="max-h-[75vh] max-w-full object-contain"
                />
              ) : (
                <iframe src={preview.fileUrl} title={preview.fileName} className="h-[75vh] w-full" />
              )}
            </div>
          </DialogContent>
        )}
      </Dialog>
    </>
  );
};

export default AttachmentChips;
