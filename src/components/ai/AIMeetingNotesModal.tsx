import React, { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  FileText,
  Loader2,
  Sparkles,
  Calendar,
  Flag,
  Users,
  Tag,
  Check,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  ListTree,
} from 'lucide-react';
import {
  extractTasksFromNotes,
  isAIEnabled,
  type ExtractedTaskDraft,
  type QuickAddContext,
  type AIError,
} from '@/services/ai';
import type { CreateTaskInput, TaskAssignee, TaskSubtask } from '@/types';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { parseIsoCalendarDate } from '@/lib/isoDueDate';

interface MemberLite {
  userId: string;
  displayName: string;
  email?: string;
  photoURL?: string;
}

interface AIMeetingNotesModalProps {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  currentUserId: string;
  projectId: string;
  projectName: string;
  defaultStatus: string;
  columns: Array<{ id: string; title: string }>;
  members: MemberLite[];
  onCreate: (input: CreateTaskInput) => Promise<unknown>;
}

export const AIMeetingNotesModal: React.FC<AIMeetingNotesModalProps> = ({
  open,
  onOpenChange,
  currentUserId,
  projectId,
  projectName,
  defaultStatus,
  columns,
  members,
  onCreate,
}) => {
  const aiAvailable = isAIEnabled();
  const [notes, setNotes] = useState('');
  const [parsing, setParsing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [drafts, setDrafts] = useState<ExtractedTaskDraft[]>([]);
  const [selected, setSelected] = useState<Record<number, boolean>>({});
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [createdCount, setCreatedCount] = useState<number | null>(null);

  useEffect(() => {
    if (open) {
      setNotes('');
      setDrafts([]);
      setSelected({});
      setExpanded({});
      setError(null);
      setCreatedCount(null);
    }
  }, [open]);

  const memberById = new Map(members.map((m) => [m.userId, m]));

  const ctx: QuickAddContext = {
    today: format(new Date(), 'yyyy-MM-dd'),
    projectName,
    availableStatuses: columns.map((c) => ({ id: c.id, title: c.title })),
    members: members.map((m) => ({
      userId: m.userId,
      displayName: m.displayName,
      email: m.email,
    })),
  };

  const selectedCount = drafts.filter((_, idx) => selected[idx]).length;

  const handleParse = async () => {
    if (!notes.trim() || parsing) return;
    setParsing(true);
    setError(null);
    setDrafts([]);
    setSelected({});
    setCreatedCount(null);
    try {
      const { tasks } = await extractTasksFromNotes(currentUserId, notes, ctx);
      setDrafts(tasks);
      // Default-select all extracted tasks.
      const sel: Record<number, boolean> = {};
      tasks.forEach((_, idx) => (sel[idx] = true));
      setSelected(sel);
    } catch (err) {
      const aiErr = err as AIError;
      setError(aiErr.message || 'Could not extract tasks from those notes.');
    } finally {
      setParsing(false);
    }
  };

  const draftToInput = (d: ExtractedTaskDraft): CreateTaskInput => {
    const assignees: TaskAssignee[] = d.assigneeUserIds
      .map((id) => memberById.get(id))
      .filter((m): m is MemberLite => Boolean(m))
      .map((m) => ({
        userId: m.userId,
        displayName: m.displayName,
        email: m.email,
        photoURL: m.photoURL,
      }));
    const status =
      d.status && columns.some((c) => c.id === d.status) ? d.status : defaultStatus;
    const due = parseIsoCalendarDate(d.dueDate ?? null);
    const subtasks: TaskSubtask[] = d.subtasks.map((s) => ({
      id: crypto.randomUUID(),
      title: s.title,
      completed: false,
    }));
    return {
      projectId,
      title: d.title,
      description: d.description || '',
      priority: d.priority || 'medium',
      status,
      dueDate: due,
      assignees,
      tags: d.tags,
      subtasks,
      projectName,
    };
  };

  const handleCreateAll = async () => {
    const chosen = drafts.filter((_, idx) => selected[idx]);
    if (!chosen.length) return;
    setCreating(true);
    setError(null);
    let success = 0;
    try {
      for (const d of chosen) {
        try {
          await onCreate(draftToInput(d));
          success += 1;
        } catch (err) {
          // Continue creating the rest, but record the first failure to show the user.
          if (!error) {
            setError(
              err instanceof Error
                ? err.message
                : 'Some tasks could not be created.',
            );
          }
        }
      }
      setCreatedCount(success);
      if (success === chosen.length) {
        setTimeout(() => onOpenChange(false), 800);
      }
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-[760px] max-h-[88vh] flex flex-col"
        aria-describedby={undefined}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="w-7 h-7 rounded-lg bg-blue-500/10 ring-1 ring-blue-500/30 text-blue-500 flex items-center justify-center">
              <FileText className="w-3.5 h-3.5" />
            </span>
            Extract tasks from notes
          </DialogTitle>
          <DialogDescription>
            Paste a meeting transcript, raw notes, or a brief. AI will pull out concrete action
            items — review, deselect, then create them in one shot.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-3 -mx-1 px-1">
          {drafts.length === 0 && (
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={`Paste meeting notes here. Example:\n\nBob will own the launch checklist by Friday.\nQA needs to retest dashboard performance — high priority, this week.\nWe agreed to push the marketing email to next Wednesday.`}
              rows={10}
              disabled={!aiAvailable || parsing}
              className="text-sm font-mono leading-relaxed resize-none"
            />
          )}

          {!aiAvailable && (
            <div className="flex items-start gap-2 text-xs rounded-md border border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300 px-3 py-2">
              <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span>
                AI is not configured. Deploy the <code>ai-chat</code> Supabase function to use
                this feature.
              </span>
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 text-xs rounded-md border border-destructive/40 bg-destructive/10 text-destructive px-3 py-2">
              <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {parsing && (
            <div className="space-y-2 mt-2">
              <div className="h-3 rounded bg-muted/70 animate-pulse w-2/3" />
              <div className="h-3 rounded bg-muted/70 animate-pulse w-1/2" />
              <div className="h-3 rounded bg-muted/70 animate-pulse w-3/4" />
            </div>
          )}

          {drafts.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">
                  Found <span className="font-medium text-foreground">{drafts.length}</span>{' '}
                  task{drafts.length === 1 ? '' : 's'}.{' '}
                  <span className="font-medium text-foreground">{selectedCount}</span> selected.
                </p>
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      const next: Record<number, boolean> = {};
                      drafts.forEach((_, i) => (next[i] = true));
                      setSelected(next);
                    }}
                    className="text-[11px] text-violet-600 dark:text-violet-300 hover:underline"
                  >
                    Select all
                  </button>
                  <span className="text-muted-foreground">·</span>
                  <button
                    type="button"
                    onClick={() => setSelected({})}
                    className="text-[11px] text-muted-foreground hover:text-foreground hover:underline"
                  >
                    Clear
                  </button>
                </div>
              </div>
              <ul className="space-y-2">
                {drafts.map((d, idx) => {
                  const dueValid = parseIsoCalendarDate(d.dueDate ?? null);
                  const isSelected = !!selected[idx];
                  const isExpanded = !!expanded[idx];
                  return (
                    <li
                      key={`${d.title}-${idx}`}
                      className={cn(
                        'rounded-lg border bg-card transition-colors',
                        isSelected ? 'border-violet-500/40' : 'border-border/70',
                      )}
                    >
                      <div className="flex items-start gap-3 p-3">
                        <button
                          type="button"
                          onClick={() =>
                            setSelected((s) => ({ ...s, [idx]: !s[idx] }))
                          }
                          className={cn(
                            'mt-0.5 w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors',
                            isSelected
                              ? 'bg-violet-500 border-violet-500 text-white'
                              : 'border-border bg-background',
                          )}
                          aria-label={isSelected ? 'Deselect task' : 'Select task'}
                        >
                          {isSelected && <Check className="w-3 h-3" strokeWidth={3} />}
                        </button>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold leading-snug">{d.title}</p>
                          {d.description && (
                            <p className="text-xs text-muted-foreground leading-relaxed mt-0.5">
                              {d.description}
                            </p>
                          )}
                          <div className="flex flex-wrap items-center gap-1.5 mt-2">
                            {d.priority && (
                              <span
                                className={cn(
                                  'inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium',
                                  d.priority === 'high'
                                    ? 'bg-red-500/15 text-red-600 dark:text-red-300'
                                    : d.priority === 'low'
                                      ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300'
                                      : 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
                                )}
                              >
                                <Flag className="w-2.5 h-2.5" />
                                {d.priority}
                              </span>
                            )}
                            {dueValid && (
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-blue-500/15 text-blue-600 dark:text-blue-300">
                                <Calendar className="w-2.5 h-2.5" />
                                {format(dueValid, 'MMM d')}
                              </span>
                            )}
                            {d.assigneeUserIds.length > 0 && (
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-violet-500/15 text-violet-600 dark:text-violet-300">
                                <Users className="w-2.5 h-2.5" />
                                {d.assigneeUserIds
                                  .map((id) => memberById.get(id)?.displayName || '?')
                                  .join(', ')}
                              </span>
                            )}
                            {d.tags.map((t) => (
                              <span
                                key={t}
                                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-muted text-foreground"
                              >
                                <Tag className="w-2.5 h-2.5" />
                                {t}
                              </span>
                            ))}
                            {d.subtasks.length > 0 && (
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-secondary text-secondary-foreground">
                                <ListTree className="w-2.5 h-2.5" />
                                {d.subtasks.length} subtask{d.subtasks.length === 1 ? '' : 's'}
                              </span>
                            )}
                          </div>
                          {d.rationale && (
                            <p className="text-[11px] text-muted-foreground italic mt-1.5">
                              {d.rationale}
                            </p>
                          )}
                          {d.subtasks.length > 0 && (
                            <button
                              type="button"
                              onClick={() => setExpanded((e) => ({ ...e, [idx]: !e[idx] }))}
                              className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                            >
                              {isExpanded ? (
                                <>
                                  <ChevronUp className="w-3 h-3" /> Hide subtasks
                                </>
                              ) : (
                                <>
                                  <ChevronDown className="w-3 h-3" /> Show subtasks
                                </>
                              )}
                            </button>
                          )}
                          {isExpanded && d.subtasks.length > 0 && (
                            <ul className="mt-1.5 space-y-1 pl-3 border-l border-border/60">
                              {d.subtasks.map((s, j) => (
                                <li key={j} className="text-xs text-muted-foreground">
                                  · {s.title}
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {createdCount !== null && createdCount > 0 && (
            <div className="flex items-start gap-2 text-xs rounded-md border border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 px-3 py-2">
              <Check className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span>
                Created {createdCount} task{createdCount === 1 ? '' : 's'} on the board.
              </span>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={creating || parsing}
          >
            Close
          </Button>
          {drafts.length === 0 ? (
            <Button
              onClick={() => void handleParse()}
              disabled={!aiAvailable || parsing || notes.trim().length < 30}
              className="bg-gradient-to-r from-blue-500 to-violet-500 text-white border-0 hover:opacity-90"
            >
              {parsing ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Extracting
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4 mr-2" />
                  Extract tasks
                </>
              )}
            </Button>
          ) : (
            <>
              <Button
                variant="outline"
                onClick={() => {
                  setDrafts([]);
                  setSelected({});
                  setCreatedCount(null);
                }}
                disabled={creating}
              >
                Edit notes
              </Button>
              <Button
                onClick={() => void handleCreateAll()}
                disabled={creating || selectedCount === 0}
              >
                {creating ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Creating
                  </>
                ) : (
                  `Create ${selectedCount} task${selectedCount === 1 ? '' : 's'}`
                )}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default AIMeetingNotesModal;
