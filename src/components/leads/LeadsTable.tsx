import React, { useMemo, useState } from 'react';
import {
  ArrowUp, ArrowDown, ArrowUpDown, User as UserIcon, CheckCircle2,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
  Lead, LeadStatus, leadDisplayName, leadStatusLabel,
} from '@/services/supabase/leads';
import { cn } from '@/lib/utils';

// Bulk-select is intentionally not wired yet. When we add bulk actions
// (Convert selected, Delete selected, Change status), re-introduce the
// checkbox column + onToggleRow/onToggleAll plumbing in parallel with the
// action bar in Clients.tsx so the affordance maps to a real action.

type SortKey =
  | 'leadNumber'
  | 'displayName'
  | 'company'
  | 'email'
  | 'phone'
  | 'leadStatus'
  | 'leadSource'
  | 'leadOwnerName'
  | 'annualRevenue'
  | 'updatedAt';

type SortDir = 'asc' | 'desc';

interface Column {
  key: SortKey;
  label: string;
  align?: 'left' | 'right';
}

const COLUMNS: Column[] = [
  { key: 'leadNumber',     label: 'Lead #' },
  { key: 'displayName',    label: 'Name' },
  { key: 'company',        label: 'Company' },
  { key: 'leadStatus',     label: 'Status' },
  { key: 'leadSource',     label: 'Source' },
  { key: 'leadOwnerName',  label: 'Owner' },
  { key: 'email',          label: 'Email' },
  { key: 'phone',          label: 'Phone' },
  { key: 'annualRevenue',  label: 'Revenue', align: 'right' },
  { key: 'updatedAt',      label: 'Updated', align: 'right' },
];

const STATUS_TONE: Record<LeadStatus, string> = {
  new:                  'bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30',
  attempted_to_contact: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30',
  contacted:            'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
  contact_in_future:    'bg-violet-500/15 text-violet-700 dark:text-violet-300 border-violet-500/30',
  not_contacted:        'bg-muted text-muted-foreground border-border',
  pre_qualified:        'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
  not_qualified:        'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30',
  junk_lead:            'bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/30',
  lost_lead:            'bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/30',
  converted:            'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
};

const compareValues = (a: unknown, b: unknown): number => {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
  return String(a).localeCompare(String(b), undefined, { sensitivity: 'base' });
};

const fmtRevenue = (v: number | null): string => {
  if (v == null) return '—';
  return new Intl.NumberFormat(undefined, {
    notation: v >= 1_000_000 ? 'compact' : 'standard',
    maximumFractionDigits: 0,
  }).format(v);
};

interface LeadsTableProps {
  rows: Lead[];
  onOpen: (lead: Lead) => void;
}

export const LeadsTable: React.FC<LeadsTableProps> = ({ rows, onOpen }) => {
  const [sortKey, setSortKey] = useState<SortKey>('updatedAt');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const handleSort = (key: SortKey) => {
    if (key === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('asc'); }
  };

  const sorted = useMemo(() => {
    const valueFor = (l: Lead): unknown => {
      switch (sortKey) {
        case 'displayName': return leadDisplayName(l);
        default:            return (l as unknown as Record<SortKey, unknown>)[sortKey];
      }
    };
    const copy = [...rows];
    copy.sort((a, b) => {
      const cmp = compareValues(valueFor(a), valueFor(b));
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return copy;
  }, [rows, sortKey, sortDir]);

  const colSpan = COLUMNS.length;

  const SortIcon: React.FC<{ active: boolean; dir: SortDir }> = ({ active, dir }) => {
    if (!active) return <ArrowUpDown className="w-3 h-3 opacity-40" />;
    return dir === 'asc'
      ? <ArrowUp className="w-3 h-3" />
      : <ArrowDown className="w-3 h-3" />;
  };

  return (
    <div className="rounded-md border border-border overflow-auto bg-card max-h-[calc(100vh-22rem)]">
      <table className="w-full border-collapse text-sm">
        <thead className="sticky top-0 z-10 bg-muted/80 backdrop-blur-sm">
          <tr className="border-b border-border">
            {COLUMNS.map((col) => {
              const active = col.key === sortKey;
              return (
                <th
                  key={col.key}
                  className={cn(
                    'px-2 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground select-none',
                    col.align === 'right' && 'text-right',
                    !col.align && 'text-left',
                  )}
                >
                  <button
                    type="button"
                    onClick={() => handleSort(col.key)}
                    className={cn(
                      'inline-flex items-center gap-1 hover:text-foreground transition-colors',
                      active && 'text-foreground',
                    )}
                  >
                    {col.label}
                    <SortIcon active={active} dir={sortDir} />
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 ? (
            <tr>
              <td colSpan={colSpan} className="px-3 py-8 text-center text-sm text-muted-foreground">
                No leads match the current filters.
              </td>
            </tr>
          ) : (
            sorted.map((l) => {
              const isConverted = l.leadStatus === 'converted';
              return (
                <tr
                  key={l.leadId}
                  onClick={() => onOpen(l)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(l); }
                  }}
                  tabIndex={0}
                  className={cn(
                    'border-b border-border/60 cursor-pointer outline-none',
                    'hover:bg-muted/50 focus:bg-muted/60',
                    isConverted && 'opacity-75',
                  )}
                >
                  <td className="px-2 py-1.5 align-middle">
                    <span className="text-xs font-mono text-muted-foreground">{l.leadNumber}</span>
                  </td>
                  <td className="px-2 py-1.5 align-middle">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="w-6 h-6 rounded-full bg-orange-500/15 text-orange-600 grid place-items-center shrink-0">
                        <UserIcon className="w-3.5 h-3.5" />
                      </span>
                      <span className="font-medium truncate max-w-[200px]">{leadDisplayName(l)}</span>
                      {isConverted && (
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                      )}
                    </div>
                    {l.title && (
                      <div className="text-[10px] text-muted-foreground ml-8 truncate max-w-[200px]">
                        {l.title}
                      </div>
                    )}
                  </td>
                  <td className="px-2 py-1.5 align-middle">
                    <span className="text-sm truncate max-w-[200px] inline-block">{l.company}</span>
                  </td>
                  <td className="px-2 py-1.5 align-middle">
                    <Badge className={cn('text-[10px]', STATUS_TONE[l.leadStatus])}>
                      {leadStatusLabel(l.leadStatus)}
                    </Badge>
                  </td>
                  <td className="px-2 py-1.5 align-middle text-xs truncate max-w-[140px]">
                    {l.leadSource ?? <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="px-2 py-1.5 align-middle text-xs truncate max-w-[160px]">
                    {l.leadOwnerName ?? <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="px-2 py-1.5 align-middle text-xs truncate max-w-[200px]">
                    {l.email ? (
                      <a
                        href={`mailto:${l.email}`}
                        onClick={(e) => e.stopPropagation()}
                        className="text-primary hover:underline"
                      >
                        {l.email}
                      </a>
                    ) : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="px-2 py-1.5 align-middle text-xs whitespace-nowrap">
                    {l.phone ?? <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="px-2 py-1.5 align-middle text-right text-xs tabular-nums whitespace-nowrap">
                    {fmtRevenue(l.annualRevenue)}
                  </td>
                  <td className="px-2 py-1.5 align-middle text-right text-xs text-muted-foreground whitespace-nowrap">
                    {l.updatedAt.toLocaleDateString()}
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
};
