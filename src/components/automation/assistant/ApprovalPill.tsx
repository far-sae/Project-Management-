// "Automatic", "Needs approval" or "May need approval" for one step, with the reason as its hint.
import React from 'react';
import { approvalReading } from '@/lib/automation/draft';
import { StatusPill, type StatusTone } from '@/components/common/StatusPill';
import type { Autonomy, DraftAgent } from '../../../../api/_automation/shared/types';

const TONE: Record<ReturnType<typeof approvalReading>['kind'], StatusTone> = {
  automatic: 'neutral',
  needs: 'warning',
  may: 'info',
};

export const ApprovalPill: React.FC<{
  agent: Pick<DraftAgent, 'rights' | 'askFirst'>;
  /** The workspace's rule on how much agents may do alone, when it could be read. */
  autonomy?: Autonomy | null;
}> = ({ agent, autonomy }) => {
  const reading = approvalReading(agent, autonomy);
  return <StatusPill tone={TONE[reading.kind]} dot={false} title={reading.why}>{reading.label}</StatusPill>;
};

export default ApprovalPill;
