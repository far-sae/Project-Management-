import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppHeader } from '@/components/layout/AppHeader';
import { PageHeader } from '@/components/common/PageHeader';
import { Input } from '@/components/ui/input';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import {
  MessageSquare,
  Clock,
  ArrowRight,
  Loader2,
  AlertCircle,
  Search,
  AtSign,
  ExternalLink,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useUserComments } from '@/hooks/useComments';
import { useProjects } from '@/hooks/useProjects';
import { useSelectedWorkspace } from '@/hooks/useSelectedWorkspace';
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
import { formatDistanceSafe } from '@/lib/utils';

type CommentTab = 'all' | 'mentions' | 'mine';

export const Comments: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { comments, loading, error } = useUserComments(user?.userId || null);
  const { projects: allProjects } = useProjects();
  const { filterProjects } = useSelectedWorkspace();
  const projects = useMemo(() => filterProjects(allProjects), [allProjects, filterProjects]);
  const [selectedComment, setSelectedComment] = useState<typeof comments[0] | null>(null);
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState<CommentTab>('all');

  const validProjectIds = useMemo(
    () => new Set(projects.map((p) => p.projectId)),
    [projects],
  );

  const filteredComments = useMemo(
    () => (comments || []).filter((c) => c.projectId && validProjectIds.has(c.projectId)),
    [comments, validProjectIds],
  );

  const mentionRegex = useMemo(() => {
    if (!user) return null;
    const handle = (user.displayName || user.email || '').trim();
    if (!handle) return null;
    const escaped = handle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`@${escaped}`, 'i');
  }, [user]);

  const tabbedComments = useMemo(() => {
    const q = search.trim().toLowerCase();
    return filteredComments.filter((c) => {
      if (tab === 'mentions') {
        if (!mentionRegex || !c.text) return false;
        if (!mentionRegex.test(c.text)) return false;
      } else if (tab === 'mine') {
        if (!user || c.userId !== user.userId) return false;
      }
      if (!q) return true;
      const haystack = `${c.text || ''} ${c.taskTitle || ''} ${c.projectName || ''} ${c.displayName || ''}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [filteredComments, tab, search, mentionRegex, user]);

  const counts = useMemo(() => {
    const all = filteredComments.length;
    const mentions = mentionRegex
      ? filteredComments.filter((c) => c.text && mentionRegex.test(c.text)).length
      : 0;
    const mine = user
      ? filteredComments.filter((c) => c.userId === user.userId).length
      : 0;
    return { all, mentions, mine };
  }, [filteredComments, mentionRegex, user]);

  const handleNavigateToTask = (projectId: string, taskId: string) => {
    navigate(`/project/${projectId}?taskId=${taskId}`);
    toast.success('Opening task');
  };

  const handleConfirmNavigation = () => {
    if (selectedComment) {
      handleNavigateToTask(selectedComment.projectId, selectedComment.taskId);
      setSelectedComment(null);
    }
  };

  if (!user) {
    return (
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden bg-background">
        <AppHeader left={<span className="text-sm font-semibold">Comments</span>} />
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 lg:px-6">
            <PageHeader title="Comments" description="Sign in to view your task comments." />
          </div>
        </div>
      </main>
    );
  }

  return (
    <>
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden bg-background">
        <AppHeader left={<span className="text-sm font-semibold">Comments</span>} />

        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 lg:px-6">
            <PageHeader
              title="Comments"
              description="Recent comments and conversations across your tasks and projects"
            />

            <div className="flex flex-col gap-4">
              <div className="relative w-full max-w-xs">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  aria-label="Search comments"
                  placeholder="Search comments…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-8"
                />
              </div>

              {error && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>Error loading comments</AlertTitle>
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              <Tabs value={tab} onValueChange={(v) => setTab(v as CommentTab)}>
                {/* The tab row scrolls sideways rather than wrapping when it is too wide. */}
                <div className="overflow-x-auto">
                  <TabsList className="flex w-max min-w-full">
                    <TabsTrigger value="all">
                      All
                      <span className="text-xs font-normal tabular-nums text-muted-foreground">
                        {counts.all}
                      </span>
                    </TabsTrigger>
                    <TabsTrigger value="mentions">
                      <AtSign className="h-3.5 w-3.5" aria-hidden />
                      Mentions
                      <span className="text-xs font-normal tabular-nums text-muted-foreground">
                        {counts.mentions}
                      </span>
                    </TabsTrigger>
                    <TabsTrigger value="mine">
                      Mine
                      <span className="text-xs font-normal tabular-nums text-muted-foreground">
                        {counts.mine}
                      </span>
                    </TabsTrigger>
                  </TabsList>
                </div>

                {(['all', 'mentions', 'mine'] as const).map((value) => (
                  <TabsContent
                    key={value}
                    value={value}
                    className="focus-visible:outline-none"
                  >
                    {loading ? (
                      <div className="flex items-center justify-center py-16">
                        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                      </div>
                    ) : tabbedComments.length === 0 ? (
                      <div className="flex flex-col items-center gap-1 rounded-lg border border-border px-4 py-12 text-center">
                        <MessageSquare className="mb-1 h-5 w-5 text-muted-foreground" aria-hidden />
                        <p className="text-[13px] font-medium text-foreground">
                          {value === 'mentions'
                            ? 'No mentions yet'
                            : value === 'mine'
                            ? 'No comments by you'
                            : 'No comments yet'}
                        </p>
                        <p className="max-w-sm text-xs text-muted-foreground">
                          {value === 'mentions'
                            ? 'Use @name in a comment to ping someone — those mentions show up here.'
                            : 'Comments on tasks across your projects will appear here.'}
                        </p>
                      </div>
                    ) : (
                      <ul className="overflow-hidden rounded-lg border border-border bg-background">
                        {tabbedComments.map((comment) => {
                          const isMine = user?.userId === comment.userId;
                          return (
                            <li
                              key={comment.commentId}
                              role="button"
                              tabIndex={0}
                              onClick={() => setSelectedComment(comment)}
                              onKeyDown={(e) => {
                                if (e.currentTarget !== e.target) return;
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault();
                                  setSelectedComment(comment);
                                }
                              }}
                              className="group flex min-h-12 cursor-pointer gap-3 border-b border-border/60 px-4 py-3 text-[13px] outline-none transition-colors last:border-b-0 hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                            >
                              {comment.photoURL ? (
                                <img
                                  src={comment.photoURL}
                                  alt={comment.displayName}
                                  className="h-7 w-7 shrink-0 rounded-full object-cover"
                                />
                              ) : (
                                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary-soft text-xs font-medium text-primary-soft-foreground">
                                  {(comment.displayName || '?').charAt(0).toUpperCase()}
                                </div>
                              )}
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                                  <span className="font-medium text-foreground">
                                    {comment.displayName}
                                    {isMine && (
                                      <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                                        You
                                      </span>
                                    )}
                                  </span>
                                  <span className="text-muted-foreground">
                                    on
                                  </span>
                                  <span
                                    className="max-w-[20rem] truncate font-medium text-foreground"
                                    title={comment.taskTitle}
                                  >
                                    {comment.taskTitle}
                                  </span>
                                  <span className="text-xs text-muted-foreground">
                                    · {comment.projectName}
                                  </span>
                                </div>

                                {comment.text?.trim() && (
                                  <p className="mt-1 line-clamp-3 whitespace-pre-wrap break-words leading-5 text-foreground">
                                    {comment.text}
                                  </p>
                                )}

                                {comment.attachments && comment.attachments.length > 0 && (
                                  <div className="mt-2">
                                    <AttachmentPreview
                                      attachments={comment.attachments}
                                      stopPropagation={true}
                                    />
                                  </div>
                                )}

                                <div className="mt-1.5 flex items-center justify-between gap-2">
                                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                    <Clock className="h-3 w-3" aria-hidden />
                                    {formatDistanceSafe(comment.createdAt)}
                                    {comment.isEdited && (
                                      <>
                                        <span aria-hidden>·</span>
                                        <span>edited</span>
                                      </>
                                    )}
                                  </div>
                                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                                    Open task
                                    <ArrowRight className="h-3 w-3" aria-hidden />
                                  </span>
                                </div>
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </TabsContent>
                ))}
              </Tabs>
            </div>
          </div>
        </div>
      </main>

      <AlertDialog
        open={!!selectedComment}
        onOpenChange={(open) => !open && setSelectedComment(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Comment</AlertDialogTitle>
            <AlertDialogDescription asChild>
              {selectedComment && (
                <div className="mt-2 space-y-3 text-foreground">
                  <div className="flex items-center gap-2">
                    {selectedComment.photoURL ? (
                      <img
                        src={selectedComment.photoURL}
                        alt={selectedComment.displayName || 'Comment author'}
                        className="w-8 h-8 rounded-full object-cover ring-1 ring-border"
                      />
                    ) : (
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary-soft text-xs font-medium text-primary-soft-foreground">
                        {(selectedComment.displayName || '?').charAt(0).toUpperCase()}
                      </div>
                    )}
                    <div className="text-[13px]">
                      <span className="font-medium">{selectedComment.displayName}</span>
                      <span className="ml-1 text-muted-foreground">
                        on <span className="font-medium text-foreground">{selectedComment.taskTitle}</span>
                        {' '}in <span className="font-medium text-foreground">{selectedComment.projectName}</span>
                      </span>
                    </div>
                  </div>
                  {selectedComment.text?.trim() && (
                    <div className="whitespace-pre-wrap rounded-md border border-border bg-surface-2 p-3 text-[13px] leading-5 text-foreground">
                      {selectedComment.text}
                    </div>
                  )}
                  {selectedComment.attachments && selectedComment.attachments.length > 0 && (
                    <AttachmentPreview
                      attachments={selectedComment.attachments}
                      stopPropagation={true}
                    />
                  )}
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Clock className="w-3 h-3" />
                    {formatDistanceSafe(selectedComment.createdAt)}
                    {selectedComment.isEdited && (
                      <>
                        <span className="text-muted-foreground/60">·</span>
                        <span>edited</span>
                      </>
                    )}
                  </div>
                </div>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setSelectedComment(null)}>
              Close
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmNavigation}>
              <ExternalLink className="w-4 h-4" />
              View task
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

export default Comments;
