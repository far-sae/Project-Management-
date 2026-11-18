import React from 'react';
import { PageHeader } from '@/components/common/PageHeader';
import type { UseEmployeeDocuments } from '@/hooks/useEmployeeDocuments';
import { HrSetupNotice } from './HrSetupNotice';
import type { HrPerson } from './types';

export interface HrDocumentsTabProps {
  people: HrPerson[];
  docs: UseEmployeeDocuments;
}

/** PLACEHOLDER — replaced by the real documents tab. */
export const HrDocumentsTab: React.FC<HrDocumentsTabProps> = ({ docs }) => (
  <>
    <PageHeader title="Documents" description="Contracts, ID, letters and certificates for each employee." />
    {docs.setupMissing && <HrSetupNotice feature="Documents" onRetry={() => void docs.refresh()} />}
  </>
);

export default HrDocumentsTab;
