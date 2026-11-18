import React, { useMemo } from 'react';
import { FileCheck } from 'lucide-react';
import { StatusPill } from '@/components/common/StatusPill';
import { cn } from '@/lib/utils';
import type { UseEmployeeDocuments } from '@/hooks/useEmployeeDocuments';
import type { HrPerson } from '../types';
import { formatYmd } from './dates';
import { expiringDocuments } from './overviewStats';
import { BOX_ROW, SectionBox, SectionEmpty, SectionLink, personName, sectionState } from './SectionBox';

/** Documents that have expired or expire within 30 days. */
export const ExpiringDocumentsBox: React.FC<{
  docs: UseEmployeeDocuments;
  peopleById: Map<string, HrPerson>;
  /** Today as `yyyy-MM-dd`. */
  today: string;
  onOpenDocuments: () => void;
}> = ({ docs, peopleById, today, onOpenDocuments }) => {
  const expiring = useMemo(() => expiringDocuments(docs.documents, today), [docs.documents, today]);

  return (
    <SectionBox
      title="Documents expiring soon"
      meta={<SectionLink onClick={onOpenDocuments}>Open Documents</SectionLink>}
    >
      {sectionState(docs) ??
        (expiring.length === 0 ? (
          <SectionEmpty icon={FileCheck} title="No documents expire in the next 30 days." />
        ) : (
          <ul>
            {expiring.map(({ doc, tone, label }) => (
              <li key={doc.id} className={cn(BOX_ROW, 'flex-wrap gap-y-1')}>
                <div className="min-w-0 flex-1 basis-40">
                  <p className="truncate text-sm font-medium text-foreground">{doc.title}</p>
                  <p className="truncate text-xs text-muted-foreground">{personName(peopleById.get(doc.userId))}</p>
                </div>
                <div className="ml-auto flex shrink-0 items-center gap-2">
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {doc.expiresOn ? formatYmd(doc.expiresOn, { year: true }) : ''}
                  </span>
                  <StatusPill tone={tone}>{label}</StatusPill>
                </div>
              </li>
            ))}
          </ul>
        ))}
    </SectionBox>
  );
};
