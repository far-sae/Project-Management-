import React, { useState } from 'react';
import { Paperclip, FileText, X, Download, ZoomIn } from 'lucide-react';
import { truncateFileName } from '@/lib/utils';

interface Attachment {
  fileId: string;
  fileName: string;
  fileUrl: string;
  fileType?: string;
}

interface AttachmentPreviewProps {
  attachments: Attachment[];
  stopPropagation?: boolean; // for comment cards that navigate on click
}


// ✅ Detect file type from extension or MIME
const getFileCategory = (att: Attachment): 'image' | 'pdf' | 'other' => {
  const name = att.fileName?.toLowerCase() || '';
  const type = att.fileType?.toLowerCase() || '';
  if (type.startsWith('image/') || /\.(jpg|jpeg|png|gif|webp|svg|bmp)$/.test(name)) return 'image';
  if (type === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
  return 'other';
};

// ✅ Lightbox modal
const LightboxModal: React.FC<{
  attachment: Attachment;
  category: 'image' | 'pdf';
  onClose: () => void;
}> = ({ attachment, category, onClose }) => (
  <div
    className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
    onClick={onClose}
  >
    <div
      className="relative max-h-[90vh] w-full max-w-5xl overflow-hidden rounded-xl border border-border bg-card shadow-lg"
      onClick={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <span className="text-sm font-medium text-foreground truncate max-w-[70%]" title={attachment.fileName}>
          {truncateFileName(attachment.fileName, 40)}
        </span>
        <div className="flex items-center gap-2">
          <a
            href={attachment.fileUrl}
            download={attachment.fileName}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-[13px] font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            onClick={(e) => e.stopPropagation()}
          >
            <Download className="w-3.5 h-3.5" />
            Download
          </a>
          <button
            onClick={onClose}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex max-h-[80vh] items-center justify-center overflow-auto bg-surface-2">
        {category === 'image' ? (
          <img
            src={attachment.fileUrl}
            alt={attachment.fileName}
            className="max-w-full max-h-[75vh] object-contain"
          />
        ) : (
          <iframe
            src={attachment.fileUrl}
            title={attachment.fileName}
            className="w-full h-[75vh]"
          />
        )}
      </div>
    </div>
  </div>
);

export const AttachmentPreview: React.FC<AttachmentPreviewProps> = ({
  attachments,
  stopPropagation = false,
}) => {
  const [lightbox, setLightbox] = useState<Attachment | null>(null);
  const lightboxCategory = lightbox ? getFileCategory(lightbox) : null;

  const handleClick = (e: React.MouseEvent, att: Attachment, category: string) => {
    if (stopPropagation) e.stopPropagation();
    if (category === 'image' || category === 'pdf') {
      e.preventDefault();
      setLightbox(att);
    }
  };

  return (
    <>
      <div className="flex flex-wrap gap-2 mt-2">
        {attachments.map((att) => {
          const category = getFileCategory(att);

          return category === 'image' ? (
            // ✅ Image — show thumbnail
            <div
              key={att.fileId}
              className="group relative cursor-pointer overflow-hidden rounded-md border border-border transition-colors hover:border-foreground/30"
              style={{ width: 80, height: 80 }}
              onClick={(e) => handleClick(e, att, category)}
              title={att.fileName}
            >
              <img
                src={att.fileUrl}
                alt={att.fileName}
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                <ZoomIn className="w-5 h-5 text-white" />
              </div>
            </div>
          ) : category === 'pdf' ? (
            // ✅ PDF — icon + filename, click opens iframe modal
            <div
              key={att.fileId}
              className="group inline-flex h-8 max-w-[250px] items-center gap-2 rounded-md border border-border bg-background px-2.5 text-[13px] font-medium text-foreground transition-colors hover:bg-secondary cursor-pointer"
              onClick={(e) => handleClick(e, att, category)}
              title={att.fileName}
            >
              <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="max-w-[160px] truncate">
                {truncateFileName(att.fileName, 20)}
              </span>
              <ZoomIn className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100" />
            </div>
          ) : (
            // ✅ Other files — plain download link with truncation
            <a
              key={att.fileId}
              href={att.fileUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => stopPropagation && e.stopPropagation()}
              className="group inline-flex h-8 max-w-[250px] items-center gap-2 rounded-md border border-border bg-background px-2.5 text-[13px] font-medium text-foreground transition-colors hover:bg-secondary"
              title={att.fileName}
            >
              <Paperclip className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="truncate max-w-[180px]">
                {truncateFileName(att.fileName, 25)}
              </span>
            </a>
          );
        })}
      </div>

      {/* Lightbox */}
      {lightbox && (lightboxCategory === 'image' || lightboxCategory === 'pdf') && (
        <LightboxModal
          attachment={lightbox}
          category={lightboxCategory}
          onClose={() => setLightbox(null)}
        />
      )}
    </>
  );
};

export default AttachmentPreview;