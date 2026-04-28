import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sidebar } from '@/components/sidebar/Sidebar';
import { AppHeader } from '@/components/layout/AppHeader';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from '@/components/ui/breadcrumb';
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
import { cn } from '@/lib/utils';

type CommentTab = 'all' | 'mentions' | 'mine';

export const Comments: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { comments, loading, error } = useUserComments(user?.userId || null);
  const { projects } = useProjects();
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
      <main className="flex-1 flex flex-col overflow-hidden">
        <AppHeader
          left={
            <Breadcrumb>
              <BreadcrumbList>
                <BreadcrumbItem>
                  <BreadcrumbPage className="flex items-center gap-2">
                    <MessageSquare className="w-4 h-4" />
                    Comments
                  </BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          }
        />

        <div className="flex-1 overflow-y-auto">
          <div className="w-full max-w-[1200px] mx-auto px-4 lg:px-6 py-6">
            <Card className="overflow-hidden">
              <CardHeader className="pb-3 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div>
                    <CardTitle className="text-base font-semibold">Recent comments</CardTitle>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Conversations across your tasks and projects
                    </p>
                  </div>
                </div>
                <div className="relative w-full max-w-md">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                  <Input
                    placeholder="Search comments…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="pl-9 h-9"
                  />
                </div>
              </CardHeader>

              <CardContent className="pt-0 space-y-4">
                {error && (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>Error loading comments</AlertTitle>
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}

                <Tabs value={tab} onValueChange={(v) => setTab(v as CommentTab)}>
                  <TabsList className="w-full justify-start flex-wrap h-auto gap-1 bg-secondary/50 p-1 mb-2">
                    <TabsTrigger value="all" className="text-xs sm:text-sm">
                      All
                      <span className="ml-1.5 tabular-nums text-[10px] text-muted-foreground">
                        {counts.all}
                      </span>
                    </TabsTrigger>
                    <TabsTrigger value="mentions" className="text-xs sm:text-sm">
                      <AtSign className="w-3 h-3 mr-1" />
                      Mentions
                      <span className="ml-1.5 tabular-nums text-[10px] text-muted-foreground">
                        {counts.mentions}
                      </span>
                    </TabsTrigger>
                    <TabsTrigger value="mine" className="text-xs sm:text-sm">
                      Mine
                      <span className="ml-1.5 tabular-nums text-[10px] text-muted-foreground">
                        {counts.mine}
                      </span>
                    </TabsTrigger>
                  </TabsList>

                  {(['all', 'mentions', 'mine'] as const).map((value) => (
                    <TabsContent
                      key={value}
                      value={value}
                      className="mt-0 focus-visible:outline-none"
                    >
                      {loading ? (
                        <div className="flex items-center justify-center py-16">
                          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                        </div>
                      ) : tabbedComments.length === 0 ? (
                        <div className="flex flex-col items-center justify-center text-center py-16 px-4 rounded-lg border border-dashed border-border bg-muted/20">
                          <div className="w-12 h-12 rounded-full bg-secondary flex items-center justify-center mb-3">
                            <MessageSquare className="w-6 h-6 text-muted-foreground" />
                          </div>
                          <p className="text-sm font-medium text-foreground">
                            {value === 'mentions'
                              ? 'No mentions yet'
                              : value === 'mine'
                              ? 'No comments by you'
                              : 'No comments yet'}
                          </p>
                          <p className="text-xs text-muted-foreground mt-1 max-w-sm">
                            {value === 'mentions'
                              ? 'Use @name in a comment to ping someone — those mentions show up here.'
                              : 'Comments on tasks across your projects will appear here.'}
                          </p>
                        </div>
                      ) : (
                        <ul className="divide-y divide-border rounded-lg border border-border bg-background overflow-hidden">
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
                                className={cn(
                                  'group flex gap-3 px-4 py-3.5 cursor-pointer transition-colors outline-none',
                                  'hover:bg-secondary/40 focus-visible:bg-secondary/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                                )}
                              >
                                {comment.photoURL ? (
                                  <img
                                    src={comment.photoURL}
                                    alt={comment.displayName}
                                    className="w-9 h-9 rounded-full object-cover ring-1 ring-border shrink-0"
                                  />
                                ) : (
                                  <div className="w-9 h-9 rounded-full bg-primary-soft text-primary-soft-foreground font-semibold text-sm flex items-center justify-center shrink-0">
                                    {(comment.displayName || '?').charAt(0).toUpperCase()}
                                  </div>
                                )}
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center flex-wrap gap-x-2 gap-y-0.5 text-sm">
                                    <span className="font-medium text-foreground">
                                      {comment.displayName}
                                      {isMine && (
                                        <span className="ml-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                                          You
                                        </span>
                                      )}
                                    </span>
                                    <span className="text-muted-foreground">
                                      on
                                    </span>
                                    <span
                                      className="font-medium text-primary truncate max-w-[20rem]"
                                      title={comment.taskTitle}
                                    >
                                      {comment.taskTitle}
                                    </span>
                                    <span className="text-xs text-muted-foreground/80">
                                      · {comment.projectName}
                                    </span>
                                  </div>

                                  {comment.text?.trim() && (
                                    <p className="mt-1 text-sm text-foreground/90 line-clamp-3 whitespace-pre-wrap">
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

                                  <div className="mt-2 flex items-center justify-between">
                                    <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                                      <Clock className="w-3 h-3" />
                                      {formatDistanceToNow(new Date(comment.createdAt), {
                                        addSuffix: true,
                                      })}
                                      {comment.isEdited && (
                                        <>
                                          <span className="text-muted-foreground/60">·</span>
                                          <span>edited</span>
                                        </>
                                      )}
                                    </div>
                                    <span className="opacity-0 group-hover:opacity-100 transition-opacity inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                                      Open task
                                      <ArrowRight className="w-3 h-3" />
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
              </CardContent>
            </Card>
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
                <div className="space-y-3 mt-2 text-foreground/90">
                  <div className="flex items-center gap-2">
                    {selectedComment.photoURL ? (
                      <img
                        src={selectedComment.photoURL}
                        alt={selectedComment.displayName}
                        className="w-8 h-8 rounded-full object-cover ring-1 ring-border"
                      />
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-primary-soft text-primary-soft-foreground font-semibold text-xs flex items-center justify-center">
                        {selectedComment.displayName.charAt(0).toUpperCase()}
                      </div>
                    )}
                    <div className="text-sm">
                      <span className="font-medium">{selectedComment.displayName}</span>
                      <span className="ml-1 text-muted-foreground">
                        on <strong className="text-foreground">{selectedComment.taskTitle}</strong>
                        {' '}in <strong className="text-foreground">{selectedComment.projectName}</strong>
                      </span>
                    </div>
                  </div>
                  {selectedComment.text?.trim() && (
                    <div className="bg-secondary/50 p-3 rounded-md text-sm border border-border whitespace-pre-wrap">
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
                    {formatDistanceToNow(new Date(selectedComment.createdAt), {
                      addSuffix: true,
                    })}
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
            <AlertDialogAction onClick={handleConfirmNavigation} className="gap-1.5">
              <ExternalLink className="w-4 h-4" />
              View task
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default Comments;
