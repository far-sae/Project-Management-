import React from 'react';
import { PageHeader } from '@/components/common/PageHeader';
import type { UseLeave } from '@/hooks/useLeave';
import type { UseEmployeeDocuments } from '@/hooks/useEmployeeDocuments';
import type { HrPerson, HrTab } from './types';

export interface HrOverviewTabProps {
  people: HrPerson[];
  leave: UseLeave;
  docs: UseEmployeeDocuments;
  /** Jump to another HR tab (e.g. "Review" on pending leave). */
  onOpenTab: (tab: HrTab) => void;
}

/** PLACEHOLDER — replaced by the real overview. */
export const HrOverviewTab: React.FC<HrOverviewTabProps> = () => (
  <PageHeader title="HR overview" description="Headcount, attendance, leave and documents at a glance." />
);

export default HrOverviewTab;
