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
} from 'lucide-react';
import { toast } from 'sonner';
import { updateTask } from '@/services/supabase/database';
import {
  uploadFileWithProgress,
  getProjectFiles,
  deleteFileComplete,
  formatFileSize,
} from '@/services/supabase/storage';
import type { Task, TaskSubtask } from '@/types';
import type { ProjectFile } from '@/types/file';
import { cn } from '@/lib/utils';

interface MindMapTaskPanelProps {
  open: boolean;
  task: Task | null;
  organizationId: string;
  userId: string;
  userDisplayName: string;
  onOpenChange: (open: boolean) => void;
  /** Bumped after a save so callers can refresh their task list. */
  onTaskUpdated?: () => void;
  /** Bumped after attachments change so the mind map can update its 📎 badges. */
  onAttachmentsChanged?: (taskId: string, delta: number) => void;
}

/** Side drawer that lets you edit a task right inside the mind map — no
 *  navigation away. Focused on the things the user said they want from this
 *  surface: title, description (notes), subtasks, file attachments. The full
 *  kanban TaskModal stays the source of truth for advanced fields like
 *  assignees, priority, locking — but those still update fine via the kanban
 *  view. This panel is the inline alternative for "open it without leaving". */
export const MindMapTaskPanel: React.FC<MindMapTaskPanelProps> = ({
  open,
  task,
  organizationId,
  userId,
  userDisplayName,
  onOpenChange,
  onTaskUpdated,
  onAttachmentsChanged,
}) => {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [subtasks, setSubtasks] = useState<TaskSubtask[]>([]);
  const [newSubtaskTitle, setNewSubtaskTitle] = useState('');
  const [saving, setSaving] = useState(false);

  const [files, setFiles] = useState<ProjectFile[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Reset local form state every time a different task is loaded, otherwise
  // edits from one task can leak into the next.
  useEffect(() => {
    if (!task) return;
    setTitle(task.title);
    setDescription(task.description ?? '');
    setSubtasks(task.subtasks ?? []);
  }, [task?.taskId]);

  // Pull existing attachments for this task on open.
  useEffect(() => {
    if (!open || !task || !organizationId) {
      setFiles([]);
      return;
    }
    let cancelled = false;
    setFilesLoading(true);
    void getProjectFiles(task.projectId, organizationId, 'project')
      .then((all) => {
        if (cancelled) return;
        setFiles(all.filter((f) => f.taskId === task.taskId));
      })
      .finally(() => {
        if (!cancelled) setFilesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, task?.taskId, task?.projectId, organizationId]);

  const dirty = useMemo(() => {
    if (!task) return false;
    if (title !== task.title) return true;
    if ((description || '') !== (task.description ?? '')) return true;
    const a = JSON.stringify(subtasks);
    const b = JSON.stringify(task.subtasks ?? []);
    return a !== b;
  }, [task, title, description, subtasks]);

  const handleSave = async () => {
    if (!task || !dirty) return;
    setSaving(true);
    try {
      await updateTask(
        task.taskId,
        {
          title: title.trim() || task.title,
          description,
          subtasks,
        },
        organizationId,
      );
      toast.success('Task saved');
      onTaskUpdated?.();
    } catch (err) {
      toast.error('Could not save task — try again.');
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
    const title = newSubtaskTitle.trim();
    if (!title) return;
    setSubtasks((cur) => [
      ...cur,
      { id: crypto.randomUUID(), title, completed: false },
    ]);
    setNewSubtaskTitle('');
  };

  const handleRemoveSubtask = (id: string) => {
    setSubtasks((cur) => cur.filter((s) => s.id !== id));
  };

  const handleAttachClick = () => fileInputRef.current?.click();

  const handleFilePicked = async (picked: FileList | null) => {
    if (!picked || picked.length === 0 || !task) return;
    if (!organizationId) {
      toast.error('Workspace storage isn’t configured for this project.');
      return;
    }
    setUploading(true);
    const list = Array.from(picked);
    const toastId = toast.loading(
      list.length === 1 ? `Uploading ${list[0].name}…` : `Uploading ${list.length} files…`,
    );
    let success = 0;
    let failed = 0;
    const newRows: ProjectFile[] = [];
    for (const file of list) {
      try {
        const row = await uploadFileWithProgress(
          userId,
          userDisplayName || 'User',
          organizationId,
          { projectId: task.projectId, taskId: task.taskId, file, scope: 'task' },
        );
        newRows.push(row);
        success += 1;
      } catch {
        failed += 1;
      }
    }
    if (success > 0) {
      setFiles((cur) => [...newRows, ...cur]);
      onAttachmentsChanged?.(task.taskId, success);
    }
    setUploading(false);
    if (failed === 0) {
      toast.success(success === 1 ? 'File attached' : `${success} files attached`, { id: toastId });
    } else if (success === 0) {
      toast.error('Upload failed. Check your connection and try again.', { id: toastId });
    } else {
      toast.warning(`Attached ${success}, ${failed} failed`, { id: toastId });
    }
  };

  const handleDownload = async (file: ProjectFile) => {
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

  const handleDeleteFile = async (file: ProjectFile) => {
    if (!task) return;
    if (!window.confirm(`Delete "${file.fileName}"? This can't be undone.`)) return;
    try {
      await deleteFileComplete(file.fileId, organizationId);
      setFiles((cur) => cur.filter((f) => f.fileId !== file.fileId));
      onAttachmentsChanged?.(task.taskId, -1);
      toast.success('File deleted');
    } catch {
      toast.error('Could not delete the file.');
    }
  };

  // Lock body scroll while open and close on Escape so the drawer behaves like
  // a proper modal without depending on a Sheet primitive.
  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onOpenChange(false);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onOpenChange]);

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
              Edit notes, subtasks, and attach files without leaving the mind map.
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

        {!task ? (
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

              {/* Description / notes */}
              <div>
                <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1 block">
                  Notes
                </label>
                <Textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={6}
                  placeholder="Write notes, context, or anything you want attached to this task…"
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
                    onClick={handleAttachClick}
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
                    void handleFilePicked(e.target.files);
                    e.target.value = '';
                  }}
                />
                {filesLoading ? (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Loading attachments…
                  </div>
                ) : files.length === 0 ? (
                  <p className="text-xs text-muted-foreground py-2">
                    No attachments yet — any file type is accepted.
                  </p>
                ) : (
                  <ul className="space-y-1">
                    {files.map((f) => (
                      <li
                        key={f.fileId}
                        className="group flex items-center gap-2 rounded-md border border-border bg-card px-2 py-1.5"
                      >
                        <Paperclip className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-foreground truncate" title={f.fileName}>
                            {f.fileName}
                          </p>
                          <p className="text-[11px] text-muted-foreground">
                            {formatFileSize(f.fileSize)}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => void handleDownload(f)}
                          title="Download"
                          aria-label="Download"
                          className="text-muted-foreground hover:text-foreground p-1 rounded opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
                        >
                          <Download className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDeleteFile(f)}
                          title="Delete"
                          aria-label="Delete"
                          className="text-muted-foreground hover:text-destructive p-1 rounded opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            {/* Footer */}
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

export default MindMapTaskPanel;
