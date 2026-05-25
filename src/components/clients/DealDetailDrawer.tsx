import React, { useEffect, useState } from 'react';
import { format } from 'date-fns';
import {
  X, Edit, Trash2, Loader2, MessageSquare, Mailbox, PhoneCall,
  Calendar as CalendarIcon, FileText, Briefcase, Building2, ExternalLink,
  TrendingUp, Target, User, Globe, MapPin,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/context/AuthContext';
import {
  Client, ClientNote, ClientNoteKind,
  getClientNotes,
} from '@/services/supabase/clients';
import {
  Deal, DEAL_STAGES, formatDealMoney,
} from '@/services/supabase/deals';
import { ActivityTimeline } from './ActivityTimeline';

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
}

const stageInfo = (stage: string) =>
  DEAL_STAGES.find((s) => s.id === stage) ?? DEAL_STAGES[0];

export const DealDetailDrawer: React.FC<Props> = ({
  deal, client, organizationId, canManage, onClose, onEdit, onDelete, onOpenClient,
}) => {
  const { user: _user } = useAuth();
  const [tab, setTab] = useState<DealTab>('activity');
  const [notes, setNotes] = useState<ClientNote[]>([]);
  const [loading, setLoading] = useState(false);

  // Notes for a deal are stored against its linked client (the client_notes
  // table doesn't have a deal_id column today). We filter the client's notes
  // by anything that mentions the deal id in the subject for now; long-term
  // we'd add a deal_id column. For v1 this just surfaces the linked client's
  // recent activity so the right rail isn't empty.
  useEffect(() => {
    if (!deal || !organizationId) return;
    if (!client) {
      setNotes([]);
      return;
    }
    setLoading(true);
    let cancelled = false;
    getClientNotes(organizationId, client.clientId)
      .then((n) => { if (!cancelled) setNotes(n); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [deal?.dealId, client?.clientId, organizationId]);

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
                <div className="space-y-3">
                  {(() => {
                    const wantedKind = KIND_FOR_TAB[tab];
                    const filtered = wantedKind ? notes.filter((n) => n.kind === wantedKind) : notes;
                    if (filtered.length === 0) {
                      return (
                        <div className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
                          {client
                            ? `No ${tab} logged for ${client.name} yet. Open the client record to log activity — it'll show up here automatically.`
                            : 'Link this deal to a client to log activity.'}
                          {client && onOpenClient && (
                            <div className="mt-2">
                              <Button variant="outline" size="sm" onClick={() => onOpenClient(client)}>
                                Open {client.name} <ExternalLink className="w-3 h-3 ml-1" />
                              </Button>
                            </div>
                          )}
                        </div>
                      );
                    }
                    return (
                      <ul className="space-y-2">
                        {filtered.map((n) => (
                          <li key={n.noteId} className="rounded-md border p-3">
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
                          </li>
                        ))}
                      </ul>
                    );
                  })()}
                </div>
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
          </aside>
        </div>
      </aside>
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
