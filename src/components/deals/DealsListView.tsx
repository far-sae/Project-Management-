import React, { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { DEAL_STAGES, Deal, DealStage } from '@/services/supabase/deals';
import { useFormatMoney } from '@/hooks/useFormatMoney';
import { useOrgCurrency } from '@/hooks/useOrgCurrency';

const fmtDate = (d: Date | null | undefined) =>
  d ? d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—';

interface DealsListViewProps {
  deals: Deal[];
  onSelectDeal: (d: Deal) => void;
}

/**
 * Simple flat list view of deals — used when the rep switches off the
 * kanban "STAGEVIEW". Carries the in-list search + stage filter so the
 * kanban (which always shows the full pipeline) doesn't inherit them.
 */
export const DealsListView: React.FC<DealsListViewProps> = ({
  deals, onSelectDeal,
}) => {
  const fmtMoney = useFormatMoney();
  // useFormatMoney now FX-converts at the hook level, so we just need
  // orgCurrency here to drive the "(USD)" original-currency hint when
  // the row and display currencies differ.
  const orgCurrency = useOrgCurrency();
  const [search, setSearch] = useState('');
  const [stageFilter, setStageFilter] = useState<'all' | DealStage>('all');

  const filtered = useMemo(() => {
    let rows = deals;
    if (stageFilter !== 'all') rows = rows.filter((d) => d.stage === stageFilter);
    const q = search.trim().toLowerCase();
    if (q) {
      rows = rows.filter((d) => {
        const hay = [
          d.title, d.clientName, d.ownerName, d.dealType, d.nextStep,
          d.leadSource, d.campaignSource,
        ].filter(Boolean).join(' ').toLowerCase();
        return hay.includes(q);
      });
    }
    return rows;
  }, [deals, stageFilter, search]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-56">
          <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search deals"
            className="pl-7 h-9"
          />
        </div>
        <Select value={stageFilter} onValueChange={(v) => setStageFilter(v as typeof stageFilter)}>
          <SelectTrigger className="w-40 h-9"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All stages</SelectItem>
            {DEAL_STAGES.map((s) => (
              <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="ml-auto text-xs text-muted-foreground">{filtered.length} of {deals.length}</span>
      </div>

      <div className="rounded-md border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left">
            <tr>
              <th className="px-3 py-2 font-medium">Deal Name</th>
              <th className="px-3 py-2 font-medium">Account</th>
              <th className="px-3 py-2 font-medium">Stage</th>
              <th className="px-3 py-2 font-medium text-right">Amount</th>
              <th className="px-3 py-2 font-medium text-right">Probability</th>
              <th className="px-3 py-2 font-medium">Closing Date</th>
              <th className="px-3 py-2 font-medium">Owner</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-muted-foreground text-xs">
                  No deals match your filters.
                </td>
              </tr>
            ) : filtered.map((d) => {
              const stageMeta = DEAL_STAGES.find((s) => s.id === d.stage);
              return (
                <tr
                  key={d.dealId}
                  className="border-t hover:bg-muted/30 cursor-pointer"
                  onClick={() => onSelectDeal(d)}
                >
                  <td className="px-3 py-2 font-medium">{d.title}</td>
                  <td className="px-3 py-2 text-muted-foreground">{d.clientName ?? '—'}</td>
                  <td className="px-3 py-2">
                    <span className="inline-flex items-center gap-1.5 text-xs">
                      <span className="w-2 h-2 rounded-full" style={{ background: stageMeta?.color ?? '#999' }} />
                      {stageMeta?.label ?? d.stage}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {/* useFormatMoney now FX-converts internally — pass
                        the row's native currency and it returns the
                        org-currency amount. The "(USD)" hint stays so
                        the conversion is visible. */}
                    {fmtMoney(d.value, d.currency)}
                    {d.currency && d.currency.toUpperCase() !== orgCurrency.toUpperCase() && (
                      <span className="ml-1 text-[10px] text-muted-foreground" title={`Original: ${d.value} ${d.currency.toUpperCase()}`}>
                        ({d.currency.toUpperCase()})
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{d.probability}%</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{fmtDate(d.expectedCloseDate)}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{d.ownerName ?? '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
