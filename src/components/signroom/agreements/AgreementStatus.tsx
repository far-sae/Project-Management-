import React from 'react';
import { StatusPill } from '@/components/common/StatusPill';
import { progressLabel, statusTone } from '@/lib/signroom/agreementFormat';
import type { AgreementSummary, Participant } from '../../../../api/_signroom/shared/types';

/** Where an agreement stands: Draft, Awaiting signatures, Finalising, Completed, Declined, Cancelled or Expired. */
export const AgreementStatusPill: React.FC<{ status: AgreementSummary['status']; className?: string }> = ({ status, className }) => (
  <StatusPill tone={statusTone(status)} pulse={status === 'Finalising'} className={className}>{status}</StatusPill>
);

/** How far one recipient is, or that they only receive a copy at the end. */
export const RecipientPill: React.FC<{ participant: Pick<Participant, 'role' | 'progress'> }> = ({ participant }) => (
  <StatusPill tone={participant.role === 'copy' ? 'muted' : statusTone(participant.progress)}>
    {progressLabel(participant)}
  </StatusPill>
);

/** "In Trash" or "Archived", when the agreement has been put away. */
export const PutAwayNote: React.FC<{ agreement: Pick<AgreementSummary, 'trashedAt' | 'archivedAt'> }> = ({ agreement }) => (
  agreement.trashedAt
    ? <span className="text-xs text-muted-foreground">In Trash</span>
    : agreement.archivedAt
      ? <span className="text-xs text-muted-foreground">Archived</span>
      : null
);
