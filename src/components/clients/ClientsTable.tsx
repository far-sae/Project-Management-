import React, { useMemo, useState } from 'react';
import {
  ArrowUp, ArrowDown, ArrowUpDown, Star, Building2, UserPlus, Trash2,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { ScoreBadge } from '@/components/clients/ScoreBadge';
import { Client, ClientStatus, formatRevenue } from '@/services/supabase/clients';
import { Lead, leadDisplayName, leadStatusLabel } from '@/services/supabase/leads';
import { cn } from '@/lib/utils';

type SortKey =
  | 'name'
  | 'type'
  | 'status'
  | 'category'
  | 'accountOwnerName'
  | 'email'
  | 'phone'
  | 'country'
  | 'score'
  | 'annualRevenue'
  | 'updatedAt';

type SortDir = 'asc' | 'desc';

interface Column {
  key: SortKey;
  label: string;
  align?: 'left' | 'right' | 'center';
  className?: string;
}

const COLUMNS: Column[] = [
  { key: 'name',              label: 'Name' },
  { key: 'type',              label: 'Type' },
  { key: 'status',            label: 'Status' },
  { key: 'category',          label: 'Category' },
  { key: 'accountOwnerName',  label: 'Owner' },
  { key: 'email',             label: 'Email' },
  { key: 'phone',             label: 'Phone' },
  { key: 'country',           label: 'Country' },
  { key: 'score',             label: 'Score',   align: 'right' },
  { key: 'annualRevenue',     label: 'Revenue', align: 'right' },
  { key: 'updatedAt',         label: 'Updated', align: 'right' },
];

const STATUS_CLASSES: Record<ClientStatus, string> = {
  active:   'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
  inactive: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30',
  archived: 'bg-muted text-muted-foreground border-border',
};

const compareValues = (a: unknown, b: unknown): number => {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
  return String(a).localeCompare(String(b), undefined, { sensitivity: 'base' });
};

interface ClientsTableProps {
  rows: Client[];
  selectedIds: Set<string>;
  onToggleRow: (clientId: string) => void;
  onToggleAll: (allSelected: boolean) => void;
  onOpen: (client: Client) => void;
  groupByCategory?: boolean;
  canManage: boolean;
  /** Leads filed under the viewed category — shown as rows in this same list
   *  (an account IS a category bucket; its leads live inside it). Rendered with
   *  the SAME styling as account rows so the list reads as one uniform table. */
  leadRows?: Lead[];
  onOpenLead?: (lead: Lead) => void;
  /** Per-row delete (opens the parent's confirm dialog). When omitted the row's
   *  trash action is hidden. Accounts already have bulk delete; these give a
   *  one-by-one delete for both accounts and leads inside the category view. */
  onDeleteClient?: (client: Client) => void;
  onDeleteLead?: (lead: Lead) => void;
}

export const ClientsTable: React.FC<ClientsTableProps> = ({
  rows, selectedIds, onToggleRow, onToggleAll, onOpen,
  groupByCategory = false, canManage,
  leadRows = [], onOpenLead, onDeleteClient, onDeleteLead,
}) => {
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  const handleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const sortedRows = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      const va = (a as unknown as Record<SortKey, unknown>)[sortKey];
      const vb = (b as unknown as Record<SortKey, unknown>)[sortKey];
      const cmp = compareValues(va, vb);
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return copy;
  }, [rows, sortKey, sortDir]);

  // When grouping, partition the (already-sorted) rows into category buckets
  // so the table reads like an Excel sheet with subheaders.
  const groupedRows = useMemo(() => {
    if (!groupByCategory) return null;
    const buckets = new Map<string, Client[]>();
    for (const c of sortedRows) {
      const key = c.category?.trim() || '__uncategorized__';
      const list = buckets.get(key);
      if (list) list.push(c);
      else buckets.set(key, [c]);
    }
    const named = Array.from(buckets.entries())
      .filter(([k]) => k !== '__uncategorized__')
      .sort((a, b) => a[0].localeCompare(b[0]));
    const uncategorized = buckets.get('__uncategorized__');
    return uncategorized
      ? [...named, ['Uncategorized', uncategorized] as const]
      : named;
  }, [sortedRows, groupByCategory]);

  const allSelected =
    sortedRows.length > 0 && sortedRows.every((c) => selectedIds.has(c.clientId));
  const someSelected =
    sortedRows.some((c) => selectedIds.has(c.clientId)) && !allSelected;

  // Leading select checkbox + trailing per-row actions column, both gated on
  // canManage — counted so group headers / empty state span the full width.
  const colSpan = COLUMNS.length + (canManage ? 2 : 0);

  const SortIcon: React.FC<{ active: boolean; dir: SortDir }> = ({ active, dir }) => {
    if (!active) return <ArrowUpDown className="w-3 h-3 opacity-40" />;
    return dir === 'asc'
      ? <ArrowUp className="w-3 h-3" />
      : <ArrowDown className="w-3 h-3" />;
  };

  const renderRow = (c: Client) => (
    <tr
      key={c.clientId}
      onClick={() => onOpen(c)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen(c);
        }
      }}
      tabIndex={0}
      className={cn(
        'border-b border-border/60 cursor-pointer outline-none',
        'hover:bg-muted/50 focus:bg-muted/60',
        selectedIds.has(c.clientId) && 'bg-primary/5 hover:bg-primary/10',
      )}
    >
      {canManage && (
        <td className="px-2 py-1.5 align-middle w-8" onClick={(e) => e.stopPropagation()}>
          <input
            type="checkbox"
            checked={selectedIds.has(c.clientId)}
            onChange={() => onToggleRow(c.clientId)}
            aria-label={`Select ${c.name}`}
          />
        </td>
      )}
      <td className="px-2 py-1.5 align-middle">
        <div className="flex items-center gap-2 min-w-0">
          <span className="w-6 h-6 rounded-md bg-primary-soft text-primary-soft-foreground grid place-items-center shrink-0">
            <Building2 className="w-3.5 h-3.5" />
          </span>
          <span className="font-medium truncate max-w-[280px]">{c.name}</span>
          {c.rating && (
            <Badge variant="outline" className="text-[9px] py-0 px-1 inline-flex items-center gap-0.5">
              <Star className="w-2.5 h-2.5" /> {c.rating}
            </Badge>
          )}
        </div>
      </td>
      <td className="px-2 py-1.5 align-middle text-xs capitalize text-muted-foreground">{c.type}</td>
      <td className="px-2 py-1.5 align-middle">
        <Badge className={cn('text-[10px]', STATUS_CLASSES[c.status])}>
          {c.status}
        </Badge>
      </td>
      <td className="px-2 py-1.5 align-middle text-xs">
        {c.category ? (
          <Badge variant="secondary" className="text-[10px]">{c.category}</Badge>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </td>
      <td className="px-2 py-1.5 align-middle text-xs truncate max-w-[160px]">
        {c.accountOwnerName ?? <span className="text-muted-foreground">—</span>}
      </td>
      <td className="px-2 py-1.5 align-middle text-xs truncate max-w-[200px]">
        {c.email ? (
          <a
            href={`mailto:${c.email}`}
            onClick={(e) => e.stopPropagation()}
            className="text-primary hover:underline"
          >
            {c.email}
          </a>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </td>
      <td className="px-2 py-1.5 align-middle text-xs whitespace-nowrap">
        {c.phone ? (
          <a
            href={`tel:${c.phone}`}
            onClick={(e) => e.stopPropagation()}
            className="hover:underline"
          >
            {c.phone}
          </a>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </td>
      <td className="px-2 py-1.5 align-middle text-xs whitespace-nowrap">
        {c.country ?? <span className="text-muted-foreground">—</span>}
      </td>
      <td className="px-2 py-1.5 align-middle text-right whitespace-nowrap">
        <ScoreBadge score={c.score} band={c.scoreBand} />
      </td>
      <td className="px-2 py-1.5 align-middle text-right text-xs tabular-nums whitespace-nowrap">
        {c.annualRevenue == null ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          formatRevenue(c.annualRevenue)
        )}
      </td>
      <td className="px-2 py-1.5 align-middle text-right text-xs text-muted-foreground whitespace-nowrap">
        {c.updatedAt.toLocaleDateString()}
      </td>
      {canManage && (
        <td className="px-2 py-1.5 align-middle text-right w-10" onClick={(e) => e.stopPropagation()}>
          {onDeleteClient && (
            <button
              type="button"
              onClick={() => onDeleteClient(c)}
              className="text-muted-foreground hover:text-destructive p-1 rounded opacity-60 hover:opacity-100 transition-opacity"
              title={`Delete ${c.name}`}
              aria-label={`Delete ${c.name}`}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </td>
      )}
    </tr>
  );

  // Lead rows share the account columns AND styling so the list reads as one
  // uniform table (no separate "Leads" band). A person glyph + a neutral "Lead"
  // chip are the only cues; clicking opens the lead drawer, trash deletes it.
  const renderLeadRow = (l: Lead) => (
    <tr
      key={`lead-${l.leadId}`}
      onClick={() => onOpenLead?.(l)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenLead?.(l); }
      }}
      tabIndex={0}
      className={cn(
        'border-b border-border/60 cursor-pointer outline-none',
        'hover:bg-muted/50 focus:bg-muted/60',
      )}
    >
      {canManage && <td className="px-2 py-1.5 align-middle w-8" />}
      <td className="px-2 py-1.5 align-middle">
        <div className="flex items-center gap-2 min-w-0">
          <span className="w-6 h-6 rounded-md bg-primary-soft text-primary-soft-foreground grid place-items-center shrink-0">
            <UserPlus className="w-3.5 h-3.5" />
          </span>
          <span className="font-medium truncate max-w-[280px]">{leadDisplayName(l)}</span>
        </div>
      </td>
      <td className="px-2 py-1.5 align-middle text-xs">
        <Badge variant="outline" className="text-[10px]">Lead</Badge>
      </td>
      <td className="px-2 py-1.5 align-middle text-xs text-muted-foreground">
        {leadStatusLabel(l.leadStatus)}
      </td>
      <td className="px-2 py-1.5 align-middle text-xs">
        {l.category ? (
          <Badge variant="secondary" className="text-[10px]">{l.category}</Badge>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </td>
      <td className="px-2 py-1.5 align-middle text-xs truncate max-w-[160px]">
        {l.leadOwnerName ?? <span className="text-muted-foreground">—</span>}
      </td>
      <td className="px-2 py-1.5 align-middle text-xs truncate max-w-[200px]">
        {l.email ? (
          <a href={`mailto:${l.email}`} onClick={(e) => e.stopPropagation()} className="text-primary hover:underline">
            {l.email}
          </a>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </td>
      <td className="px-2 py-1.5 align-middle text-xs whitespace-nowrap">
        {l.phone ? (
          <a href={`tel:${l.phone}`} onClick={(e) => e.stopPropagation()} className="hover:underline">{l.phone}</a>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </td>
      <td className="px-2 py-1.5 align-middle text-xs whitespace-nowrap">
        {l.country ?? <span className="text-muted-foreground">—</span>}
      </td>
      <td className="px-2 py-1.5 align-middle text-right text-xs text-muted-foreground">—</td>
      <td className="px-2 py-1.5 align-middle text-right text-xs tabular-nums whitespace-nowrap">
        {l.annualRevenue == null ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          formatRevenue(l.annualRevenue)
        )}
      </td>
      <td className="px-2 py-1.5 align-middle text-right text-xs text-muted-foreground whitespace-nowrap">
        {l.updatedAt.toLocaleDateString()}
      </td>
      {canManage && (
        <td className="px-2 py-1.5 align-middle text-right w-10" onClick={(e) => e.stopPropagation()}>
          {onDeleteLead && (
            <button
              type="button"
              onClick={() => onDeleteLead(l)}
              className="text-muted-foreground hover:text-destructive p-1 rounded opacity-60 hover:opacity-100 transition-opacity"
              title={`Delete ${leadDisplayName(l)}`}
              aria-label={`Delete ${leadDisplayName(l)}`}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </td>
      )}
    </tr>
  );

  return (
    <div className="rounded-md border border-border overflow-auto bg-card max-h-[calc(100vh-22rem)]">
      <table className="w-full border-collapse text-sm">
        <thead className="sticky top-0 z-10 bg-muted/80 backdrop-blur-sm">
          <tr className="border-b border-border">
            {canManage && (
              <th className="px-2 py-2 text-left w-8">
                <input
                  type="checkbox"
                  aria-label="Select all rows"
                  checked={allSelected}
                  ref={(el) => { if (el) el.indeterminate = someSelected; }}
                  onChange={() => onToggleAll(allSelected)}
                />
              </th>
            )}
            {COLUMNS.map((col) => {
              const active = col.key === sortKey;
              return (
                <th
                  key={col.key}
                  className={cn(
                    'px-2 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground select-none',
                    col.align === 'right' && 'text-right',
                    col.align === 'center' && 'text-center',
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
            {canManage && <th className="px-2 py-2 w-10" aria-label="Actions" />}
          </tr>
        </thead>
        <tbody>
          {sortedRows.length === 0 && leadRows.length === 0 ? (
            <tr>
              <td colSpan={colSpan} className="px-3 py-8 text-center text-sm text-muted-foreground">
                No rows.
              </td>
            </tr>
          ) : (
            <>
              {groupedRows ? (
                groupedRows.map(([label, items]) => (
                  <React.Fragment key={label}>
                    <tr className="bg-muted/30 border-b border-border/60">
                      <td
                        colSpan={colSpan}
                        className="px-3 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide"
                      >
                        {label}
                        <span className="ml-2 font-normal normal-case">
                          {items.length} client{items.length === 1 ? '' : 's'}
                        </span>
                      </td>
                    </tr>
                    {items.map(renderRow)}
                  </React.Fragment>
                ))
              ) : (
                <>
                  {/* When a category holds BOTH business accounts and leads,
                      label the two groups so they read as distinct things
                      (still uniform row styling — no coloured band). */}
                  {sortedRows.length > 0 && leadRows.length > 0 && (
                    <tr className="bg-muted/30 border-b border-border/60">
                      <td
                        colSpan={colSpan}
                        className="px-3 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide"
                      >
                        Business accounts
                        <span className="ml-2 font-normal normal-case">{sortedRows.length}</span>
                      </td>
                    </tr>
                  )}
                  {sortedRows.map(renderRow)}
                </>
              )}
              {/* Leads — a distinct group from the business accounts above. */}
              {leadRows.length > 0 && (
                <>
                  <tr className="bg-muted/30 border-b border-border/60">
                    <td
                      colSpan={colSpan}
                      className="px-3 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide"
                    >
                      Leads
                      <span className="ml-2 font-normal normal-case">{leadRows.length}</span>
                    </td>
                  </tr>
                  {leadRows.map(renderLeadRow)}
                </>
              )}
            </>
          )}
        </tbody>
      </table>
    </div>
  );
};
