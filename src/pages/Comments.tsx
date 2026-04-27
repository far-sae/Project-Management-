import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sidebar } from '@/components/sidebar/Sidebar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { MessageSquare, Clock, ArrowRight, Loader2, AlertCircle } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useUserComments } from '@/hooks/useComments';
import { useProjects } from '@/hooks/useProjects';
import { formatDistanceToNow } from 'date-fns';
import AttachmentPreview from '@/components/ui/AttachmentPreview';
import { toast } from 'sonner';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

export const Comments: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { comments, loading, error } = useUserComments(user?.userId || null);
  const { projects } = useProjects();
  const [selectedComment, setSelectedComment] = useState<typeof comments[0] | null>(null);

  const validProjectIds = useMemo(() => new Set(projects.map((p) => p.projectId)), [projects]);
  const filteredComments = useMemo(
    () => (comments || []).filter((c) => c.projectId && validProjectIds.has(c.projectId)),
    [comments, validProjectIds]
  );

  const handleNavigateToTask = (projectId: string, taskId: string) => {
    navigate(`/project/${projectId}?taskId=${taskId}`);
    toast.success('Navigating to task', {
      description: 'Opening task details...',
    });
  };

  const handleCommentClick = (comment: typeof comments[0]) => {
    setSelectedComment(comment);
  };

  const handleConfirmNavigation = () => {
    if (selectedComment) {
      handleNavigateToTask(selectedComment.projectId, selectedComment.taskId);
      setSelectedComment(null);
    }
  };

  if (!user) {
    return (
      <div className="flex h-screen bg-background">
        <Sidebar />
        <main className="flex-1 overflow-y-auto p-8">
          <h1 className="text-3xl font-bold text-foreground mb-2">Comments</h1>
          <p className="text-muted-foreground">Sign in to view your task comments.</p>
        </main>
      </div>
    );
  }


  return (
    <div className="flex h-screen bg-background">
      <Sidebar />
      <main className="flex-1 overflow-y-auto p-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-foreground">Comments</h1>
          <p className="text-muted-foreground">View all comments across your projects</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>
              Recent Comments
              {filteredComments.length > 0 && (
                <span className="ml-2 text-sm font-normal text-muted-foreground">
                  ({filteredComments.length} total)
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {error && (
              <Alert variant="destructive" className="mb-4">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Error loading comments</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            {loading ? (
              <div className="text-center py-16 text-muted-foreground">
                <Loader2 className="w-12 h-12 mx-auto mb-4 text-muted-foreground/50 animate-spin" />
                <p className="text-lg font-medium">Loading comments...</p>
              </div>
            ) : filteredComments.length === 0 ? (
              <div className="text-center py-16 text-muted-foreground">
                <MessageSquare className="w-16 h-16 mx-auto mb-4 text-muted-foreground/50" />
                <p className="text-lg font-medium">No comments yet</p>
                <p className="text-sm">Comments on tasks will appear here</p>
              </div>
            ) : (
              <div className="space-y-4">
                {filteredComments.map((comment) => (
                  <div
                    key={comment.commentId}
                    className="p-4 bg-muted/30 rounded-lg hover:bg-muted/50 transition-colors cursor-pointer group"
                    onClick={() => handleCommentClick(comment)}
                  >
                    <div className="flex items-start gap-3">
                      {comment.photoURL ? (
                        <img
                          src={comment.photoURL}
                          alt={comment.displayName}
                          className="w-10 h-10 rounded-full object-cover"
                        />
                      ) : (
                        <div className="w-10 h-10 rounded-full bg-orange-100 flex items-center justify-center text-orange-700 font-medium">
                          {comment.displayName.charAt(0).toUpperCase()}
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center flex-wrap gap-2 mb-1">
                          <span className="font-medium text-foreground">
                            {comment.displayName}
                          </span>
                          <span className="text-muted-foreground">commented on</span>
                          <span className="text-sm font-medium text-blue-600 truncate">
                            {comment.taskTitle}
                          </span>
                        </div>
                        <div className="text-xs text-muted-foreground mb-2">
                          in <span className="font-medium">{comment.projectName}</span>
                        </div>
                        {comment.text?.trim() ? (
                          <p className="text-foreground text-sm">{comment.text}</p>
                        ) : null}
                        {comment.attachments && comment.attachments.length > 0 && (
                          <AttachmentPreview
                            attachments={comment.attachments}
                            stopPropagation={true}
                          />
                        )}
                        <div className="mt-2 flex items-center justify-between">
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <Clock className="w-3 h-3" />
                            {formatDistanceToNow(new Date(comment.createdAt), {
                              addSuffix: true,
                            })}
                            {comment.isEdited && (
                              <>
                                <span className="text-muted-foreground/80">•</span>
                                <span>edited</span>
                              </>
                            )}
                          </div>
                          <ArrowRight className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </main>

      {/* Comment Detail Dialog */}
      <AlertDialog open={!!selectedComment} onOpenChange={(open) => !open && setSelectedComment(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Comment Details</AlertDialogTitle>
            <AlertDialogDescription>
              {selectedComment && (
                <div className="space-y-3 mt-2">
                  <div className="flex items-center gap-2">
                    {selectedComment.photoURL ? (
                      <img
                        src={selectedComment.photoURL}
                        alt={selectedComment.displayName}
                        className="w-8 h-8 rounded-full object-cover"
                      />
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-orange-100 flex items-center justify-center text-orange-700 font-medium text-sm">
                        {selectedComment.displayName.charAt(0).toUpperCase()}
                      </div>
                    )}
                    <span className="font-medium">{selectedComment.displayName}</span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Commented on <strong>{selectedComment.taskTitle}</strong> in <strong>{selectedComment.projectName}</strong>
                  </p>
                  {selectedComment.text?.trim() && (
                    <div className="bg-muted/50 p-3 rounded text-sm text-foreground border border-border/60">
                      {selectedComment.text}
                    </div>
                  )}
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Clock className="w-3 h-3" />
                    {formatDistanceToNow(new Date(selectedComment.createdAt), { addSuffix: true })}
                    {selectedComment.isEdited && (
                      <>
                        <span className="text-muted-foreground/80">•</span>
                        <span>edited</span>
                      </>
                    )}
                  </div>
                </div>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setSelectedComment(null)}>Close</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmNavigation}>
              View Task
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default Comments;
