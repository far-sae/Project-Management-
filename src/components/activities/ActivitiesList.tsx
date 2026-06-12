import React, { useMemo, useState } from 'react';
import { format } from 'date-fns';
import { Calendar, ListTodo, Phone, ChevronUp, ChevronDown, StickyNote, Mail, CheckCircle2, Handshake } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { Activity } from '@/services/supabase/activities';

interface ActivitiesListProps {
  activities: Activity[];
  onSelect: (a: Activity) => void;
}

type SortKey = 'title' | 'kind' | 'whenAt' | 'owner' | 'status';
interface Sort { key: SortKey; dir: 'asc' | 'desc' }

const KIND_ICON: Record<Activity['kind'], typeof Calendar> = {
  task: ListTodo, meeting: Calendar, call: Phone, note: StickyNote, email: Mail,
  pm_task: CheckCircle2, deal: Handshake,
};
const KIND_COLOR: Record<Activity['kind'], string> = {
  task: 'text-rose-600',
  meeting: 'text-violet-600',
  call: 'text-emerald-600',
  note: 'text-amber-600',
  email: 'text-sky-600',
  pm_task: 'text-green-600',
  deal: 'text-orange-600',
};

/**
 * Sortable flat table view of the same activities list the kanban
 * shows. Columns match Zoho's: Subject, Type, Status, Date/Time, Owner.
 */
export const ActivitiesList: React.FC<ActivitiesListProps> = ({ activities, onSelect }) => {
  const [sort, setSort] = useState<Sort>({ key: 'whenAt', dir: 'asc' });

  const sorted = useMemo(() => {
    const out = [...activities];
    out.sort((a, b) => {
      const dir = sort.dir === 'asc' ? 1 : -1;
      switch (sort.key) {
        case 'title':  return a.title.localeCompare(b.title) * dir;
        case 'kind':   return a.kind.localeCompare(b.kind) * dir;
        case 'owner':  return (a.ownerName ?? '').localeCompare(b.ownerName ?? '') * dir;
        case 'status': return Number(b.open) - Number(a.open);
        case 'whenAt': {
          const at = a.whenAt?.getTime() ?? Number.POSITIVE_INFINITY;
          const bt = b.whenAt?.getTime() ?? Number.POSITIVE_INFINITY;
          return (at - bt) * dir;
        }
        default: return 0;
      }
    });
    return out;
  }, [activities, sort]);

  const toggleSort = (key: SortKey) => {
    setSort((s) => s.key === key
      ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' }
      : { key, dir: 'asc' },
    );
  };

  const SortHead: React.FC<{ k: SortKey; children: React.ReactNode; className?: string }> = ({ k, children, className }) => (
    <th
      className={cn('px-3 py-2 text-left text-xs font-semibold cursor-pointer select-none', className)}
      onClick={() => toggleSort(k)}
    >
      <span className="inline-flex items-center gap-1">
        {children}
        {sort.key === k && (sort.dir === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
      </span>
    </th>
  );

  if (sorted.length === 0) {
    return (
      <div className="rounded-md border p-10 text-center text-sm text-muted-foreground">
        No activities match this view yet. Use the + Task / + Meeting / + Call buttons above to create one.
      </div>
    );
  }

  return (
    <div className="rounded-md border overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-muted/40">
          <tr>
            <SortHead k="title">Subject</SortHead>
            <SortHead k="kind" className="w-24">Type</SortHead>
            <SortHead k="status" className="w-24">Status</SortHead>
            <SortHead k="whenAt" className="w-44">Date/Time</SortHead>
            <SortHead k="owner" className="w-40">Owner</SortHead>
          </tr>
        </thead>
        <tbody>
          {sorted.map((a) => {
            const Icon = KIND_ICON[a.kind];
            return (
              <tr
                key={a.id}
                onClick={() => onSelect(a)}
                className="border-t hover:bg-muted/30 cursor-pointer"
              >
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <Icon className={cn('w-3.5 h-3.5 shrink-0', KIND_COLOR[a.kind])} />
                    <span className="font-medium truncate">{a.title}</span>
                    {a.overdue && (
                      <Badge variant="outline" className="text-[10px] text-destructive border-destructive/40 px-1 py-0">
                        Overdue
                      </Badge>
                    )}
                  </div>
                </td>
                <td className="px-3 py-2 capitalize text-xs text-muted-foreground">{a.kind}</td>
                <td className="px-3 py-2">
                  <Badge variant={a.open ? 'default' : 'outline'} className="text-[10px]">
                    {a.open ? 'Open' : 'Closed'}
                  </Badge>
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground">
                  {a.whenAt ? format(a.whenAt, 'MMM d, yyyy · HH:mm') : '—'}
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground truncate">
                  {a.ownerName ?? '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};
