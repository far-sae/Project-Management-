import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Send, Sparkles, Loader2, CheckCircle2, AlertTriangle, Mail, MoveRight, ListTodo, Paperclip } from 'lucide-react';
import { uploadAttachment, type AttachmentEntityType } from "@/services/supabase/attachments";
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { useAuth } from '@/context/AuthContext';
import { useOrganization } from '@/context/OrganizationContext';
import { supabase } from '@/services/supabase/config';
import {
  ProposedAction,
  canRunAction,
} from '@/services/agent/agentActions';
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
  { label: 'Summarize my pipeline', prompt: 'Give me a quick summary of every stage in my pipeline — count, total value, and weighted value.' },
  { label: 'Overdue tasks', prompt: 'List my overdue client tasks, oldest first.' },
  { label: 'Hot leads', prompt: 'Show me my hot leads and who owns each.' },
  { label: 'What should I do today?', prompt: "What's the most important thing I should do today to move deals forward?" },
];

/**
 * Conversational CRM assistant for the AI Agent page. Posts to the
 * crm-assistant edge function which dispatches Claude with read tools
 * (pipeline summary, overdue tasks, hot leads, deal detail) and write-
 * proposal tools (draft email, move stage, create/update records). Write
 * actions are NEVER executed silently — they come back as proposed_actions
 * and the user confirms here before any change lands in the CRM.
 *
 * Role gating: the edge function authorises the caller and includes the
 * role in Claude's system prompt; the chat panel also gates confirm
 * buttons on canRunAction so members can't trigger writes they lack
 * permission for.
 */
export const CrmAssistantChat: React.FC = () => {
  const { user } = useAuth();
  const { organization, isOwner, isAdmin, canEditModule } = useOrganization();
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
        "Hi! I'm your CRM assistant. I can summarize your pipeline, find overdue tasks, draft outreach emails, and suggest stage moves. "
        + "Ask in plain language — I'll never make a change without showing you first.",
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

  // Compact history for the edge function — only the last 6 turns so the
  // prompt stays cheap.
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
    setMessages((prev) => [...prev, userMsg, { id: thinkingId, role: 'assistant', content: 'Thinking…', pending: true }]);
    setInput('');
    setBusy(true);

    try {
      const { data, error } = await supabase.functions.invoke('crm-assistant', {
        body: {
          organization_id: orgId,
          user_message: text,
          history,
        },
      });
      if (error) throw error;
      const reply = (data as { reply?: string; proposed_actions?: ProposedAction[] })?.reply ?? '(no response)';
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
          content: `⚠️ ${msg}. If you haven't deployed the crm-assistant edge function yet, deploy it from supabase/functions/crm-assistant and set ANTHROPIC_API_KEY.`,
        }));
    } finally {
      setBusy(false);
    }
  };

  const handleAction = async (action: ProposedAction) => {
    const result = await runAction(action);
    if (result.ok && result.created) {
      setLastEntity(result.created as { type: AttachmentEntityType; id: string; label: string });
    }
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
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally { setUploadPct(null); }
  };

  return (
    <Card>
      <CardContent className="p-0 flex flex-col h-[calc(100vh-14rem)] min-h-[24rem]">
        <div className="flex items-center justify-between px-4 py-2 border-b">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-indigo-500" />
            <span className="font-semibold text-sm">CRM Assistant</span>
            <Badge variant="outline" className="text-[10px] capitalize">{role}</Badge>
          </div>
          <span className="text-[10px] text-muted-foreground">Claude · read-only by default · writes require confirmation</span>
        </div>

        <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
          {messages.map((m) => (
            <div key={m.id} className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
              <div
                className={cn(
                  'max-w-[80%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap break-words',
                  m.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-muted',
                  m.pending && 'opacity-60',
                )}
              >
                {m.pending ? (
                  <span className="inline-flex items-center gap-1.5">
                    <Loader2 className="w-3 h-3 animate-spin" /> {m.content}
                  </span>
                ) : (
                  m.content
                )}
                {m.proposedActions && m.proposedActions.length > 0 && (
                  <div className="mt-2 flex flex-col gap-1.5">
                    {m.proposedActions.map((a, i) => {
                      const id = `${a.type}-${JSON.stringify(a.payload)}`;
                      const Icon = a.type === 'draft_email' ? Mail
                        : a.type === 'move_deal_stage' ? MoveRight
                        : a.type === 'create_client_task' || a.type === 'create_pm_task' || a.type === 'assign_task' ? ListTodo
                        : CheckCircle2;
                      const allowed = canRunAction(a.type, perms);
                      const disabled = !allowed;
                      return (
                        <div key={i} className="rounded-md border bg-card/80 px-2 py-1.5 flex items-center gap-2 text-foreground">
                          <Icon className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                          <span className="text-xs flex-1 min-w-0 truncate">{a.label}</span>
                          {disabled ? (
                            <span className="inline-flex items-center gap-1 text-[10px] text-amber-600">
                              <AlertTriangle className="w-3 h-3" /> no access
                            </span>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-6 text-[11px] px-2"
                              disabled={actingActionId === id}
                              onClick={() => void handleAction(a)}
                            >
                              {actingActionId === id ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Confirm'}
                            </Button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="border-t p-3 space-y-2 shrink-0">
          {messages.length <= 1 && (
            <div className="flex flex-wrap gap-1.5">
              {QUICK_PROMPTS.map((q) => (
                <button
                  key={q.label}
                  type="button"
                  onClick={() => void send(q.prompt)}
                  className="text-[11px] px-2 py-1 rounded border border-dashed hover:border-primary hover:bg-primary/5 text-muted-foreground hover:text-foreground"
                  disabled={busy}
                >
                  {q.label}
                </button>
              ))}
            </div>
          )}
          <div className="flex gap-2 items-end">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              placeholder='e.g. "What deals are stuck in proposal?" or "Draft a follow-up for the Acme deal"'
              rows={2}
              className="flex-1 resize-none rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
              disabled={busy}
            />
            <input ref={fileRef} type="file" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void onPickFile(f); e.currentTarget.value = ""; }} />
            <Button type="button" size="sm" variant="outline" disabled={busy || uploadPct !== null} onClick={() => fileRef.current?.click()} title="Attach a file to the last record">
              {uploadPct !== null ? <span className="text-[11px]">{uploadPct}%</span> : <Paperclip className="w-4 h-4" />}
            </Button>
            <Button onClick={() => void send()} disabled={busy || !input.trim()} size="sm">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
