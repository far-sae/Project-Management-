import React, { useEffect, useState } from 'react';
import { format } from 'date-fns';
import {
  X, Edit, Trash2, Loader2, MessageSquare, Mailbox, PhoneCall,
  Calendar as CalendarIcon, FileText, Briefcase, Building2, ExternalLink,
  TrendingUp, Target, User, Globe, MapPin,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/context/AuthContext';
import {
  Client, ClientNote, ClientNoteKind,
  createNote, deleteNote, getDealNotes,
} from '@/services/supabase/clients';
import {
  Deal, DEAL_STAGES, formatDealMoney,
} from '@/services/supabase/deals';
import type { PipelineStage } from '@/services/supabase/pipelines';
import { ActivityTimeline } from './ActivityTimeline';
import {
  Quote, listQuotesForDeal, deleteQuote,
} from '@/services/supabase/quotes';
import { QuoteBuilderDialog } from './QuoteBuilderDialog';

type DealTab = 'activity' | 'notes' | 'emails' | 'calls' | 'meetings' | 'tasks';

const KIND_FOR_TAB: Partial<Record<DealTab, ClientNoteKind>> = {
  notes: 'note',
  calls: 'call',
  emails: 'email',
  meetings: 'meeting',
  tasks: 'task',
};

interface Props {
  deal: Deal | null;
  client: Client | null;
  organizationId: string | null;
  canManage: boolean;
  onClose: () => void;
  onEdit: (deal: Deal) => void;
  onDelete: (deal: Deal) => void;
  /** Navigate to the linked client's full record. */
  onOpenClient?: (client: Client) => void;
  /** Stages of the deal's pipeline, in position order. Used by the Path. */
  pipelineStages?: PipelineStage[];
  /** Called when the user taps a stage chip in the Path. */
  onStageChange?: (deal: Deal, stage: PipelineStage) => Promise<void> | void;
}

const stageInfo = (stage: string) =>
  DEAL_STAGES.find((s) => s.id === stage) ?? DEAL_STAGES[0];

export const DealDetailDrawer: React.FC<Props> = ({
  deal, client, organizationId, canManage, onClose, onEdit, onDelete, onOpenClient,
  pipelineStages, onStageChange,
}) => {
  const { user } = useAuth();
  const [tab, setTab] = useState<DealTab>('activity');
  const [notes, setNotes] = useState<ClientNote[]>([]);
  const [loading, setLoading] = useState(false);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [openQuoteBuilder, setOpenQuoteBuilder] = useState(false);
  const [editingQuote, setEditingQuote] = useState<Quote | null>(null);

  const reloadQuotes = async () => {
    if (!deal || !organizationId) return;
    setQuotes(await listQuotesForDeal(organizationId, deal.dealId));
  };
  useEffect(() => {
    if (!deal || !organizationId) {
      setQuotes([]);
      return;
    }
    void reloadQuotes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deal?.dealId, organizationId]);

  // Notes are scoped to this specific deal via client_notes.deal_id
  // (migration 089). The composer below writes new notes with both
  // client_id (from the linked client) and deal_id so they show up here
  // AND on the client's own timeline.
  const reloadDealNotes = async () => {
    if (!deal || !organizationId) return;
    setNotes(await getDealNotes(organizationId, deal.dealId));
  };
  useEffect(() => {
    if (!deal || !organizationId) return;
    setLoading(true);
    let cancelled = false;
    getDealNotes(organizationId, deal.dealId)
      .then((n) => { if (!cancelled) setNotes(n); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [deal?.dealId, organizationId]);

  if (!deal || !organizationId) return null;

  const stage = stageInfo(deal.stage);
  const quickAction = (target: DealTab) => () => setTab(target);

  return (
    <div className="fixed inset-0 z-50 flex" role="dialog" aria-modal="true">
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-[1px]"
        onClick={onClose}
        aria-hidden
      />
      <aside className="relative ml-auto h-full w-full sm:w-[95vw] sm:max-w-[1400px] bg-background border-l border-border shadow-xl flex flex-col animate-in slide-in-from-right-2 duration-200">
        {/* Top bar */}
        <div className="px-4 py-3 border-b border-border flex items-center gap-3 bg-card">
          <button
            type="button"
            onClick={onClose}
            className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
          >
            <X className="w-4 h-4" /> Close
          </button>
          <div className="h-5 w-px bg-border" />
          <div className="flex items-center gap-2 min-w-0">
            <Briefcase className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm font-medium text-foreground truncate">Deals</span>
            <span className="text-sm text-muted-foreground">/</span>
            <span className="text-sm font-semibold text-foreground truncate">{deal.title}</span>
          </div>
          <div className="ml-auto flex items-center gap-1">
            {canManage && (
              <>
                <Button variant="outline" size="sm" onClick={() => onEdit(deal)}>
                  <Edit className="w-3.5 h-3.5 mr-1" /> Edit
                </Button>
                <Button
                  variant="ghost" size="sm"
                  className="text-destructive hover:text-destructive"
                  onClick={() => onDelete(deal)}
                >
                  <Trash2 className="w-3.5 h-3.5 mr-1" /> Delete
                </Button>
              </>
            )}
          </div>
        </div>

        {/* Path — Salesforce-style horizontal stage stepper. Renders only
            when pipelineStages is provided. Each chevron is clickable in
            admin mode; tapping advances/regresses the deal via the same
            update path the kanban uses. */}
        {pipelineStages && pipelineStages.length > 0 && (
          <PathStepper
            deal={deal}
            stages={pipelineStages}
            canManage={canManage}
            onStageChange={onStageChange}
          />
        )}

        {/* 3-column body */}
        <div className="flex-1 overflow-hidden grid grid-cols-1 lg:grid-cols-[320px_minmax(0,1fr)_320px]">
          {/* LEFT: identity + quick actions + about */}
          <aside className="border-r border-border bg-card/40 overflow-y-auto p-4 space-y-4">
            <div className="flex flex-col items-center text-center">
              <div
                className="w-16 h-16 rounded-2xl flex items-center justify-center text-base font-bold"
                style={{ backgroundColor: `${stage.color}22`, color: stage.color }}
              >
                <Briefcase className="w-7 h-7" />
              </div>
              <h2 className="mt-3 text-lg font-bold truncate w-full" title={deal.title}>
                {deal.title}
              </h2>
              <div className="mt-1 text-2xl font-extrabold text-foreground">
                {formatDealMoney(deal.value, deal.currency)}
              </div>
              <div className="flex items-center gap-1 flex-wrap justify-center mt-2">
                <Badge
                  className="text-[10px] border-transparent"
                  style={{ backgroundColor: `${stage.color}22`, color: stage.color }}
                >
                  {stage.label}
                </Badge>
                <Badge variant="outline" className="text-[10px]">
                  <Target className="w-3 h-3 mr-0.5" /> {deal.probability}%
                </Badge>
              </div>
            </div>

            {/* Quick actions row */}
            <div className="flex items-center justify-center gap-2 pt-1">
              <QuickAction icon={MessageSquare} label="Note" onClick={quickAction('notes')} />
              <QuickAction
                icon={Mailbox} label="Email"
                href={client?.email ? `mailto:${client.email}` : undefined}
                onClick={quickAction('emails')}
              />
              <QuickAction
                icon={PhoneCall} label="Call"
                href={client?.phone ? `tel:${client.phone}` : undefined}
                onClick={quickAction('calls')}
              />
              <QuickAction icon={FileText} label="Task" onClick={quickAction('tasks')} />
              <QuickAction icon={CalendarIcon} label="Meeting" onClick={quickAction('meetings')} />
            </div>

            <div className="border-t border-border pt-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                About this deal
              </h3>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <Field icon={TrendingUp} label="Value" value={formatDealMoney(deal.value, deal.currency)} />
                <Field icon={Target} label="Probability" value={`${deal.probability}%`} />
                <Field
                  icon={CalendarIcon}
                  label="Expected close"
                  value={deal.expectedCloseDate ? format(deal.expectedCloseDate, 'PP') : null}
                />
                <Field
                  icon={CalendarIcon}
                  label={deal.stage === 'won' ? 'Closed (won)' : deal.stage === 'lost' ? 'Closed (lost)' : 'Created'}
                  value={
                    deal.closedAt
                      ? format(deal.closedAt, 'PP')
                      : format(deal.createdAt, 'PP')
                  }
                />
                <Field icon={User} label="Owner" value={deal.ownerName} />
                <Field icon={Briefcase} label="Source" value={deal.source} />
                <Field icon={Building2} label="Client" value={deal.clientName || client?.name} />
                <Field icon={Globe} label="Currency" value={deal.currency} />
              </div>

              {deal.lossReason && (
                <div className="mt-3 rounded-md bg-rose-500/10 border border-rose-500/30 p-2 text-xs">
                  <div className="font-semibold text-rose-600 dark:text-rose-400 mb-0.5">
                    Loss reason
                  </div>
                  <div className="text-foreground/90">{deal.lossReason}</div>
                </div>
              )}

              {deal.tags && deal.tags.length > 0 && (
                <div className="mt-3">
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Tags</div>
                  <div className="flex flex-wrap gap-1">
                    {deal.tags.map((t) => (
                      <Badge key={t} variant="secondary" className="text-[10px]">{t}</Badge>
                    ))}
                  </div>
                </div>
              )}

              {deal.description && (
                <div className="mt-3">
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Description</div>
                  <p className="text-xs text-foreground/85 whitespace-pre-wrap leading-relaxed">
                    {deal.description}
                  </p>
                </div>
              )}
            </div>
          </aside>

          {/* MIDDLE: activity timeline */}
          <section className="flex flex-col overflow-hidden">
            <Tabs value={tab} onValueChange={(v) => setTab(v as DealTab)} className="px-4 pt-3">
              <TabsList className="bg-transparent border-b border-border rounded-none w-full justify-start gap-1 h-auto p-0">
                {([
                  { v: 'activity', label: 'Activity' },
                  { v: 'notes', label: 'Notes' },
                  { v: 'emails', label: 'Emails' },
                  { v: 'calls', label: 'Calls' },
                  { v: 'tasks', label: 'Tasks' },
                  { v: 'meetings', label: 'Meetings' },
                ] as const).map((t) => (
                  <TabsTrigger
                    key={t.v}
                    value={t.v}
                    className="rounded-none border-b-2 border-transparent data-[state=active]:border-orange-500 data-[state=active]:bg-transparent px-3 pb-2"
                  >
                    {t.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>

            <div className="flex-1 overflow-y-auto p-4">
              {loading && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground mb-3">
                  <Loader2 className="w-4 h-4 animate-spin" /> Loading…
                </div>
              )}

              {tab === 'activity' && (
                <ActivityTimeline
                  clientId={client?.clientId}
                  emptyHint={
                    client
                      ? `No activity for ${client.name} yet. Stage moves, notes, and tasks against this deal will appear here.`
                      : 'Link this deal to a client to see activity here.'
                  }
                />
              )}

              {tab !== 'activity' && (
                <DealNoteSection
                  deal={deal}
                  client={client}
                  organizationId={organizationId}
                  userId={user?.userId}
                  userName={user?.displayName}
                  canManage={canManage}
                  notes={notes}
                  kindFilter={KIND_FOR_TAB[tab]}
                  onChanged={reloadDealNotes}
                />
              )}
            </div>
          </section>

          {/* RIGHT: linked client */}
          <aside className="border-l border-border bg-card/40 overflow-y-auto p-4 space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Linked client
            </h3>
            {client ? (
              <div className="rounded-md border border-border bg-card p-3 space-y-2">
                <div className="flex items-start gap-2">
                  <div className="w-9 h-9 rounded-md bg-primary-soft text-primary-soft-foreground flex items-center justify-center shrink-0">
                    <Building2 className="w-4 h-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold truncate">{client.name}</div>
                    <div className="text-xs text-muted-foreground truncate">
                      {client.industry || client.type}
                    </div>
                  </div>
                </div>
                <div className="space-y-1 text-xs">
                  {client.email && (
                    <a
                      href={`mailto:${client.email}`}
                      className="flex items-center gap-2 text-foreground/85 hover:text-foreground"
                    >
                      <Mailbox className="w-3 h-3 text-muted-foreground" />
                      {client.email}
                    </a>
                  )}
                  {client.phone && (
                    <a
                      href={`tel:${client.phone}`}
                      className="flex items-center gap-2 text-foreground/85 hover:text-foreground"
                    >
                      <PhoneCall className="w-3 h-3 text-muted-foreground" />
                      {client.phone}
                    </a>
                  )}
                  {client.country && (
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <MapPin className="w-3 h-3" />
                      {[client.city, client.country].filter(Boolean).join(', ')}
                    </div>
                  )}
                </div>
                {onOpenClient && (
                  <Button
                    variant="outline" size="sm" className="w-full"
                    onClick={() => onOpenClient(client)}
                  >
                    Open client <ExternalLink className="w-3 h-3 ml-1" />
                  </Button>
                )}
              </div>
            ) : (
              <div className="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
                No client linked to this deal yet.
              </div>
            )}

            {client?.tags && client.tags.length > 0 && (
              <div>
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
                  Client tags
                </div>
                <div className="flex flex-wrap gap-1">
                  {client.tags.slice(0, 8).map((t) => (
                    <Badge key={t} variant="secondary" className="text-[10px]">{t}</Badge>
                  ))}
                </div>
              </div>
            )}

            <div className="pt-2 border-t border-border">
              <div className="flex items-center justify-between mb-1.5">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Quotes ({quotes.length})
                </h3>
                {canManage && (
                  <Button
                    type="button" size="sm" variant="outline"
                    onClick={() => { setEditingQuote(null); setOpenQuoteBuilder(true); }}
                  >
                    <FileText className="w-3.5 h-3.5 mr-1" /> New
                  </Button>
                )}
              </div>
              {quotes.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No quotes yet. Create one to bundle line items and send a
                  PDF proposal.
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {quotes.map((q) => (
                    <li
                      key={q.quoteId}
                      className="rounded-md border p-2 text-xs hover:bg-muted/30 cursor-pointer"
                      onClick={() => { setEditingQuote(q); setOpenQuoteBuilder(true); }}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium truncate">{q.quoteNumber}</span>
                        <Badge variant="outline" className="text-[9px] capitalize">{q.status}</Badge>
                      </div>
                      <div className="text-[11px] text-muted-foreground truncate">{q.title}</div>
                      <div className="flex items-center justify-between mt-1">
                        <span className="text-[11px] tabular-nums">{formatDealMoney(q.total, q.currency)}</span>
                        {canManage && (
                          <button
                            type="button"
                            onClick={async (e) => {
                              e.stopPropagation();
                              if (!organizationId) return;
                              if (!confirm(`Delete quote ${q.quoteNumber}?`)) return;
                              try {
                                await deleteQuote(organizationId, q.quoteId);
                                await reloadQuotes();
                              } catch (err) {
                                toast.error(err instanceof Error ? err.message : 'Delete failed');
                              }
                            }}
                            className="text-muted-foreground hover:text-destructive"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </aside>
        </div>
      </aside>

      {deal && organizationId && (
        <QuoteBuilderDialog
          open={openQuoteBuilder}
          onOpenChange={(o) => {
            setOpenQuoteBuilder(o);
            if (!o) setEditingQuote(null);
          }}
          organizationId={organizationId}
          deal={deal}
          client={client}
          existing={editingQuote}
          onSaved={() => void reloadQuotes()}
        />
      )}
    </div>
  );
};

// ── Tiny helpers ───────────────────────────────────────────────────────────

const Field: React.FC<{
  icon?: React.ComponentType<{ className?: string }>;
  label: string;
  value: React.ReactNode;
}> = ({ icon: Icon, label, value }) => (
  <div className="min-w-0">
    <div className="text-[10px] uppercase tracking-wide text-muted-foreground flex items-center gap-1">
      {Icon && <Icon className="w-3 h-3" />}
      {label}
    </div>
    <div className="text-foreground truncate">{value ?? <span className="text-muted-foreground">—</span>}</div>
  </div>
);

const QuickAction: React.FC<{
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick?: () => void;
  href?: string;
}> = ({ icon: Icon, label, onClick, href }) => {
  const Inner = (
    <span className="flex flex-col items-center gap-1">
      <span className="h-9 w-9 rounded-full bg-orange-500/15 text-orange-600 dark:text-orange-400 grid place-items-center transition-colors hover:bg-orange-500/25">
        <Icon className="w-4 h-4" />
      </span>
      <span className="text-[10px] text-muted-foreground">{label}</span>
    </span>
  );
  if (href) return <a href={href} aria-label={label}>{Inner}</a>;
  return (
    <button type="button" onClick={onClick} aria-label={label}>{Inner}</button>
  );
};

export default DealDetailDrawer;

// ── Path stepper (Salesforce-style horizontal stage progression) ─────────

const PathStepper: React.FC<{
  deal: Deal;
  stages: PipelineStage[];
  canManage: boolean;
  onStageChange?: (deal: Deal, stage: PipelineStage) => Promise<void> | void;
}> = ({ deal, stages, canManage, onStageChange }) => {
  const [busy, setBusy] = useState<string | null>(null);
  const sorted = [...stages].sort((a, b) => a.position - b.position);
  const currentIndex = sorted.findIndex((s) => s.stageId === deal.stageId);

  const tap = async (s: PipelineStage) => {
    if (!canManage || !onStageChange || s.stageId === deal.stageId) return;
    setBusy(s.stageId);
    try {
      await onStageChange(deal, s);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="px-4 py-2 border-b border-border bg-card overflow-x-auto">
      <div className="flex items-center gap-0.5 min-w-max">
        {sorted.map((s, i) => {
          const isCurrent = s.stageId === deal.stageId;
          const isPast = currentIndex > -1 && i < currentIndex;
          const isLast = i === sorted.length - 1;
          const isFirst = i === 0;

          // Color logic — past = accent, current = solid accent, future = muted.
          let bg = '#f1f5f9';      // slate-100
          let fg = '#64748b';      // slate-500
          if (isCurrent) {
            bg = s.color || '#f97316';
            fg = '#ffffff';
          } else if (isPast) {
            bg = `${s.color || '#f97316'}33`;
            fg = s.color || '#f97316';
          }

          return (
            <button
              key={s.stageId}
              type="button"
              disabled={!canManage || !onStageChange || isCurrent || busy !== null}
              onClick={() => tap(s)}
              title={isCurrent ? `${s.label} (current)` : canManage ? `Move to ${s.label}` : s.label}
              className={`
                relative h-9 px-4 text-xs font-semibold transition-colors
                ${isFirst ? 'rounded-l-md' : ''}
                ${isLast ? 'rounded-r-md' : ''}
                ${!isLast ? 'pr-6' : ''}
                ${!isFirst ? 'pl-6' : ''}
                ${canManage && !isCurrent && onStageChange ? 'cursor-pointer hover:opacity-90' : 'cursor-default'}
                ${busy === s.stageId ? 'opacity-60' : ''}
              `}
              style={{
                backgroundColor: bg,
                color: fg,
                clipPath: !isLast
                  ? `polygon(0 0, calc(100% - 12px) 0, 100% 50%, calc(100% - 12px) 100%, 0 100%, ${isFirst ? '0' : '12px'} 50%)`
                  : isFirst
                    ? undefined
                    : `polygon(0 0, 100% 0, 100% 100%, 0 100%, 12px 50%)`,
              }}
            >
              <span className="flex items-center gap-1.5">
                {isCurrent && <span className="text-[10px]">●</span>}
                {s.label}
              </span>
            </button>
          );
        })}
      </div>
      {canManage && onStageChange && (
        <div className="text-[10px] text-muted-foreground mt-1">
          Tap a stage to move the deal there.
        </div>
      )}
    </div>
  );
};

// ── Per-deal note composer + feed ─────────────────────────────────────────

const DealNoteSection: React.FC<{
  deal: Deal;
  client: Client | null;
  organizationId: string;
  userId: string | undefined;
  userName: string | undefined;
  canManage: boolean;
  notes: ClientNote[];
  kindFilter?: ClientNoteKind;
  onChanged: () => Promise<void> | void;
}> = ({ deal, client, organizationId, userId, userName, canManage, notes, kindFilter, onChanged }) => {
  const [kind, setKind] = useState<ClientNoteKind>(kindFilter ?? 'note');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (kindFilter) setKind(kindFilter);
  }, [kindFilter]);

  const visible = kindFilter ? notes.filter((n) => n.kind === kindFilter) : notes;
  const canCompose = !!userId && !!client; // need a linked client to write client_id

  const submit = async () => {
    if (!userId || !userName || !client) return;
    if (!subject.trim() && !body.trim()) {
      toast.error('Write something to log');
      return;
    }
    setSubmitting(true);
    try {
      await createNote(organizationId, client.clientId, userId, userName, {
        kind,
        subject: subject.trim() || null,
        body: body.trim() || null,
        occurredAt: new Date(),
        dealId: deal.dealId,
      });
      setSubject('');
      setBody('');
      if (!kindFilter) setKind('note');
      await onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to log');
    } finally {
      setSubmitting(false);
    }
  };

  const remove = async (n: ClientNote) => {
    if (!confirm('Delete this entry?')) return;
    try {
      await deleteNote(organizationId, n.noteId);
      await onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete');
    }
  };

  const canDelete = (n: ClientNote) => canManage || n.authorId === userId;

  return (
    <div className="space-y-3">
      {canCompose && (
        <div className="border rounded-md p-3 space-y-2 bg-secondary/30">
          <div className="flex gap-2">
            {!kindFilter && (
              <Select value={kind} onValueChange={(v) => setKind(v as ClientNoteKind)}>
                <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="note">Note</SelectItem>
                  <SelectItem value="call">Call</SelectItem>
                  <SelectItem value="meeting">Meeting</SelectItem>
                  <SelectItem value="email">Email</SelectItem>
                  <SelectItem value="task">Task</SelectItem>
                </SelectContent>
              </Select>
            )}
            <Input
              placeholder="Subject (optional)" maxLength={200}
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            />
          </div>
          <Textarea
            placeholder="Details…" rows={3} maxLength={5000}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          <div className="flex justify-end">
            <Button size="sm" onClick={submit} disabled={submitting}>
              {submitting && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
              Log against this deal
            </Button>
          </div>
        </div>
      )}

      {!canCompose && (
        <div className="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
          Link this deal to a client before logging activity.
          <span className="ml-1">Edit the deal to set its client.</span>
        </div>
      )}

      {visible.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {kindFilter
            ? `No ${kindFilter}s logged on this deal yet.`
            : 'No notes logged on this deal yet.'}
        </p>
      ) : (
        <ul className="space-y-2">
          {visible.map((n) => (
            <li key={n.noteId} className="rounded-md border p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="text-xs text-muted-foreground mb-1">
                    {n.authorName ?? 'Someone'} · {format(n.occurredAt, 'PPp')}
                  </div>
                  {n.subject && (
                    <div className="text-sm font-medium mb-0.5">{n.subject}</div>
                  )}
                  {n.body && (
                    <div className="text-sm text-foreground/90 whitespace-pre-wrap leading-relaxed">
                      {n.body}
                    </div>
                  )}
                </div>
                {canDelete(n) && (
                  <button
                    type="button"
                    onClick={() => remove(n)}
                    className="text-muted-foreground hover:text-destructive shrink-0"
                    aria-label="Delete"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
