import React, { useEffect, useRef, useState } from 'react';
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
  Sparkles,
  Loader2,
  Wand2,
  Calendar,
  Flag,
  Users,
  Tag,
  Info,
  AlertCircle,
} from 'lucide-react';
import {
  parseTaskFromText,
  isAIEnabled,
  type ParsedQuickAdd,
  type QuickAddContext,
  type AIError,
} from '@/services/ai';
import type { CreateTaskInput, TaskAssignee } from '@/types';
import { format } from 'date-fns';
import { parseIsoCalendarDate } from '@/lib/isoDueDate';

interface MemberLite {
  userId: string;
  displayName: string;
  email?: string;
  photoURL?: string;
}

interface AIQuickAddModalProps {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  /** Current user — used for AI rate limiting. */
  currentUserId: string;
  projectId: string;
  projectName: string;
  /** Default status to drop into when the model doesn't infer one. */
  defaultStatus: string;
  columns: Array<{ id: string; title: string }>;
  members: MemberLite[];
  /** Mirrors KanbanBoard.addTask. */
  onCreate: (input: CreateTaskInput) => Promise<unknown>;
}

const PROMPT_EXAMPLES = [
  'Fix login redirect bug for SSO users — high priority, due Friday, assign to Alice and Ben',
  'Draft Q2 newsletter copy by next Wednesday',
  'Investigate dashboard slowness in prod — urgent, tag perf, due tomorrow',
];

export const AIQuickAddModal: React.FC<AIQuickAddModalProps> = ({
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
  const [text, setText] = useState('');
  const [parsing, setParsing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<ParsedQuickAdd | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open) {
      setText('');
      setDraft(null);
      setError(null);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

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

  const handleParse = async (override?: string) => {
    const value = (override ?? text).trim();
    if (!value || parsing) return;
    setParsing(true);
    setError(null);
    setDraft(null);
    try {
      const result = await parseTaskFromText(currentUserId, value, ctx);
      setDraft(result);
    } catch (err) {
      const aiErr = err as AIError;
      setError(aiErr.message || 'Could not understand that. Try again.');
    } finally {
      setParsing(false);
    }
  };

  const memberById = new Map(members.map((m) => [m.userId, m]));

  const previewDueValid = draft ? parseIsoCalendarDate(draft.dueDate ?? null) : null;

  const handleCreate = async () => {
    if (!draft || creating) return;
    if (!draft.title) {
      setError('Draft has no title yet — refine your sentence and parse again.');
      return;
    }
    setCreating(true);
    try {
      const assignees: TaskAssignee[] = draft.assigneeUserIds
        .map((id) => memberById.get(id))
        .filter((m): m is MemberLite => Boolean(m))
        .map((m) => ({
          userId: m.userId,
          displayName: m.displayName,
          email: m.email,
          photoURL: m.photoURL,
        }));

      const status = draft.status && columns.some((c) => c.id === draft.status)
        ? draft.status
        : defaultStatus;

      const due = parseIsoCalendarDate(draft.dueDate ?? null);

      const input: CreateTaskInput = {
        projectId,
        title: draft.title,
        description: draft.description || '',
        priority: draft.priority || 'medium',
        status,
        dueDate: due,
        assignees,
        tags: draft.tags,
        projectName,
      };

      await onCreate(input);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create task');
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[640px]" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="w-7 h-7 rounded-lg bg-violet-500/10 ring-1 ring-violet-500/30 text-violet-500 flex items-center justify-center">
              <Wand2 className="w-3.5 h-3.5" />
            </span>
            AI Quick Add
          </DialogTitle>
          <DialogDescription>
            Describe the task in one sentence. AI will fill in priority, due date, assignees,
            and tags — review the draft before creating.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <Textarea
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void handleParse();
              }
            }}
            placeholder="e.g. Fix the SSO redirect bug, urgent, due Friday, assign to Alice"
            rows={3}
            disabled={!aiAvailable || parsing}
            className="text-sm"
          />

          {!draft && !parsing && (
            <div className="flex flex-wrap gap-1.5">
              {PROMPT_EXAMPLES.map((example) => (
                <button
                  type="button"
                  key={example}
                  onClick={() => {
                    setText(example);
                    void handleParse(example);
                  }}
                  className="text-[11px] px-2 py-1 rounded-full bg-muted/60 hover:bg-muted text-muted-foreground hover:text-foreground border border-border/60 transition-colors"
                >
                  {example.length > 60 ? `${example.slice(0, 57)}…` : example}
                </button>
              ))}
            </div>
          )}

          {!aiAvailable && (
            <div className="flex items-start gap-2 text-xs rounded-md border border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300 px-3 py-2">
              <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span>
                AI is not configured. Deploy the <code>ai-chat</code> Supabase function to use
                quick add.
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
            <div className="space-y-2">
              <div className="h-3 rounded bg-muted/70 animate-pulse w-2/3" />
              <div className="h-3 rounded bg-muted/70 animate-pulse w-1/2" />
              <div className="h-3 rounded bg-muted/70 animate-pulse w-3/4" />
            </div>
          )}

          {draft && !parsing && (
            <div className="rounded-lg border border-border/70 bg-card p-3 space-y-2.5">
              <div>
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  Title
                </p>
                <p className="text-sm font-semibold leading-snug">
                  {draft.title || <span className="text-muted-foreground">(empty)</span>}
                </p>
              </div>
              {draft.description && (
                <div>
                  <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
                    Description
                  </p>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {draft.description}
                  </p>
                </div>
              )}
              <div className="flex flex-wrap items-center gap-1.5 pt-1">
                {draft.priority && (
                  <span
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${
                      draft.priority === 'high'
                        ? 'bg-red-500/15 text-red-600 dark:text-red-300'
                        : draft.priority === 'low'
                          ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300'
                          : 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                    }`}
                  >
                    <Flag className="w-3 h-3" />
                    {draft.priority}
                  </span>
                )}
                {previewDueValid && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-blue-500/15 text-blue-600 dark:text-blue-300">
                    <Calendar className="w-3 h-3" />
                    {format(previewDueValid, 'EEE, MMM d')}
                  </span>
                )}
                {draft.status && columns.find((c) => c.id === draft.status) && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-secondary text-secondary-foreground">
                    {columns.find((c) => c.id === draft.status)?.title}
                  </span>
                )}
                {draft.assigneeUserIds.length > 0 && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-violet-500/15 text-violet-600 dark:text-violet-300">
                    <Users className="w-3 h-3" />
                    {draft.assigneeUserIds
                      .map((id) => memberById.get(id)?.displayName || 'Unknown')
                      .join(', ')}
                  </span>
                )}
                {draft.tags.length > 0 &&
                  draft.tags.map((t) => (
                    <span
                      key={t}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-muted text-foreground"
                    >
                      <Tag className="w-3 h-3" />
                      {t}
                    </span>
                  ))}
              </div>
              {draft.notes && (
                <div className="flex items-start gap-2 text-[12px] text-muted-foreground bg-muted/30 rounded-md px-2 py-1.5">
                  <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  <span>{draft.notes}</span>
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={creating}>
            Cancel
          </Button>
          {!draft && (
            <Button
              onClick={() => void handleParse()}
              disabled={!aiAvailable || parsing || !text.trim()}
              className="bg-gradient-to-r from-violet-500 to-blue-500 text-white border-0 hover:opacity-90"
            >
              {parsing ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Parsing
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4 mr-2" />
                  Parse
                </>
              )}
            </Button>
          )}
          {draft && (
            <>
              <Button
                variant="outline"
                onClick={() => setDraft(null)}
                disabled={creating}
              >
                Edit text
              </Button>
              <Button onClick={() => void handleCreate()} disabled={creating || !draft.title}>
                {creating ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Creating
                  </>
                ) : (
                  'Create task'
                )}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default AIQuickAddModal;
