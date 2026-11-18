import React from 'react';
import { PageHeader } from '@/components/common/PageHeader';
import type { UseLeave } from '@/hooks/useLeave';
import { HrSetupNotice } from './HrSetupNotice';
import type { HrPerson } from './types';

export interface HrLeaveTabProps {
  people: HrPerson[];
  leave: UseLeave;
}

/** PLACEHOLDER — replaced by the real leave tab. */
export const HrLeaveTab: React.FC<HrLeaveTabProps> = ({ leave }) => (
  <>
    <PageHeader title="Leave" description="Time off requests, yearly balances and public holidays." />
    {leave.setupMissing && <HrSetupNotice feature="Leave" onRetry={() => void leave.refresh()} />}
  </>
);

export default HrLeaveTab;
