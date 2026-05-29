import React, { useEffect, useState } from 'react';
import { History, CheckCircle2, Loader2 } from 'lucide-react';
import { format } from 'date-fns';
import {
  DealStageHistoryEntry,
  listAccountStageHistory,
} from '@/services/supabase/dealRelations';
import { DEAL_STAGES, formatDealMoney } from '@/services/supabase/deals';

interface AccountStageHistoryCardProps {
  organizationId: string | null;
  clientId: string;
  currency?: string;
}

/**
 * Cross-deal stage history for an account. Pulls every deal_stage_history
 * row for every deal linked to this account so reps see the trail of
 * stage moves across opportunities they've worked on this customer.
 *
 * Backed by listAccountStageHistory which handles local-org + Supabase.
 */
export const AccountStageHistoryCard: React.FC<AccountStageHistoryCardProps> = ({
  organizationId, clientId, currency = 'USD',
}) => {
  const [rows, setRows] = useState<DealStageHistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!organizationId || !clientId) {
      setRows([]);
      return;
    }
    setLoading(true);
    let cancelled = false;
    listAccountStageHistory(organizationId, clientId)
      .then((next) => { if (!cancelled) setRows(next); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [organizationId, clientId]);

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold inline-flex items-center gap-1.5">
          <History className="w-4 h-4" /> Stage History
        </h3>
        <span className="text-xs text-muted-foreground">{rows.length}</span>
      </div>

      {loading ? (
        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
      ) : rows.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">
          No stage changes yet. Once a deal moves through a stage, the trail will land here.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {rows.map((h) => {
            const from = DEAL_STAGES.find((s) => s.id === h.fromStage)?.label ?? h.fromStage ?? '(new)';
            const to = DEAL_STAGES.find((s) => s.id === h.toStage)?.label ?? h.toStage;
            return (
              <li key={h.historyId} className="text-xs flex flex-wrap items-baseline gap-1.5 py-1 border-b last:border-b-0">
                <CheckCircle2 className="w-3 h-3 text-emerald-500 self-center shrink-0" />
                <span className="font-medium">{from} → {to}</span>
                {h.amount != null && (
                  <span className="text-muted-foreground tabular-nums">
                    · {formatDealMoney(h.amount, currency)}
                  </span>
                )}
                <span className="text-muted-foreground ml-auto">{format(h.changedAt, 'MMM d, yyyy · HH:mm')}</span>
                {h.changedByName && <span className="text-muted-foreground">by {h.changedByName}</span>}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
};
