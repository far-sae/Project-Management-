import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Send, Bot, Loader2, Check, AlertTriangle, Mail, MoveRight, ListTodo, Paperclip, Sparkles, Building2, FolderKanban, Users } from 'lucide-react';
import { uploadAttachment, type AttachmentEntityType } from '@/services/supabase/attachments';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { useAuth } from '@/context/AuthContext';
import { useOrganization } from '@/context/OrganizationContext';
import { useWorkspaces } from '@/hooks/useWorkspaces';
import { useProjects } from '@/hooks/useProjects';
import { supabase } from '@/services/supabase/config';
import { ProposedAction, canRunAction } from '@/services/agent/agentActions';
import { useAgentActionRunner } from '@/services/agent/useAgentActionRunner';
import { cn } from '@/lib/utils';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  proposedActions?: ProposedAction[];
  pending?: boolean;
}

const QUICK_PROMPTS = [
  { label: 'My workspaces', prompt: 'List all my workspaces and the projects inside each one.' },
  { label: 'Summarize my pipeline', prompt: 'Give me a quick summary of every stage in my pipeline — count, total value, and weighted value.' },
  { label: 'Overdue tasks', prompt: 'List my overdue client tasks, oldest first.' },
  { label: 'Hot leads', prompt: 'Show me my hot leads and who owns each.' },
  { label: 'What should I do today?', prompt: "What's the most important thing I should do today to move deals forward?" },
];

/**
 * Strip Markdown / decoration the model sometimes emits so the chat shows clean
 * plain text — no **bold**, *italics*, `code`, # headings, "- " bullets, or
 * sparkle emoji. (The edge prompt also asks for plain text; this guarantees it.)
 */
const cleanAssistantText = (raw: string): string =>
  raw
    .replace(/\*\*(.*?)\*\*/g, '$1')        // **bold**
    .replace(/\*(.*?)\*/g, '$1')            // *italic* / stray stars
    .replace(/`{1,3}([^`]*)`{1,3}/g, '$1')  // `code`
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')     // # headings
    .replace(/^\s*[-*•]\s+/gm, '')          // leading bullet markers
    .replace(/[✨⭐🌟]/g, '') // ✨ ⭐ 🌟
    .replace(/\n{3,}/g, '\n\n')
    .trim();

export const CrmAssistantChat: React.FC = () => {
  const { user } = useAuth();
  const { organization, isOwner, isAdmin, canEditModule } = useOrganization();
  const { workspaces } = useWorkspaces();
  const { projects } = useProjects();
  const orgId = organization?.organizationId ?? user?.organizationId ?? null;
  const role = isOwner ? 'owner' : isAdmin ? 'admin' : 'member';

  const perms = useMemo(
    () => ({ isAdmin: isOwner || isAdmin, canEditModule }),
    [isOwner, isAdmin, canEditModule],
  );

  const { running: actingActionId, run: runAction } = useAgentActionRunner();

  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content:
        "Hi! I'm your CRM assistant. I can summarize your pipeline, find overdue tasks, draft outreach emails, "
        + "create tasks and deals, and suggest stage moves. Ask in plain language — I'll never make a change "
        + "without showing you a Confirm button first.",
    },
  ]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [lastEntity, setLastEntity] = useState<{ type: AttachmentEntityType; id: string; label: string } | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, busy]);

  const history = useMemo(
    () => messages
      .filter((m) => m.id !== 'welcome' && !m.pending)
      .slice(-6)
      .map((m) => ({ role: m.role, content: m.content })),
    [messages],
  );

  const send = async (overrideText?: string) => {
    const text = (overrideText ?? input).trim();
    if (!text || !orgId || busy) return;
    if (!user) { toast.error('Sign in first.'); return; }

    const userMsg: ChatMessage = { id: crypto.randomUUID(), role: 'user', content: text };
    const thinkingId = crypto.randomUUID();
    setMessages((prev) => [...prev, userMsg, { id: thinkingId, role: 'assistant', content: '', pending: true }]);
    setInput('');
    setBusy(true);

    try {
      const { data, error } = await supabase.functions.invoke('crm-assistant', {
        body: { organization_id: orgId, user_message: text, history },
      });
      if (error) throw error;
      const reply = cleanAssistantText((data as { reply?: string })?.reply ?? '(no response)');
      const proposed = (data as { proposed_actions?: ProposedAction[] })?.proposed_actions ?? [];
      setMessages((prev) => prev
        .filter((m) => m.id !== thinkingId)
        .concat({
          id: crypto.randomUUID(),
          role: 'assistant',
          content: reply,
          proposedActions: proposed.length > 0 ? proposed : undefined,
        }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Assistant call failed';
      setMessages((prev) => prev
        .filter((m) => m.id !== thinkingId)
        .concat({
          id: crypto.randomUUID(),
          role: 'assistant',
          content: `${msg}. If the crm-assistant edge function isn't deployed yet, deploy it from supabase/functions/crm-assistant and set ANTHROPIC_API_KEY.`,
        }));
    } finally {
      setBusy(false);
    }
  };

  const handleAction = async (msgId: string, idx: number, action: ProposedAction) => {
    const result = await runAction(action);
    if (result.ok) {
      // Drop the confirmed action from its card so it doesn't linger.
      setMessages((prev) => prev.map((m) =>
        m.id === msgId ? { ...m, proposedActions: m.proposedActions?.filter((_, i) => i !== idx) } : m));
      if (result.created) setLastEntity(result.created as { type: AttachmentEntityType; id: string; label: string });
    }
  };

  const dismissAction = (msgId: string, idx: number) => {
    setMessages((prev) => prev.map((m) =>
      m.id === msgId ? { ...m, proposedActions: m.proposedActions?.filter((_, i) => i !== idx) } : m));
  };

  const onPickFile = async (file: File) => {
    if (!organization?.organizationId) return;
    if (!lastEntity) { toast.info("Create or open a record first (e.g. 'create deal Acme'), then attach the file to it."); return; }
    setUploadPct(0);
    try {
      await uploadAttachment({
        organizationId: organization.organizationId,
        entityType: lastEntity.type, entityId: lastEntity.id,
        file, uploadedBy: user?.userId ?? null, uploadedByName: user?.displayName ?? null,
        onProgress: setUploadPct,
      });
      toast.success(`Attached ${file.name} to ${lastEntity.type} "${lastEntity.label}"`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed');
    } finally { setUploadPct(null); }
  };

  const userInitial = (user?.displayName?.charAt(0) ?? 'U').toUpperCase();

  return (
    <Card className="overflow-hidden border-border/70">
      <CardContent className="p-0 flex flex-col h-[calc(100vh-14rem)] min-h-[26rem]">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b bg-gradient-to-r from-indigo-500/10 via-violet-500/5 to-transparent">
          <div className="flex items-center gap-2.5">
            <span className="grid place-items-center w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-violet-500 text-white shadow-sm">
              <Bot className="w-4 h-4" />
            </span>
            <div className="leading-tight">
              <div className="font-semibold text-sm flex items-center gap-1.5">
                CRM Assistant
                <Badge variant="outline" className="text-[10px] capitalize font-normal">{role}</Badge>
              </div>
              <div className="text-[10px] text-muted-foreground">Read-only by default · writes need your confirmation</div>
            </div>
          </div>
          <span className="hidden sm:inline text-[10px] text-muted-foreground">Powered by Claude</span>
        </div>

        {/* Context strip — shows the assistant knows the whole org structure */}
        <div className="flex items-center gap-2 px-4 py-1.5 border-b bg-muted/30 text-[11px] text-muted-foreground overflow-x-auto">
          {organization?.name && <span className="font-medium text-foreground truncate max-w-[40%]">{organization.name}</span>}
          <span className="inline-flex items-center gap-1"><Building2 className="w-3 h-3" /> {workspaces.length} workspace{workspaces.length === 1 ? '' : 's'}</span>
          <span className="text-border">·</span>
          <span className="inline-flex items-center gap-1"><FolderKanban className="w-3 h-3" /> {projects.length} project{projects.length === 1 ? '' : 's'}</span>
          <span className="text-border">·</span>
          <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400"><Users className="w-3 h-3" /> full org knowledge</span>
        </div>

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4 bg-gradient-to-b from-transparent to-muted/20">
          {messages.map((m) => {
            const isUser = m.role === 'user';
            return (
              <div key={m.id} className={cn('flex gap-2.5 items-start', isUser ? 'flex-row-reverse' : 'flex-row')}>
                {isUser ? (
                  <span className="w-7 h-7 rounded-full bg-primary/15 text-primary text-xs grid place-items-center font-semibold shrink-0">{userInitial}</span>
                ) : (
                  <span className="w-7 h-7 rounded-full bg-gradient-to-br from-indigo-500 to-violet-500 text-white grid place-items-center shrink-0"><Bot className="w-4 h-4" /></span>
                )}
                <div className={cn('max-w-[80%] min-w-0 space-y-2', isUser && 'items-end flex flex-col')}>
                  <div
                    className={cn(
                      'rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap break-words shadow-sm',
                      isUser ? 'bg-primary text-primary-foreground rounded-tr-sm' : 'bg-card border rounded-tl-sm',
                    )}
                  >
                    {m.pending ? (
                      <span className="inline-flex items-center gap-1 py-0.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50 animate-bounce [animation-delay:-0.3s]" />
                        <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50 animate-bounce [animation-delay:-0.15s]" />
                        <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50 animate-bounce" />
                      </span>
                    ) : (
                      isUser ? m.content : cleanAssistantText(m.content)
                    )}
                  </div>

                  {m.proposedActions && m.proposedActions.length > 0 && (
                    <div className="flex flex-col gap-2 w-full">
                      {m.proposedActions.map((a, i) => {
                        const id = `${a.type}-${JSON.stringify(a.payload)}`;
                        const Icon = a.type === 'draft_email' ? Mail
                          : a.type === 'move_deal_stage' ? MoveRight
                          : (a.type === 'create_client_task' || a.type === 'create_pm_task' || a.type === 'assign_task') ? ListTodo
                          : Sparkles;
                        const allowed = canRunAction(a.type, perms);
                        const acting = actingActionId === id;
                        return (
                          <div key={i} className="rounded-xl border bg-card px-3 py-2.5 shadow-sm">
                            <div className="flex items-center gap-2">
                              <span className="grid place-items-center w-7 h-7 rounded-lg bg-indigo-500/10 text-indigo-500 shrink-0"><Icon className="w-4 h-4" /></span>
                              <div className="flex-1 min-w-0">
                                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Proposed action</div>
                                <div className="text-xs font-medium truncate">{a.label}</div>
                              </div>
                            </div>
                            <div className="mt-2 flex items-center justify-end gap-1.5">
                              {!allowed ? (
                                <span className="inline-flex items-center gap-1 text-[10px] text-amber-600">
                                  <AlertTriangle className="w-3 h-3" /> You don't have access for this
                                </span>
                              ) : (
                                <>
                                  <Button size="sm" variant="ghost" className="h-7 text-[11px] px-2 text-muted-foreground" disabled={acting} onClick={() => dismissAction(m.id, i)}>
                                    Dismiss
                                  </Button>
                                  <Button size="sm" className="h-7 text-[11px] px-3 gap-1" disabled={acting} onClick={() => void handleAction(m.id, i, a)}>
                                    {acting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />} Confirm
                                  </Button>
                                </>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Composer */}
        <div className="border-t p-3 space-y-2 shrink-0 bg-card">
          {!input.trim() && (
            <div className="flex gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {QUICK_PROMPTS.map((q) => (
                <button
                  key={q.label}
                  type="button"
                  onClick={() => void send(q.prompt)}
                  className="shrink-0 text-[11px] px-2.5 py-1 rounded-full border border-border bg-background hover:border-primary hover:bg-primary/5 text-muted-foreground hover:text-foreground transition-colors"
                  disabled={busy}
                >
                  {q.label}
                </button>
              ))}
            </div>
          )}
          <div className="flex gap-2 items-end rounded-2xl border bg-background p-1.5 focus-within:ring-2 focus-within:ring-primary/40 transition-shadow">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }}
              placeholder='Ask anything — e.g. "Create a task to call Acme tomorrow"'
              rows={1}
              className="flex-1 resize-none bg-transparent px-2 py-1.5 text-sm focus:outline-none max-h-32"
              disabled={busy}
            />
            <input ref={fileRef} type="file" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void onPickFile(f); e.currentTarget.value = ''; }} />
            <Button type="button" size="icon" variant="ghost" className="h-8 w-8 shrink-0" disabled={busy || uploadPct !== null} onClick={() => fileRef.current?.click()} title="Attach a file to the last record">
              {uploadPct !== null ? <span className="text-[10px]">{uploadPct}%</span> : <Paperclip className="w-4 h-4" />}
            </Button>
            <Button onClick={() => void send()} disabled={busy || !input.trim()} size="icon" className="h-8 w-8 shrink-0 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-500 hover:opacity-90 text-white">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
