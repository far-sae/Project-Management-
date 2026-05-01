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
        'mt-1.5 flex flex-col gap-1.5 max-w-full',
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
            className="block overflow-hidden rounded-lg border border-border/60 max-w-[14rem]"
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
            className={cn(
              'inline-flex items-center gap-2 rounded-md border px-2 py-1.5 text-xs max-w-[14rem]',
              mine
                ? 'border-primary-foreground/30 bg-primary/80 text-primary-foreground hover:bg-primary'
                : 'border-border bg-background hover:bg-muted',
            )}
          >
            {att.fileType.includes('pdf') || att.fileType.includes('text') ? (
              <FileText className="w-4 h-4 shrink-0" />
            ) : (
              <ImageIcon className="w-4 h-4 shrink-0" />
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{att.fileName}</p>
              <p className="text-[10px] opacity-70">
                {formatFileSize(att.fileSize)}
              </p>
            </div>
            <Download className="w-3 h-3 shrink-0" />
          </a>
        ),
      )}
    </div>
  );
};

export default ChatAttachmentList;
