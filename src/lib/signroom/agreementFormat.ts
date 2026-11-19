/**
 * Wording, filters and small rules shared by the agreement screens. Pure: no
 * React, no network. The rules mirror what the documents server enforces, so a
 * button is only offered when the server would accept it.
 */
import type {
  Agreement, AgreementDelivery, AgreementSummary, AgreementTemplateSummary, Participant,
} from '../../../api/_signroom/shared/types';

export type AgreementTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'muted';

/** Agreement times are kept in UTC (a deadline ends at 23:59 UTC), so dates are shown in UTC too. */
export const shortDate = (value: string): string =>
  new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

export const utcDateTime = (value: string): string =>
  `${new Date(value).toLocaleString('en-GB', { timeZone: 'UTC' })} UTC`;

export const initials = (value: string): string =>
  value.trim().split(/\s+/).filter(Boolean).map((part) => part[0]).slice(0, 2).join('').toUpperCase();

/** The status filter, in the order the list offers it. */
export const STATUS_FILTERS = [
  'Awaiting signatures', 'Completed', 'Draft', 'Declined', 'Cancelled', 'Expired',
] as const satisfies readonly Agreement['status'][];

export const statusTone = (status: string): AgreementTone => {
  if (status === 'Completed' || status === 'signed') return 'success';
  if (['Awaiting signatures', 'invited', 'verified', 'viewed'].includes(status)) return 'warning';
  if (status === 'Finalising') return 'info';
  if (['Declined', 'Cancelled', 'Expired', 'declined'].includes(status)) return 'danger';
  return 'neutral';
};

const sentence = (word: string): string => word.charAt(0).toUpperCase() + word.slice(1);

/** What a recipient's pill says: their role if they only get a copy, otherwise how far they are. */
export const progressLabel = (p: Pick<Participant, 'role' | 'progress'>): string =>
  p.role === 'copy' ? 'Completion copy' : sentence(p.progress);

export const sentLabel = (a: Pick<AgreementSummary, 'sentAt' | 'senderReleasePending'>): string =>
  a.senderReleasePending ? 'Not sent to company' : a.sentAt ? shortDate(a.sentAt) : 'Not sent';

export const activityNote = (a: Pick<AgreementSummary, 'status'>): string =>
  a.status === 'Draft' ? 'Draft saved'
    : a.status === 'Completed' ? 'All signatures collected'
      : a.status === 'Awaiting signatures' ? 'Waiting for recipient'
        : a.status;

export const typeHint = (type: string): string =>
  type === 'NDA' ? 'Keep shared information confidential'
    : type === 'Statement of work' ? 'Define scope, deliverables and timing'
      : type === 'Service agreement' ? 'Set out the terms of your services'
        : type === 'Engagement letter' ? 'Confirm the professional engagement'
          : 'Bring your own ordinary agreement';

export type AgreementScope = 'active' | 'archived' | 'trash' | 'all';
export type AgreementSort = 'newest' | 'oldest' | 'title';

export interface AgreementFilter {
  scope?: AgreementScope;
  /** One status, or leave out for every status. */
  status?: string;
  type?: string;
  search?: string;
  /** Created on or after this day (YYYY-MM-DD). */
  from?: string;
  /** Created on or before this day (YYYY-MM-DD). */
  to?: string;
  /** Company names by client id, so the search finds them. */
  clientNames?: Record<string, string>;
}

export function filterAgreements<T extends AgreementSummary>(list: T[], filter: AgreementFilter): T[] {
  const { scope = 'active', status, type, from, to, clientNames = {} } = filter;
  const search = (filter.search ?? '').trim().toLowerCase();
  return list.filter((a) => {
    const inScope = scope === 'trash'
      ? Boolean(a.trashedAt)
      : !a.trashedAt && (scope === 'all' || (scope === 'archived' ? Boolean(a.archivedAt) : !a.archivedAt));
    if (!inScope) return false;
    const day = a.created.slice(0, 10);
    if (from && day < from) return false;
    if (to && day > to) return false;
    if (status && a.status !== status) return false;
    if (type && a.type !== type) return false;
    if (!search) return true;
    const haystack = `${a.title} ${clientNames[a.clientId] ?? ''} ${a.participants.map((p) => `${p.name} ${p.email}`).join(' ')}`;
    return haystack.toLowerCase().includes(search);
  });
}

export function sortAgreements<T extends AgreementSummary>(list: T[], sort: AgreementSort): T[] {
  return [...list].sort((a, b) =>
    sort === 'title' ? a.title.localeCompare(b.title)
      : sort === 'oldest' ? a.updated.localeCompare(b.updated)
        : b.updated.localeCompare(a.updated));
}

export const statusCounts = (list: AgreementSummary[]) => ({
  total: list.length,
  awaiting: list.filter((a) => a.status === 'Awaiting signatures').length,
  completed: list.filter((a) => a.status === 'Completed').length,
  drafts: list.filter((a) => a.status === 'Draft').length,
});

export const signedCount = (a: Pick<AgreementSummary, 'participants'>) => {
  const signers = a.participants.filter((p) => p.role === 'signer');
  return { signed: signers.filter((p) => p.progress === 'signed').length, signers: signers.length };
};

/** The server refuses Trash while signing is active or a legal hold is on. */
export const canTrash = (a: Pick<AgreementSummary, 'status' | 'legalHold'>): boolean =>
  !a.legalHold && !['Awaiting signatures', 'Finalising'].includes(a.status);

/** Retention and legal hold are for the owner, on an agreement that is settled (or still a draft) and not in Trash. */
export const canHold = (a: Pick<AgreementSummary, 'status' | 'trashedAt'>, owner: boolean): boolean =>
  owner && !a.trashedAt && ['Completed', 'Cancelled', 'Declined', 'Expired', 'Draft'].includes(a.status);

/** Statuses that move on without the sender doing anything, so the page keeps checking. */
export const isLive = (status: string): boolean => ['Awaiting signatures', 'Finalising'].includes(status);

/** The state of the last invitation email to one recipient, or null when none was sent. */
export const deliveryState = (deliveries: AgreementDelivery[] | undefined, participantId: string): string | null =>
  deliveries?.filter((d) => d.participantId === participantId).at(-1)?.state.replace(/_/g, ' ') ?? null;

/** Only the newest version of each named template, for one agreement type. */
export const newestTemplates = (templates: AgreementTemplateSummary[], type: string): AgreementTemplateSummary[] =>
  templates.filter((t) => t.type === type && !templates.some((x) => x.name === t.name && x.version > t.version));
