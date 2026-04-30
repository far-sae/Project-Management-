import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Loader2,
  Paperclip,
  Save,
  Trash2,
  Download,
  CheckSquare,
  Square as SquareIcon,
  Plus,
  X,
  FileText,
  ImageIcon,
  FileAudio,
  Film,
  ExternalLink,
  Eye,
  EyeOff,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  uploadFileWithProgress,
  deleteFileComplete,
  formatFileSize,
} from '@/services/supabase/storage';
import type {
  PlaceholderAttachment,
  PlaceholderSubtask,
} from './ProjectMindMap';
import { cn } from '@/lib/utils';
import { logger } from '@/lib/logger';

interface PlaceholderForPanel {
  id: string;
  label: string;
  description?: string;
  subtasks?: PlaceholderSubtask[];
  attachments?: PlaceholderAttachment[];
}

interface MindMapPlaceholderPanelProps {
  open: boolean;
  placeholder: PlaceholderForPanel | null;
  organizationId: string;
  projectId: string;
  userId: string;
  userDisplayName: string;
  onOpenChange: (open: boolean) => void;
  /** Called with a partial patch when the user hits Save or completes a
   *  side-effecting action (file upload, file delete). The parent merges
   *  the patch into the placeholder's persisted record (extras.ideas). */
  onPatch: (patch: {
    label?: string;
    description?: string;
    subtasks?: PlaceholderSubtask[];
    attachments?: PlaceholderAttachment[];
  }) => Promise<void>;
}

// ─────────────────────────────────────────────────────────────
// File previews — switch on file MIME type. We render small inline
// previews where the file format supports it, and fall back to a
// "no preview" tile for everything else (still downloadable).
// ─────────────────────────────────────────────────────────────

function classifyFile(fileType: string, fileName: string): {
  category: 'image' | 'video' | 'audio' | 'pdf' | 'office' | 'other';
  icon: React.ReactNode;
} {
  const t = (fileType || '').toLowerCase();
  const n = (fileName || '').toLowerCase();
  if (t.startsWith('image/') || /\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(n)) {
    return { category: 'image', icon: <ImageIcon className="w-3.5 h-3.5" /> };
  }
  if (t.startsWith('video/') || /\.(mp4|webm|mov|avi|mkv)$/i.test(n)) {
    return { category: 'video', icon: <Film className="w-3.5 h-3.5" /> };
  }
  if (t.startsWith('audio/') || /\.(mp3|wav|ogg|m4a|aac|flac)$/i.test(n)) {
    return { category: 'audio', icon: <FileAudio className="w-3.5 h-3.5" /> };
  }
  if (t === 'application/pdf' || /\.pdf$/i.test(n)) {
    return { category: 'pdf', icon: <FileText className="w-3.5 h-3.5" /> };
  }
  if (
    /\.(docx?|xlsx?|pptx?|odt|ods|odp)$/i.test(n) ||
    t.includes('officedocument') ||
    t.includes('msword') ||
    t.includes('powerpoint') ||
    t.includes('excel')
  ) {
    return { category: 'office', icon: <FileText className="w-3.5 h-3.5" /> };
  }
  return { category: 'other', icon: <FileText className="w-3.5 h-3.5" /> };
}

const FilePreview: React.FC<{ file: PlaceholderAttachment }> = ({ file }) => {
  const { category } = classifyFile(file.fileType, file.fileName);

  if (category === 'image') {
    return (
      <a
        href={file.fileUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="block rounded-md overflow-hidden border border-border bg-black/40"
      >
        <img
          src={file.fileUrl}
          alt={file.fileName}
          className="max-h-56 w-full object-contain"
          loading="lazy"
        />
      </a>
    );
  }
  if (category === 'video') {
    return (
      <video
        controls
        preload="metadata"
        className="max-h-56 w-full rounded-md border border-border bg-black"
      >
        <source src={file.fileUrl} type={file.fileType || undefined} />
      </video>
    );
  }
  if (category === 'audio') {
    return (
      <audio
        controls
        preload="none"
        className="w-full"
      >
        <source src={file.fileUrl} type={file.fileType || undefined} />
      </audio>
    );
  }
  if (category === 'pdf') {
    return (
      <iframe
        src={file.fileUrl}
        title={file.fileName}
        className="w-full h-72 rounded-md border border-border bg-black"
        // sandbox keeps the embedded PDF from interacting with the host
        // page beyond reading itself; same-origin lets the supabase URL
        // load when CORS is configured.
        sandbox="allow-scripts allow-same-origin"
      />
    );
  }
  if (category === 'office') {
    // Office docs can't be embedded with Supabase storage URLs (no
    // viewer headers). Surface a "Open" affordance and rely on the
    // operating system / Office Online to handle the link.
    return (
      <a
        href={file.fileUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center justify-center gap-2 w-full h-20 rounded-md border border-dashed border-border bg-muted/40 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <ExternalLink className="w-4 h-4" />
        Open document
      </a>
    );
  }
  return (
    <a
      href={file.fileUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center justify-center gap-2 w-full h-16 rounded-md border border-dashed border-border bg-muted/40 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
    >
      <FileText className="w-4 h-4" />
      No inline preview — click to open
    </a>
  );
};

// ─────────────────────────────────────────────────────────────
// Panel
// ─────────────────────────────────────────────────────────────

export const MindMapPlaceholderPanel: React.FC<MindMapPlaceholderPanelProps> = ({
  open,
  placeholder,
  organizationId,
  projectId,
  userId,
  userDisplayName,
  onOpenChange,
  onPatch,
}) => {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [subtasks, setSubtasks] = useState<PlaceholderSubtask[]>([]);
  const [attachments, setAttachments] = useState<PlaceholderAttachment[]>([]);
  const [newSubtaskTitle, setNewSubtaskTitle] = useState('');
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [previewVisible, setPreviewVisible] = useState<Record<string, boolean>>({});
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Reset form whenever a different placeholder opens. We track by id so
  // selecting the same placeholder twice doesn't blow away unsaved edits.
  useEffect(() => {
    if (!placeholder) return;
    setTitle(placeholder.label);
    setDescription(placeholder.description ?? '');
    setSubtasks(placeholder.subtasks ?? []);
    setAttachments(placeholder.attachments ?? []);
    // Default-open the preview for image/pdf so the user sees the file
    // immediately. Heavier types (video/audio) only mount on click.
    const auto: Record<string, boolean> = {};
    for (const a of placeholder.attachments ?? []) {
      const cat = classifyFile(a.fileType, a.fileName).category;
      if (cat === 'image' || cat === 'pdf') auto[a.fileId] = true;
    }
    setPreviewVisible(auto);
  }, [placeholder?.id]);

  // Esc closes + body-scroll lock while open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onOpenChange(false);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onOpenChange]);

  const dirty = useMemo(() => {
    if (!placeholder) return false;
    if (title !== placeholder.label) return true;
    if ((description || '') !== (placeholder.description ?? '')) return true;
    const a = JSON.stringify(subtasks);
    const b = JSON.stringify(placeholder.subtasks ?? []);
    return a !== b;
  }, [placeholder, title, description, subtasks]);

  const handleSave = async () => {
    if (!placeholder || !dirty) return;
    setSaving(true);
    try {
      await onPatch({
        label: title.trim() || placeholder.label,
        description,
        subtasks,
      });
      toast.success('Saved');
    } catch (err: unknown) {
      logger.error('[MindMapPlaceholderPanel] save failed', {
        operation: 'handleSave',
        placeholderId: placeholder.id,
        projectId,
        err,
      });
      toast.error('Could not save — try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleSubtask = (id: string) => {
    setSubtasks((cur) =>
      cur.map((s) => (s.id === id ? { ...s, completed: !s.completed } : s)),
    );
  };

  const handleAddSubtask = () => {
    const t = newSubtaskTitle.trim();
    if (!t) return;
    setSubtasks((cur) => [
      ...cur,
      { id: crypto.randomUUID(), title: t, completed: false },
    ]);
    setNewSubtaskTitle('');
  };

  const handleRemoveSubtask = (id: string) => {
    setSubtasks((cur) => cur.filter((s) => s.id !== id));
  };

  const handleFilesPicked = async (picked: FileList | null) => {
    if (!picked || picked.length === 0 || !placeholder) return;
    if (!organizationId || !userId) {
      toast.error('Storage isn’t configured for this workspace.');
      return;
    }
    setUploading(true);
    const list = Array.from(picked);
    const toastId = toast.loading(
      list.length === 1 ? `Uploading ${list[0].name}…` : `Uploading ${list.length} files…`,
    );
    let success = 0;
    let failed = 0;
    const newRows: PlaceholderAttachment[] = [];
    try {
      for (const file of list) {
        try {
          const row = await uploadFileWithProgress(
            userId,
            userDisplayName || 'User',
            organizationId,
            { projectId, file, scope: 'project' },
          );
          const att: PlaceholderAttachment = {
            fileId: row.fileId,
            fileName: row.fileName,
            fileUrl: row.fileUrl,
            fileType: row.fileType,
            fileSize: row.fileSize,
            storagePath: row.storagePath,
            uploadedAt:
              row.uploadedAt instanceof Date
                ? row.uploadedAt.toISOString()
                : new Date().toISOString(),
          };
          newRows.push(att);
          success += 1;
        } catch (err: unknown) {
          logger.error(
            '[MindMapPlaceholderPanel] placeholder attachment upload failed',
            {
              operation: 'uploadFileWithProgress',
              placeholderId: placeholder.id,
              projectId,
              fileName: file.name,
              err,
            },
          );
          failed += 1;
        }
      }
      if (success > 0) {
        const merged = [...newRows, ...attachments];
        setAttachments(merged);
        await onPatch({ attachments: merged });
        // Auto-show preview for new image/pdf entries.
        setPreviewVisible((prev) => {
          const next = { ...prev };
          for (const r of newRows) {
            const cat = classifyFile(r.fileType, r.fileName).category;
            if (cat === 'image' || cat === 'pdf') next[r.fileId] = true;
          }
          return next;
        });
      }
      if (failed === 0) {
        toast.success(success === 1 ? 'File attached' : `${success} files attached`, { id: toastId });
      } else if (success === 0) {
        toast.error('Upload failed. Check your connection and try again.', { id: toastId });
      } else {
        toast.warning(`Attached ${success}, ${failed} failed`, { id: toastId });
      }
    } catch (err: unknown) {
      logger.error('[MindMapPlaceholderPanel] onPatch or post-upload step failed', {
        operation: 'onPatch',
        placeholderId: placeholder.id,
        projectId,
        err,
      });
      toast.error('Could not save attachments to the mind map.', { id: toastId });
    } finally {
      setUploading(false);
    }
  };

  const handleDownload = async (file: PlaceholderAttachment) => {
    try {
      const res = await fetch(file.fileUrl, { mode: 'cors' });
      if (!res.ok) throw new Error(`fetch ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = file.fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      window.open(file.fileUrl, '_blank');
    }
  };

  const handleDeleteFile = async (file: PlaceholderAttachment) => {
    if (!window.confirm(`Delete "${file.fileName}"? This can't be undone.`)) return;
    try {
      await deleteFileComplete(file.fileId, organizationId);
      const next = attachments.filter((f) => f.fileId !== file.fileId);
      setAttachments(next);
      await onPatch({ attachments: next });
      toast.success('File deleted');
    } catch {
      toast.error('Could not delete the file.');
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[260]" role="dialog" aria-modal="true">
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-[1px] animate-in fade-in duration-150"
        onClick={() => onOpenChange(false)}
        aria-hidden="true"
      />
      <aside className="absolute right-0 top-0 bottom-0 w-full sm:max-w-lg bg-card border-l border-border shadow-2xl flex flex-col gap-0 animate-in slide-in-from-right-2 duration-200">
        <div className="px-5 py-4 border-b border-border flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-foreground">Task details</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Edit notes, subtasks, and attach files. Mind-map only — kanban is never changed.
            </p>
          </div>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="p-1.5 rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {!placeholder ? (
          <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
            Select a task to open
          </div>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
              {/* Title */}
              <div>
                <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1 block">
                  Title
                </label>
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Task title"
                  className="text-sm"
                />
              </div>

              {/* Notes */}
              <div>
                <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1 block">
                  Notes
                </label>
                <Textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={6}
                  placeholder="Write notes, context, anything you want attached to this task…"
                  className="text-sm resize-y"
                />
              </div>

              {/* Subtasks */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Subtasks
                  </label>
                  <span className="text-[11px] text-muted-foreground tabular-nums">
                    {subtasks.filter((s) => s.completed).length}/{subtasks.length}
                  </span>
                </div>
                <div className="space-y-1">
                  {subtasks.map((s) => (
                    <div
                      key={s.id}
                      className="group flex items-center gap-2 rounded-md px-2 py-1 hover:bg-secondary/50"
                    >
                      <button
                        type="button"
                        onClick={() => handleToggleSubtask(s.id)}
                        className="shrink-0 text-muted-foreground hover:text-foreground"
                        aria-label={s.completed ? 'Mark incomplete' : 'Mark complete'}
                      >
                        {s.completed ? (
                          <CheckSquare className="w-4 h-4 text-emerald-500" />
                        ) : (
                          <SquareIcon className="w-4 h-4" />
                        )}
                      </button>
                      <span
                        className={cn(
                          'flex-1 text-sm',
                          s.completed && 'line-through text-muted-foreground',
                        )}
                      >
                        {s.title}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleRemoveSubtask(s.id)}
                        className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive p-1"
                        aria-label="Remove subtask"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                  <div className="flex items-center gap-2 pt-1">
                    <Input
                      value={newSubtaskTitle}
                      onChange={(e) => setNewSubtaskTitle(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleAddSubtask();
                        }
                      }}
                      placeholder="Add a subtask"
                      className="h-8 text-sm"
                    />
                    <Button
                      type="button"
                      size="sm"
                      onClick={handleAddSubtask}
                      disabled={!newSubtaskTitle.trim()}
                      className="h-8 gap-1.5"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Add
                    </Button>
                  </div>
                </div>
              </div>

              {/* Attachments */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Attachments
                  </label>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                    className="h-7 gap-1.5"
                  >
                    {uploading ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Paperclip className="w-3.5 h-3.5" />
                    )}
                    Attach files
                  </Button>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    void handleFilesPicked(e.target.files);
                    e.target.value = '';
                  }}
                />
                {attachments.length === 0 ? (
                  <p className="text-xs text-muted-foreground py-2">
                    No attachments yet — any file type is accepted (image, PDF, video, doc, etc.).
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {attachments.map((f) => {
                      const { category, icon } = classifyFile(f.fileType, f.fileName);
                      const showPreview = previewVisible[f.fileId] ?? false;
                      const previewable = category !== 'other';
                      return (
                        <li
                          key={f.fileId}
                          className="rounded-md border border-border bg-card overflow-hidden"
                        >
                          <div className="group flex items-center gap-2 px-2 py-1.5">
                            <span className="text-muted-foreground shrink-0">{icon}</span>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-foreground truncate" title={f.fileName}>
                                {f.fileName}
                              </p>
                              <p className="text-[11px] text-muted-foreground">
                                {formatFileSize(f.fileSize)}
                                {' · '}
                                {category === 'other' ? f.fileType || 'file' : category}
                              </p>
                            </div>
                            {previewable && (
                              <button
                                type="button"
                                onClick={() =>
                                  setPreviewVisible((prev) => ({
                                    ...prev,
                                    [f.fileId]: !showPreview,
                                  }))
                                }
                                title={showPreview ? 'Hide preview' : 'Show preview'}
                                aria-label={showPreview ? 'Hide preview' : 'Show preview'}
                                className="text-muted-foreground hover:text-foreground p-1 rounded"
                              >
                                {showPreview ? (
                                  <EyeOff className="w-3.5 h-3.5" />
                                ) : (
                                  <Eye className="w-3.5 h-3.5" />
                                )}
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => void handleDownload(f)}
                              title="Download"
                              aria-label="Download"
                              className="text-muted-foreground hover:text-foreground p-1 rounded"
                            >
                              <Download className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleDeleteFile(f)}
                              title="Delete"
                              aria-label="Delete"
                              className="text-muted-foreground hover:text-destructive p-1 rounded"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                          {showPreview && previewable && (
                            <div className="px-2 pb-2">
                              <FilePreview file={f} />
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </div>

            <div className="border-t border-border px-5 py-3 flex items-center justify-between gap-2">
              <p className="text-[11px] text-muted-foreground">
                {dirty ? 'Unsaved changes' : 'Up to date'}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => onOpenChange(false)}
                >
                  Close
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => void handleSave()}
                  disabled={!dirty || saving}
                  className="gap-1.5"
                >
                  {saving ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Save className="w-3.5 h-3.5" />
                  )}
                  Save
                </Button>
              </div>
            </div>
          </>
        )}
      </aside>
    </div>
  );
};

export default MindMapPlaceholderPanel;
