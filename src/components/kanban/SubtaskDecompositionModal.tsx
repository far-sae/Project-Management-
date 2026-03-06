import React, { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2, Sparkles, Plus, CheckCircle2 } from 'lucide-react';
import { decomposeTask, AIError, Subtask } from '@/services/ai';
import { CreateTaskInput, TaskPriority } from '@/types';

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
      setError(aiErr.message);
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

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[600px] max-h-[80vh] overflow-hidden flex flex-col" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-orange-500" />
            Break Down Task with AI
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto">
          {subtasks.length === 0 ? (
            <div className="space-y-4 py-4">
              <div className="p-4 bg-gray-50 rounded-md">
                <p className="text-sm font-medium text-gray-700 mb-1">
                  {parentTask.title}
                </p>
                <p className="text-xs text-gray-600">
                  {parentTask.description || 'No description provided'}
                </p>
              </div>

              {error && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-md">
                  <p className="text-xs text-red-700">{error}</p>
                </div>
              )}

              <Button
                onClick={handleDecompose}
                disabled={loading}
                className="w-full bg-gradient-to-r from-orange-500 to-red-500"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Analyzing Task...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4 mr-2" />
                    Generate Subtasks with AI
                  </>
                )}
              </Button>

              <p className="text-xs text-gray-500 text-center">
                AI will analyze your task and suggest 3-7 actionable subtasks
              </p>
            </div>
          ) : (
            <div className="space-y-4 py-4">
              {reasoning && (
                <div className="p-3 bg-blue-50 border border-blue-200 rounded-md">
                  <p className="text-xs font-medium text-blue-900 mb-1">AI Analysis</p>
                  <p className="text-xs text-blue-700">{reasoning}</p>
                </div>
              )}

              {error && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-md">
                  <p className="text-xs text-red-700">{error}</p>
                </div>
              )}

              <div className="space-y-2">
                <p className="text-sm font-medium text-gray-700">
                  Select subtasks to create ({selectedSubtasks.size} selected)
                </p>
                {subtasks.map((subtask, index) => (
                  <div
                    key={index}
                    className={`p-3 border rounded-md cursor-pointer transition-colors ${
                      selectedSubtasks.has(index)
                        ? 'border-orange-500 bg-orange-50'
                        : 'border-gray-200 bg-white hover:bg-gray-50'
                    }`}
                    onClick={() => toggleSubtask(index)}
                  >
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5">
                        {selectedSubtasks.has(index) ? (
                          <CheckCircle2 className="w-5 h-5 text-orange-500" />
                        ) : (
                          <div className="w-5 h-5 border-2 border-gray-300 rounded-full" />
                        )}
                      </div>
                      <div className="flex-1">
                        <p className="text-sm font-medium text-gray-900">
                          {subtask.title}
                        </p>
                        <p className="text-xs text-gray-600 mt-1">
                          {subtask.description}
                        </p>
                        <div className="flex gap-2 mt-2">
                          {subtask.priority && (
                            <span
                              className={`text-xs px-2 py-0.5 rounded ${
                                subtask.priority === 'high'
                                  ? 'bg-red-100 text-red-700'
                                  : subtask.priority === 'medium'
                                  ? 'bg-yellow-100 text-yellow-700'
                                  : 'bg-green-100 text-green-700'
                              }`}
                            >
                              {subtask.priority}
                            </span>
                          )}
                          {subtask.estimatedDuration && (
                            <span className="text-xs px-2 py-0.5 bg-gray-100 text-gray-600 rounded">
                              {subtask.estimatedDuration}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="border-t pt-4">
          <Button type="button" variant="outline" onClick={handleClose}>
            Cancel
          </Button>
          {subtasks.length > 0 && (
            <Button
              onClick={handleCreateSubtasks}
              disabled={selectedSubtasks.size === 0 || creating}
              className="bg-gradient-to-r from-orange-500 to-red-500"
            >
              {creating ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <Plus className="w-4 h-4 mr-2" />
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
