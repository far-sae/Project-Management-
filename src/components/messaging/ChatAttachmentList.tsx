import React from 'react';
import { Download, FileText, ImageIcon } from 'lucide-react';
import { ChatAttachment } from '@/services/supabase/database';
import { formatFileSize } from '@/services/supabase/storage';
import { cn } from '@/lib/utils';

interface Props {
  attachments: ChatAttachment[];
  mine?: boolean;
}

const isImage = (type: string) => type.startsWith('image/');

/** Renders a chat message's file attachments. Images get an inline preview;
 *  other types render as a clickable file pill that opens in a new tab. */
export const ChatAttachmentList: React.FC<Props> = ({ attachments, mine }) => {
  if (!attachments?.length) return null;

  return (
    <div
      className={cn(
        'mt-1 flex max-w-full flex-col gap-1',
        mine && 'items-end',
      )}
    >
      {attachments.map((att, idx) =>
        isImage(att.fileType) ? (
          <a
            key={`${att.fileUrl}-${idx}`}
            href={att.fileUrl}
            target="_blank"
            rel="noreferrer"
            className="block max-w-[14rem] overflow-hidden rounded-lg border border-border"
            title={att.fileName}
          >
            <img
              src={att.fileUrl}
              alt={att.fileName}
              className="block h-auto w-full max-h-48 object-cover"
              loading="lazy"
            />
          </a>
        ) : (
          <a
            key={`${att.fileUrl}-${idx}`}
            href={att.fileUrl}
            target="_blank"
            rel="noreferrer"
            download={att.fileName}
            className="inline-flex max-w-[14rem] items-center gap-2 rounded-lg border border-border bg-card px-2 py-1.5 text-xs text-foreground transition-colors hover:bg-secondary"
          >
            {att.fileType.includes('pdf') || att.fileType.includes('text') ? (
              <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
            ) : (
              <ImageIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{att.fileName}</p>
              <p className="text-[11px] text-muted-foreground tabular-nums">
                {formatFileSize(att.fileSize)}
              </p>
            </div>
            <Download className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          </a>
        ),
      )}
    </div>
  );
};

export default ChatAttachmentList;
