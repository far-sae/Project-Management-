import React, { useEffect, useRef, useState } from 'react';
import { format } from 'date-fns';
import {
  Paperclip, Upload, Download, Trash2, Loader2, FileText, Image as ImageIcon, File as FileIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { useAuth } from '@/context/AuthContext';
import {
  listEntityAttachments, uploadAttachment, deleteAttachment,
  getAttachmentSignedUrl, formatBytes,
  type Attachment, type AttachmentEntityType,
} from '@/services/supabase/attachments';
import { cn } from '@/lib/utils';

interface EntityAttachmentsSectionProps {
  organizationId: string | null;
  entityType: AttachmentEntityType;
  entityId: string;
  canManage: boolean;
}

const pickIcon = (mime: string | null) => {
  if (!mime) return FileIcon;
  if (mime.startsWith('image/')) return ImageIcon;
  if (mime === 'application/pdf' || mime.startsWith('text/')) return FileText;
  return FileIcon;
};

/**
 * Drag-and-drop or browse-to-upload section that backs onto the
 * `attachments` table + Storage bucket (migration 116). Renders a
 * scannable list of uploaded files with download / delete buttons.
 *
 * Sized for the per-record drawers (Lead, Contact, etc.); the same
 * component drops cleanly into Account / Deal drawers when those need
 * attachments too — just pass the right entityType/entityId.
 */
export const EntityAttachmentsSection: React.FC<EntityAttachmentsSectionProps> = ({
  organizationId, entityType, entityId, canManage,
}) => {
  const { user } = useAuth();
  const [items, setItems] = useState<Attachment[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const reload = async () => {
    if (!organizationId) { setItems([]); return; }
    setLoading(true);
    try {
      setItems(await listEntityAttachments(organizationId, entityType, entityId));
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [organizationId, entityType, entityId]);

  const handleFiles = async (files: FileList | File[]) => {
    if (!organizationId) return;
    const list = Array.from(files);
    if (list.length === 0) return;
    setUploading(true);
    try {
      for (const file of list) {
        // 25MB ceiling — keep blobs out of the "this is really
        // somebody else's problem" range. Supabase free tier caps at
        // 50MB but the UI/list-view experience falls off well before
        // that, and 25MB still handles PDFs / screenshots fine.
        if (file.size > 25 * 1024 * 1024) {
          toast.error(`${file.name} is over 25 MB — skipped`);
          continue;
        }
        await uploadAttachment({
          organizationId, entityType, entityId, file,
          uploadedBy: user?.userId ?? null,
          uploadedByName: user?.displayName ?? user?.email ?? null,
        });
      }
      toast.success(`Uploaded ${list.length} file${list.length === 1 ? '' : 's'}`);
      await reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleDownload = async (a: Attachment) => {
    try {
      const url = await getAttachmentSignedUrl(a.storagePath, 60);
      // Use an in-page anchor so the browser prompts a download with
      // the right filename instead of navigating away in a new tab.
      const link = document.createElement('a');
      link.href = url;
      link.download = a.fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not generate download link');
    }
  };

  const handleDelete = async (a: Attachment) => {
    if (!window.confirm(`Delete "${a.fileName}"? This can't be undone.`)) return;
    setRemovingId(a.attachmentId);
    try {
      await deleteAttachment(a);
      toast.success('Attachment deleted');
      await reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setRemovingId(null);
    }
  };

  return (
    <div>
      <h3 className="text-sm font-semibold flex items-center justify-between border-b pb-1.5 mb-2">
        <span className="flex items-center gap-2">
          <Paperclip className="w-4 h-4 text-muted-foreground" /> Attachments
          <span className="text-[11px] text-muted-foreground font-normal">
            ({items.length})
          </span>
        </span>
        {canManage && (
          <Button
            type="button" variant="ghost" size="sm" className="h-7 text-xs"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading || !organizationId}
          >
            {uploading
              ? <Loader2 className="w-3 h-3 animate-spin mr-1" />
              : <Upload className="w-3 h-3 mr-1" />}
            Upload
          </Button>
        )}
      </h3>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => e.target.files && handleFiles(e.target.files)}
      />

      {canManage && (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            if (e.dataTransfer.files?.length) void handleFiles(e.dataTransfer.files);
          }}
          className={cn(
            'rounded-md border-2 border-dashed text-center px-3 py-2 mb-2 transition-colors text-[11px] cursor-pointer',
            dragOver
              ? 'border-primary bg-primary/5 text-primary'
              : 'border-border text-muted-foreground hover:border-primary/50',
          )}
          onClick={() => fileInputRef.current?.click()}
        >
          {uploading ? 'Uploading…' : 'Drag files here or click Upload'}
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading…
        </div>
      ) : items.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {canManage ? 'No attachments yet. Drop a file above or click Upload.' : 'No attachments yet.'}
        </p>
      ) : (
        <ul className="space-y-1.5">
          {items.map((a) => {
            const Icon = pickIcon(a.mimeType);
            return (
              <li key={a.attachmentId} className="rounded-md border p-2 flex items-start gap-2 group">
                <Icon className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <button
                    type="button"
                    onClick={() => handleDownload(a)}
                    className="text-sm font-medium truncate hover:underline text-left block w-full"
                    title={`Download ${a.fileName}`}
                  >
                    {a.fileName}
                  </button>
                  <p className="text-[11px] text-muted-foreground">
                    {formatBytes(a.sizeBytes)}
                    {a.uploadedByName && <> · {a.uploadedByName}</>}
                    {' · '}{format(a.createdAt, 'MMM d, yyyy · HH:mm')}
                  </p>
                </div>
                <button
                  type="button" onClick={() => handleDownload(a)}
                  className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground"
                  title="Download"
                >
                  <Download className="w-3.5 h-3.5" />
                </button>
                {canManage && (
                  <button
                    type="button" onClick={() => handleDelete(a)}
                    disabled={removingId === a.attachmentId}
                    className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive"
                    title="Delete"
                  >
                    {removingId === a.attachmentId
                      ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      : <Trash2 className="w-3.5 h-3.5" />}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};
