import React, { useMemo, useState } from 'react';
import {
  ArrowUp, ArrowDown, ArrowUpDown, User as UserIcon, Building2, Star,
} from 'lucide-react';
import { ContactWithAccount, contactDisplayName } from '@/services/supabase/contacts';
import { cn } from '@/lib/utils';

type SortKey =
  | 'displayName'
  | 'clientName'
  | 'title'
  | 'department'
  | 'email'
  | 'phone'
  | 'ownerName'
  | 'updatedAt';

type SortDir = 'asc' | 'desc';

interface Column {
  key: SortKey;
  label: string;
  align?: 'left' | 'right';
}

const COLUMNS: Column[] = [
  { key: 'displayName', label: 'Name' },
  { key: 'clientName',  label: 'Account' },
  { key: 'title',       label: 'Title' },
  { key: 'department',  label: 'Department' },
  { key: 'email',       label: 'Email' },
  { key: 'phone',       label: 'Phone' },
  { key: 'ownerName',   label: 'Owner' },
  { key: 'updatedAt',   label: 'Updated', align: 'right' },
];

const compareValues = (a: unknown, b: unknown): number => {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
  return String(a).localeCompare(String(b), undefined, { sensitivity: 'base' });
};

interface ContactsTableProps {
  rows: ContactWithAccount[];
  onOpen: (c: ContactWithAccount) => void;
}

export const ContactsTable: React.FC<ContactsTableProps> = ({ rows, onOpen }) => {
  const [sortKey, setSortKey] = useState<SortKey>('updatedAt');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const handleSort = (key: SortKey) => {
    if (key === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('asc'); }
  };

  const sorted = useMemo(() => {
    const valueFor = (c: ContactWithAccount): unknown => {
      if (sortKey === 'displayName') return contactDisplayName(c);
      return (c as unknown as Record<SortKey, unknown>)[sortKey];
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
                No contacts match the current filters.
              </td>
            </tr>
          ) : (
            sorted.map((c) => (
              <tr
                key={c.contactId}
                onClick={() => onOpen(c)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onOpen(c);
                  }
                }}
                tabIndex={0}
                className="border-b border-border/60 cursor-pointer outline-none hover:bg-muted/50 focus:bg-muted/60"
              >
                <td className="px-2 py-1.5 align-middle">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="w-6 h-6 rounded-full bg-gradient-to-br from-orange-400 to-pink-400 text-white grid place-items-center shrink-0 text-[10px] font-bold">
                      {contactDisplayName(c).charAt(0).toUpperCase()}
                    </span>
                    <span className="font-medium truncate max-w-[200px]">
                      {contactDisplayName(c)}
                    </span>
                    {c.isPrimary && (
                      <Star
                        className="w-3 h-3 text-amber-500 fill-amber-500"
                        aria-label="Primary contact"
                      />
                    )}
                  </div>
                </td>
                <td className="px-2 py-1.5 align-middle">
                  <div className="flex items-center gap-1.5 text-xs min-w-0">
                    <Building2 className="w-3 h-3 text-muted-foreground shrink-0" />
                    <span className="truncate max-w-[180px]">
                      {c.clientName || <span className="text-muted-foreground">—</span>}
                    </span>
                  </div>
                </td>
                <td className="px-2 py-1.5 align-middle text-xs truncate max-w-[160px]">
                  {c.title ?? <span className="text-muted-foreground">—</span>}
                </td>
                <td className="px-2 py-1.5 align-middle text-xs truncate max-w-[140px]">
                  {c.department ?? <span className="text-muted-foreground">—</span>}
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
                  ) : <span className="text-muted-foreground">—</span>}
                </td>
                <td className="px-2 py-1.5 align-middle text-xs whitespace-nowrap">
                  {c.phone ?? c.mobile ?? <span className="text-muted-foreground">—</span>}
                </td>
                <td className="px-2 py-1.5 align-middle text-xs truncate max-w-[140px]">
                  {c.ownerName ? (
                    <span className="inline-flex items-center gap-1">
                      <UserIcon className="w-3 h-3 text-muted-foreground" />
                      {c.ownerName}
                    </span>
                  ) : <span className="text-muted-foreground">—</span>}
                </td>
                <td className="px-2 py-1.5 align-middle text-right text-xs text-muted-foreground whitespace-nowrap">
                  {c.updatedAt.toLocaleDateString()}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
};
