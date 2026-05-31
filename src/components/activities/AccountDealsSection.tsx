import React, { useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { Briefcase, Loader2, ExternalLink } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
  getOrganizationDeals, type Deal, DEAL_STAGES,
} from '@/services/supabase/deals';
import { useFormatMoney } from '@/hooks/useFormatMoney';

interface AccountDealsSectionProps {
  organizationId: string | null;
  /** Show every deal whose client_id matches. Pass null when the
   *  contact has no parent account — section renders a clear hint
   *  explaining why deals can't be linked. */
  clientId: string | null;
  /** Display label shown in the empty state. */
  entityLabel?: string;
}

const STAGE_LOOKUP = Object.fromEntries(DEAL_STAGES.map((s) => [s.id, s]));

/**
 * Lists every deal whose `client_id` matches the supplied clientId.
 * Used on the Contact drawer (Deals on the parent account) and on the
 * Account drawer (deals on the account itself). Read-only summary —
 * click-through to a dedicated deal page is a future enhancement;
 * for now the section just makes the deals VISIBLE instead of the
 * dead "future build" message that was there before.
 */
export const AccountDealsSection: React.FC<AccountDealsSectionProps> = ({
  organizationId, clientId, entityLabel = 'this record',
}) => {
  const [deals, setDeals] = useState<Deal[]>([]);
  const [loading, setLoading] = useState(false);
  const fmtMoney = useFormatMoney();

  useEffect(() => {
    if (!organizationId || !clientId) { setDeals([]); return; }
    setLoading(true);
    getOrganizationDeals(organizationId)
      .then((all) => setDeals(all.filter((d) => d.clientId === clientId)))
      .catch(() => setDeals([]))
      .finally(() => setLoading(false));
  }, [organizationId, clientId]);

  const { open, closed } = useMemo(() => {
    const o: Deal[] = []; const c: Deal[] = [];
    for (const d of deals) {
      if (d.stage === 'won' || d.stage === 'lost') c.push(d);
      else o.push(d);
    }
    return { open: o, closed: c };
  }, [deals]);

  return (
    <div>
      <h3 className="text-sm font-semibold flex items-center gap-2 border-b pb-1.5 mb-2">
        <Briefcase className="w-4 h-4 text-muted-foreground" /> Deals
        <span className="text-[11px] text-muted-foreground font-normal">
          ({deals.length})
        </span>
      </h3>

      {!clientId ? (
        <p className="text-xs text-muted-foreground">
          Deals link to the parent account — connect {entityLabel} to an account to see related deals here.
        </p>
      ) : loading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground py-3">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading deals…
        </div>
      ) : deals.length === 0 ? (
        <p className="text-xs text-muted-foreground">No deals on this account yet.</p>
      ) : (
        <div className="space-y-2.5">
          {open.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Open ({open.length})
              </p>
              {open.map((d) => <DealRow key={d.dealId} deal={d} fmtMoney={fmtMoney} />)}
            </div>
          )}
          {closed.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Closed ({closed.length})
              </p>
              {closed.map((d) => <DealRow key={d.dealId} deal={d} fmtMoney={fmtMoney} />)}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const DealRow: React.FC<{
  deal: Deal;
  fmtMoney: (amount: number, currency?: string | null) => string;
}> = ({ deal, fmtMoney }) => {
  const stage = STAGE_LOOKUP[deal.stage];
  return (
    <div className="rounded-md border px-2.5 py-1.5 flex items-center gap-2 hover:bg-muted/30 transition-colors">
      <span
        className="w-1.5 h-1.5 rounded-full shrink-0"
        style={{ background: stage?.color ?? '#999' }}
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium truncate">{deal.title}</p>
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <Badge variant="outline" className="text-[9px] px-1 py-0">{stage?.label ?? deal.stage}</Badge>
          {deal.expectedCloseDate && (
            <span>· closes {format(deal.expectedCloseDate, 'MMM d')}</span>
          )}
          {deal.ownerName && <span>· {deal.ownerName}</span>}
        </div>
      </div>
      <div className="text-right shrink-0">
        <p className="text-sm font-semibold tabular-nums">
          {fmtMoney(deal.value, deal.currency)}
        </p>
        <p className="text-[10px] text-muted-foreground">{deal.probability}%</p>
      </div>
      <ExternalLink className="w-3 h-3 text-muted-foreground/60" />
    </div>
  );
};
