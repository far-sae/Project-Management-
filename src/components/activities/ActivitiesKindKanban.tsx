import React, { useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { ListTodo, Calendar, Phone, StickyNote, Mail } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Activity } from '@/services/supabase/activities';
import { ActivityCard } from './ActivityCard';

interface ActivitiesKindKanbanProps {
  activities: Activity[];
  onSelect: (a: Activity) => void;
}

type PrimaryKind = 'task' | 'meeting' | 'call' | 'note' | 'email';
const KIND_ORDER: PrimaryKind[] = ['task', 'meeting', 'call', 'note', 'email'];

const KIND_META: Record<PrimaryKind, { label: string; icon: typeof ListTodo; accent: string }> = {
  task:    { label: 'Tasks',    icon: ListTodo,   accent: 'border-t-rose-500/40' },
  meeting: { label: 'Meetings', icon: Calendar,   accent: 'border-t-violet-500/40' },
  call:    { label: 'Calls',    icon: Phone,      accent: 'border-t-emerald-500/40' },
  note:    { label: 'Notes',    icon: StickyNote, accent: 'border-t-amber-500/40' },
  email:   { label: 'Emails',   icon: Mail,       accent: 'border-t-sky-500/40' },
};

/**
 * Groups activities by their kind (Tasks / Meetings / Calls) rather
 * than by linked entity (Customers / Open Deals / etc) or by status
 * (Not Started / In Progress / etc). Read-only — for "show me every
 * Meeting I have" / "every Call this week" scanning.
 *
 * Dragging isn't supported here because the kind of an activity is
 * baked into the underlying table (a Task can't become a Meeting
 * via drag — they're separate row types).
 */
export const ActivitiesKindKanban: React.FC<ActivitiesKindKanbanProps> = ({
  activities, onSelect,
}) => {
  const grouped = useMemo(() => {
    const out: Record<PrimaryKind, Activity[]> = { task: [], meeting: [], call: [], note: [], email: [] };
    for (const a of activities) {
      // pm_task is a CRM-only read-only kind — not shown in the kind kanban columns
      if (a.kind === 'pm_task') continue;
      out[a.kind as PrimaryKind].push(a);
    }
    return out;
  }, [activities]);

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-5 gap-3">
      {KIND_ORDER.map((kind) => {
        const meta = KIND_META[kind];
        const items = grouped[kind];
        const Icon = meta.icon;
        return (
          <Card key={kind} className={cn('border-t-2', meta.accent)}>
            <CardContent className="pt-3 space-y-2">
              <header className="flex items-center justify-between">
                <h3 className="text-sm font-semibold flex items-center gap-1.5">
                  <Icon className="w-3.5 h-3.5 text-muted-foreground" />
                  {meta.label}
                </h3>
                <span className="text-[11px] text-muted-foreground">{items.length}</span>
              </header>
              <div className="space-y-1.5 min-h-[120px]">
                {items.length === 0 && (
                  <p className="text-[11px] text-muted-foreground italic px-1 py-2">
                    No {meta.label.toLowerCase()} match the current filter.
                  </p>
                )}
                {items.map((a) => (
                  <ActivityCard key={a.id} activity={a} onClick={onSelect} compact />
                ))}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
};
