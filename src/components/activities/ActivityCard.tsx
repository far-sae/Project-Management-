import React from 'react';
import { format } from 'date-fns';
import { Calendar, ListTodo, Phone, MapPin, User, Clock, StickyNote, Mail } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { Activity } from '@/services/supabase/activities';

interface ActivityCardProps {
  activity: Activity;
  onClick?: (a: Activity) => void;
  compact?: boolean;
}

const KIND_META: Record<Activity['kind'], { icon: typeof Calendar; tone: string; label: string }> = {
  task:    { icon: ListTodo,   tone: 'text-rose-600 bg-rose-500/10',      label: 'Task' },
  meeting: { icon: Calendar,   tone: 'text-violet-600 bg-violet-500/10',  label: 'Meeting' },
  call:    { icon: Phone,      tone: 'text-emerald-600 bg-emerald-500/10', label: 'Call' },
  note:    { icon: StickyNote, tone: 'text-amber-600 bg-amber-500/10',    label: 'Note' },
  email:   { icon: Mail,       tone: 'text-sky-600 bg-sky-500/10',        label: 'Email' },
};

const PRIORITY_DOT: Record<string, string> = {
  high: 'bg-rose-500',
  normal: 'bg-amber-500',
  low: 'bg-slate-400',
};

/**
 * Shared card used by both the Activities kanban (vertical stack in a
 * column) and the list view detail rows. Stays kind-agnostic — the
 * underlying source row decides what extras to surface (location for
 * meetings, status pill for tasks, direction for calls).
 */
export const ActivityCard: React.FC<ActivityCardProps> = ({ activity, onClick, compact }) => {
  const meta = KIND_META[activity.kind];
  const Icon = meta.icon;
  const when = activity.whenAt;
  const subtitle: React.ReactNode = (() => {
    if (activity.source.kind === 'meeting') {
      const m = activity.source.row;
      return m.location ?? (m.participants.length > 0 ? `${m.participants.length} guests` : null);
    }
    if (activity.source.kind === 'call') {
      const c = activity.source.row;
      return c.contactName ?? c.contactPhone ?? (c.callType === 'inbound' ? 'Inbound' : 'Outbound');
    }
    if (activity.source.kind === 'task') {
      return activity.source.row.description ?? null;
    }
    if (activity.source.kind === 'note') {
      return activity.source.row.body ?? null;
    }
    if (activity.source.kind === 'email') {
      return activity.source.row.snippet ?? activity.source.row.from_email ?? null;
    }
    return null;
  })();

  return (
    <button
      type="button"
      onClick={() => onClick?.(activity)}
      className={cn(
        'w-full text-left rounded-md border bg-card hover:bg-muted/40 transition-colors',
        'flex items-start gap-2 px-2.5 py-2',
        activity.overdue && 'border-destructive/40',
      )}
    >
      <span className={cn('mt-0.5 inline-flex items-center justify-center rounded-md w-6 h-6 shrink-0', meta.tone)}>
        <Icon className="w-3.5 h-3.5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 flex-wrap">
          <p className="text-sm font-medium truncate">{activity.title}</p>
          {activity.kind === 'task' && (
            <span
              className={cn('inline-block w-1.5 h-1.5 rounded-full', PRIORITY_DOT[activity.priority] ?? 'bg-slate-400')}
              title={`Priority: ${activity.priority}`}
            />
          )}
          {activity.overdue && (
            <Badge variant="outline" className="text-[10px] text-destructive border-destructive/40 px-1 py-0">
              Overdue
            </Badge>
          )}
          {!activity.open && (
            <Badge variant="outline" className="text-[10px] text-muted-foreground px-1 py-0">
              {activity.kind === 'task' ? 'Done' : activity.kind === 'meeting' ? 'Held' : 'Logged'}
            </Badge>
          )}
        </div>
        {!compact && subtitle && (
          <p className="text-[11px] text-muted-foreground truncate mt-0.5 inline-flex items-center gap-1">
            {activity.source.kind === 'meeting' && activity.source.row.location ? <MapPin className="w-3 h-3" /> : null}
            {subtitle}
          </p>
        )}
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground mt-0.5">
          {when && (
            <span className="inline-flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {format(when, 'MMM d, HH:mm')}
            </span>
          )}
          {activity.ownerName && (
            <span className="inline-flex items-center gap-1 truncate">
              <User className="w-3 h-3" />
              {activity.ownerName}
            </span>
          )}
        </div>
      </div>
    </button>
  );
};
