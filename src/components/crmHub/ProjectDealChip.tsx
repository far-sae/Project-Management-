import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Handshake } from 'lucide-react';
import { useOrganization } from '@/context/OrganizationContext';
import { useSubscription } from '@/context/SubscriptionContext';
import { getDealForProject } from '@/services/supabase/crmHub/deals';
import type { CrmDeal } from '@/types/crmHub';

/**
 * Shown in a project's header when the project came from a won deal: one
 * click back to the deal (who the customer is, what was sold). Renders
 * nothing for people without the CRM, or when the project has no deal.
 */
export const ProjectDealChip: React.FC<{ projectId: string }> = ({ projectId }) => {
  const { isViewer } = useOrganization();
  const { hasFeature } = useSubscription();
  const allowed = !isViewer && hasFeature('crm');
  const [deal, setDeal] = useState<CrmDeal | null>(null);

  useEffect(() => {
    setDeal(null);
    if (!allowed || !projectId) return;
    let cancelled = false;
    getDealForProject(projectId)
      .then((found) => { if (!cancelled) setDeal(found); })
      .catch(() => { /* no access to the CRM tables: show nothing */ });
    return () => { cancelled = true; };
  }, [allowed, projectId]);

  if (!deal) return null;
  return (
    <Link
      to={`/crm/deals/${deal.id}`}
      title={`This project came from the won deal “${deal.name}”`}
      className="hidden h-7 max-w-[16rem] items-center gap-1.5 rounded-full border border-border px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-foreground/[0.05] hover:text-foreground md:inline-flex"
    >
      <Handshake className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate">Deal: {deal.name}</span>
    </Link>
  );
};

export default ProjectDealChip;
