export type ActivityEntity = 'client' | 'deal' | 'lead';

export interface Activity {
  id: string;
  kind: string;
  category: string;
  title: string;
  relatedToLabel?: string | null;
  ownerUserId?: string | null;
  ownerName?: string | null;
  whenAt: Date | null;
  open: boolean;
  source: { kind: string; row: any };
}

export interface PmTaskRow {
  task_id: string;
  title: string;
  source_deal_id: string | null;
  source_client_id: string | null;
  completed_at: string | null;
  project_id: string;
  organization_id: string;
}

const startOfUtcDay = (date: Date) => Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());

export const isToday = (date: Date, now = new Date()): boolean =>
  startOfUtcDay(date) === startOfUtcDay(now);

export const dayBucket = (date: Date | null, now = new Date()): string => {
  if (!date) return 'Earlier';
  const diffDays = Math.floor((startOfUtcDay(now) - startOfUtcDay(date)) / 86_400_000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays <= 6) return 'This week';
  return 'Earlier';
};

export const isOverdue = (date: Date | null, open: boolean, now = new Date()): boolean =>
  open && !!date && date.getTime() < now.getTime();

export const noteToActivity = (row: any): Activity => ({
  id: `note:${row.id}`,
  kind: 'note',
  category: 'notes',
  title: row.subject || row.body || 'Note added',
  ownerUserId: row.author_id ?? null,
  ownerName: row.author_name ?? null,
  whenAt: row.occurred_at ? new Date(row.occurred_at) : null,
  open: false,
  source: { kind: 'note', row },
});

export const emailToActivity = (row: any): Activity => ({
  id: `email:${row.event_id}`,
  kind: 'email',
  category: 'email',
  title: row.subject || row.snippet || 'Email activity',
  ownerUserId: null,
  whenAt: row.occurred_at ? new Date(row.occurred_at) : null,
  open: false,
  source: { kind: 'email', row },
});

export const pmTaskToActivity = (row: PmTaskRow): Activity => ({
  id: `pm_task:${row.task_id}`,
  kind: 'pm_task',
  category: 'project_tasks',
  title: `Delivery task completed: ${row.title}`,
  whenAt: row.completed_at ? new Date(row.completed_at) : null,
  open: false,
  source: { kind: 'pm_task', row },
});

export const filterByEntity = (activities: Activity[], entity: ActivityEntity, id: string): Activity[] =>
  activities.filter((activity) => {
    const row = activity.source.row;
    if (entity === 'client') {
      return row.client_id === id || row.entity_type === 'client' && row.entity_id === id || row.source_client_id === id;
    }
    if (entity === 'deal') {
      return row.deal_id === id || row.entity_type === 'deal' && row.entity_id === id || row.source_deal_id === id;
    }
    return row.lead_id === id || row.entity_type === 'lead' && row.entity_id === id;
  });

export const buildDealActivity = (input: {
  dealId: string;
  clientId: string | null;
  title: string;
  headline: string;
  detail: string | null;
  whenAt: Date | null;
  eventKey: string;
  ownerName?: string | null;
  relatedToLabel?: string | null;
}): Activity => ({
  id: `deal:${input.dealId}:${input.eventKey}`,
  kind: 'deal',
  category: 'open_deals',
  title: input.headline,
  relatedToLabel: input.relatedToLabel ?? input.detail,
  ownerName: input.ownerName ?? null,
  whenAt: input.whenAt,
  open: false,
  source: {
    kind: 'deal',
    row: { dealId: input.dealId, clientId: input.clientId, title: input.title },
  },
});

export const dealTimelineActivities = (
  deals: any[],
  history: any[],
  helpers: { formatMoney: (value: number, currency?: string) => string; stageLabel: (key: string | null) => string },
): Activity[] => {
  const out: Activity[] = [];
  const dealsById = new Map(deals.map((deal) => [deal.dealId, deal]));
  for (const deal of deals) {
    const isCustom = deal.dealType === 'custom';
    const money = helpers.formatMoney(deal.value, deal.currency);
    out.push(buildDealActivity({
      dealId: deal.dealId,
      clientId: deal.clientId ?? null,
      title: deal.title,
      headline: `${isCustom ? 'Custom item' : 'Deal'} added: ${deal.title}`,
      detail: isCustom ? money : `${helpers.stageLabel(deal.stage)} \u00b7 ${money}`,
      whenAt: deal.createdAt ?? null,
      eventKey: 'created',
    }));
  }
  for (const row of history) {
    if (!row.fromStage) continue;
    const deal = dealsById.get(row.dealId);
    if (!deal) continue;
    out.push(buildDealActivity({
      dealId: deal.dealId,
      clientId: deal.clientId ?? null,
      title: deal.title,
      headline: `${deal.title}: ${helpers.stageLabel(row.fromStage)} \u2192 ${helpers.stageLabel(row.toStage)}`,
      detail: helpers.formatMoney(row.amount, 'USD'),
      whenAt: row.changedAt ?? null,
      eventKey: `stage:${row.historyId}`,
      ownerName: row.changedByName ?? null,
    }));
  }
  return out;
};
