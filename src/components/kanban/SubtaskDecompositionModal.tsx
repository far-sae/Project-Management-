import { SetupHint } from '@/components/common/SetupHint';
import { publicText } from '@/lib/publicError';
import React, { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Check, Loader2, Sparkles, Plus } from 'lucide-react';
import { PriorityPill } from '@/components/common/TaskBadges';
import { decomposeTask, isAIEnabled, AIError, Subtask } from '@/services/ai';
import { CreateTaskInput, TaskPriority } from '@/types';
import { cn } from '@/lib/utils';

interface SubtaskDecompositionModalProps {
  open: boolean;
  onClose: () => void;
  parentTask: {
    title: string;
    description: string;
  };
  projectId: string;
  projectName?: string;
  userId: string;
  onCreateSubtasks: (subtasks: CreateTaskInput[]) => Promise<void>;
}

export const SubtaskDecompositionModal: React.FC<SubtaskDecompositionModalProps> = ({
  open,
  onClose,
  parentTask,
  projectId,
  projectName,
  userId,
  onCreateSubtasks,
}) => {
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [subtasks, setSubtasks] = useState<Subtask[]>([]);
  const [reasoning, setReasoning] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [selectedSubtasks, setSelectedSubtasks] = useState<Set<number>>(new Set());
  const aiEnabled = isAIEnabled();

  const handleDecompose = async () => {
    setLoading(true);
    setError(null);

    try {
      const result = await decomposeTask(userId, {
        title: parentTask.title,
        description: parentTask.description,
        projectContext: projectName,
      });

      setSubtasks(result.subtasks);
      setReasoning(result.reasoning);

      // Pre-select all subtasks
      setSelectedSubtasks(new Set(result.subtasks.map((_, i) => i)));
    } catch (err) {
      const aiErr = err as AIError;
      setError(publicText(aiErr.message ?? '', 'Could not break this task down. Try again.'));
    } finally {
      setLoading(false);
    }
  };

  const toggleSubtask = (index: number) => {
    const newSelected = new Set(selectedSubtasks);
    if (newSelected.has(index)) {
      newSelected.delete(index);
    } else {
      newSelected.add(index);
    }
    setSelectedSubtasks(newSelected);
  };

  const handleCreateSubtasks = async () => {
    const tasksToCreate: CreateTaskInput[] = subtasks
      .filter((_, i) => selectedSubtasks.has(i))
      .map((subtask) => ({
        projectId,
        title: subtask.title,
        description: subtask.description,
        priority: (subtask.priority || 'medium') as TaskPriority,
        status: 'todo',
      }));

    setCreating(true);
    try {
      await onCreateSubtasks(tasksToCreate);
      handleClose();
    } catch (err) {
      setError('Failed to create subtasks. Please try again.');
    } finally {
      setCreating(false);
    }
  };

  const handleClose = () => {
    setSubtasks([]);
    setReasoning('');
    setError(null);
    setSelectedSubtasks(new Set());
    onClose();
  };

  const errorBanner = error && (
    <p
      role="alert"
      className="rounded-md border border-destructive/30 bg-destructive-soft px-3 py-2 text-xs text-destructive-soft-foreground"
    >
      {error}
    </p>
  );

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent
        className="flex max-h-[80vh] flex-col overflow-hidden focus-visible:outline-none sm:max-w-[600px]"
        aria-describedby={undefined}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            Break Down Task with AI
          </DialogTitle>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {subtasks.length === 0 ? (
            <div className="space-y-4">
              <div className="rounded-lg border border-border bg-surface-2 px-3 py-2.5">
                <p className="break-words text-sm font-medium text-foreground">
                  {parentTask.title}
                </p>
                <p className="mt-0.5 break-words text-xs text-muted-foreground">
                  {parentTask.description || 'No description provided'}
                </p>
              </div>

              {!aiEnabled && (
                <p className="rounded-md border border-warning/40 bg-warning-soft px-3 py-2 text-xs text-warning-soft-foreground">
                  <SetupHint other="This AI feature is not switched on yet.">
                    AI is not configured. Deploy the ai-chat Edge Function and set OPENAI_API_KEY in Supabase.
                  </SetupHint>
                </p>
              )}

              {errorBanner}

              <Button
                type="button"
                onClick={handleDecompose}
                disabled={loading || !aiEnabled}
                className="w-full"
              >
                {loading ? (
                  <>
                    <Loader2 className="animate-spin" aria-hidden />
                    Analyzing Task...
                  </>
                ) : (
                  <>
                    <Sparkles aria-hidden />
                    Generate Subtasks with AI
                  </>
                )}
              </Button>

              <p className="text-center text-xs text-muted-foreground">
                AI will analyze your task and suggest 3-7 actionable subtasks
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {reasoning && (
                <div className="rounded-lg border border-border bg-surface-2 px-3 py-2.5">
                  <p className="text-xs font-medium text-foreground">AI Analysis</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{reasoning}</p>
                </div>
              )}

              {errorBanner}

              <div className="space-y-2">
                <p className="text-sm font-medium text-muted-foreground">
                  Select subtasks to create (<span className="tabular-nums">{selectedSubtasks.size}</span> selected)
                </p>
                {subtasks.map((subtask, index) => {
                  const selected = selectedSubtasks.has(index);
                  return (
                    <button
                      type="button"
                      key={index}
                      aria-pressed={selected}
                      onClick={() => toggleSubtask(index)}
                      className={cn(
                        'flex w-full items-start gap-2.5 rounded-md border px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        selected
                          ? 'border-foreground/30 bg-surface-2'
                          : 'border-border bg-background hover:bg-secondary',
                      )}
                    >
                      <span
                        aria-hidden
                        className={cn(
                          'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-[1.5px] transition-colors',
                          selected
                            ? 'border-foreground bg-foreground text-background'
                            : 'border-muted-foreground/50 bg-background',
                        )}
                      >
                        {selected && <Check className="h-2.5 w-2.5" strokeWidth={3} />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block break-words text-sm font-medium text-foreground">
                          {subtask.title}
                        </span>
                        <span className="mt-0.5 block break-words text-xs text-muted-foreground">
                          {subtask.description}
                        </span>
                        {(subtask.priority || subtask.estimatedDuration) && (
                          <span className="mt-2 flex flex-wrap items-center gap-1">
                            <PriorityPill priority={subtask.priority} />
                            {subtask.estimatedDuration && (
                              <span className="inline-flex h-5 items-center rounded border border-border bg-background px-1.5 text-xs text-muted-foreground">
                                {subtask.estimatedDuration}
                              </span>
                            )}
                          </span>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 border-t border-border pt-4 sm:gap-0">
          <Button type="button" variant="outline" onClick={handleClose}>
            Cancel
          </Button>
          {subtasks.length > 0 && (
            <Button
              type="button"
              onClick={handleCreateSubtasks}
              disabled={selectedSubtasks.size === 0 || creating}
            >
              {creating ? (
                <>
                  <Loader2 className="animate-spin" aria-hidden />
                  Creating...
                </>
              ) : (
                <>
                  <Plus aria-hidden />
                  Create {selectedSubtasks.size} Subtask
                  {selectedSubtasks.size !== 1 ? 's' : ''}
                </>
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default SubtaskDecompositionModal;
