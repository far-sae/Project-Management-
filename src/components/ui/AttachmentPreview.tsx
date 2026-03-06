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
    className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
    onClick={onClose}
  >
    <div
      className="relative max-w-5xl w-full max-h-[90vh] bg-white rounded-lg overflow-hidden shadow-2xl"
      onClick={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b bg-gray-50">
        <span className="text-sm font-medium text-gray-700 truncate max-w-[70%]" title={attachment.fileName}>
          {truncateFileName(attachment.fileName, 40)}
        </span>
        <div className="flex items-center gap-2">
          <a
            href={attachment.fileUrl}
            download={attachment.fileName}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 px-3 py-1.5 text-xs bg-blue-600 text-white rounded hover:bg-blue-700"
            onClick={(e) => e.stopPropagation()}
          >
            <Download className="w-3.5 h-3.5" />
            Download
          </a>
          <button
            onClick={onClose}
            className="p-1.5 rounded hover:bg-gray-200 text-gray-600"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="overflow-auto max-h-[80vh] flex items-center justify-center bg-gray-100">
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
              className="relative group cursor-pointer rounded-md overflow-hidden border border-gray-200 hover:border-blue-400 transition-colors"
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
              className="flex items-center gap-2 px-3 py-2 bg-red-50 hover:bg-red-100 border border-red-200 rounded-md cursor-pointer transition-colors group max-w-[250px]"
              onClick={(e) => handleClick(e, att, category)}
              title={att.fileName}
            >
              <FileText className="w-4 h-4 text-red-500 shrink-0" />
              <span className="text-sm text-red-700 truncate max-w-[160px]">
                {truncateFileName(att.fileName, 20)}
              </span>
              <ZoomIn className="w-3.5 h-3.5 text-red-400 opacity-0 group-hover:opacity-100 shrink-0" />
            </div>
          ) : (
            // ✅ Other files — plain download link with truncation
            <a
              key={att.fileId}
              href={att.fileUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => stopPropagation && e.stopPropagation()}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-gray-100 hover:bg-gray-200 text-sm text-blue-600 hover:text-blue-800 border border-gray-200 max-w-[250px] group"
              title={att.fileName}
            >
              <Paperclip className="w-3.5 h-3.5 shrink-0" />
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