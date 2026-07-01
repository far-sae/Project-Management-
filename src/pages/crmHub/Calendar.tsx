import React, { useMemo, useState } from 'react';
import {
  ChevronLeft, ChevronRight, CalendarClock, Loader2, ListChecks, Trophy, XCircle,
} from 'lucide-react';
import { useCrmTasks, useCrmDeals } from '@/hooks/useCrmHub';
import type { CrmTask, CrmDeal } from '@/types/crmHub';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

type CalItem =
  | { kind: 'task'; date: Date; task: CrmTask }
  | { kind: 'deal_won' | 'deal_lost'; date: Date; deal: CrmDeal };

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

import { useCrmCurrency } from '@/context/CrmCurrencyContext';

export const CrmCalendarPage: React.FC = () => {
  const { items: tasks, loading: tasksLoading } = useCrmTasks();
  const { items: deals, loading: dealsLoading } = useCrmDeals();
  const { format: fmtCurrency } = useCrmCurrency();

  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });

  const loading = tasksLoading || dealsLoading;

  const items: CalItem[] = useMemo(() => {
    const rows: CalItem[] = [];
    for (const t of tasks) {
      if (t.dueDate) rows.push({ kind: 'task', date: t.dueDate, task: t });
    }
    for (const d of deals) {
      if (d.status === 'won') rows.push({ kind: 'deal_won', date: d.updatedAt, deal: d });
      else if (d.status === 'lost') rows.push({ kind: 'deal_lost', date: d.updatedAt, deal: d });
    }
    return rows;
  }, [tasks, deals]);

  const monthDays = useMemo(() => {
    const year = cursor.getFullYear();
    const month = cursor.getMonth();
    const firstDay = new Date(year, month, 1);
    const startWeekday = firstDay.getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cells: (Date | null)[] = [];
    for (let i = 0; i < startWeekday; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  }, [cursor]);

  const [selected, setSelected] = useState<Date | null>(new Date());

  const itemsForDay = (d: Date): CalItem[] => items.filter((i) => sameDay(i.date, d));

  const monthLabel = cursor.toLocaleString(undefined, { month: 'long', year: 'numeric' });
  const isToday = (d: Date) => sameDay(d, new Date());

  const selectedItems = selected ? itemsForDay(selected) : [];

  return (
    <main className="flex-1 min-w-0 overflow-y-auto p-4 sm:p-6 lg:p-8 bg-background">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold">CRM Calendar</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Task due dates and closed deals plotted on a month view.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}>
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <div className="text-sm font-medium w-40 text-center">{monthLabel}</div>
            <Button variant="outline" size="sm" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}>
              <ChevronRight className="w-4 h-4" />
            </Button>
            <Button variant="ghost" size="sm" onClick={() => {
              const now = new Date();
              setCursor(new Date(now.getFullYear(), now.getMonth(), 1));
              setSelected(now);
            }}>
              Today
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card className="lg:col-span-2">
            <CardContent className="p-3">
              {loading ? (
                <div className="h-96 flex items-center justify-center">
                  <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-7 mb-2">
                    {WEEKDAYS.map((w) => (
                      <div key={w} className="text-[11px] uppercase tracking-wide text-muted-foreground text-center">
                        {w}
                      </div>
                    ))}
                  </div>
                  <div className="grid grid-cols-7 gap-1">
                    {monthDays.map((d, i) => {
                      if (!d) return <div key={i} className="min-h-20 rounded-md bg-muted/20" />;
                      const dayItems = itemsForDay(d);
                      const isSelected = selected && sameDay(d, selected);
                      return (
                        <button
                          key={i}
                          type="button"
                          onClick={() => setSelected(d)}
                          className={`min-h-20 rounded-md border p-1.5 text-left transition-colors ${
                            isSelected
                              ? 'border-primary bg-primary/10'
                              : isToday(d)
                              ? 'border-primary/40 bg-primary/5'
                              : 'border-border bg-card hover:bg-muted/40'
                          }`}
                        >
                          <div className="flex items-center justify-between mb-1">
                            <span className={`text-xs font-medium ${isToday(d) ? 'text-primary' : 'text-foreground'}`}>
                              {d.getDate()}
                            </span>
                            {dayItems.length > 0 && (
                              <span className="text-[10px] text-muted-foreground">{dayItems.length}</span>
                            )}
                          </div>
                          <div className="space-y-0.5">
                            {dayItems.slice(0, 3).map((it, idx) => {
                              const cls =
                                it.kind === 'deal_won'
                                  ? 'bg-emerald-500/20 text-emerald-500'
                                  : it.kind === 'deal_lost'
                                  ? 'bg-destructive/20 text-destructive'
                                  : 'bg-primary/20 text-primary';
                              const label = it.kind === 'task' ? it.task.title : it.deal.name;
                              return (
                                <div key={idx} className={`truncate rounded px-1 py-0.5 text-[10px] ${cls}`}>
                                  {label}
                                </div>
                              );
                            })}
                            {dayItems.length > 3 && (
                              <div className="text-[10px] text-muted-foreground pl-1">+{dayItems.length - 3} more</div>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <CalendarClock className="w-4 h-4 text-primary" />
                {selected
                  ? selected.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
                  : 'Pick a day'}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {!selected ? (
                <p className="text-xs text-muted-foreground text-center py-6">Click a day to inspect.</p>
              ) : selectedItems.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-6">Nothing scheduled or closed here.</p>
              ) : (
                <div className="space-y-2">
                  {selectedItems.map((it, i) => {
                    if (it.kind === 'task') {
                      return (
                        <div key={i} className="flex items-start gap-2 p-2 rounded-md border border-border">
                          <ListChecks className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-medium truncate">{it.task.title}</div>
                            <div className="text-xs text-muted-foreground capitalize">
                              {it.task.priority} priority · {it.task.status.replace(/_/g, ' ')}
                            </div>
                          </div>
                        </div>
                      );
                    }
                    const won = it.kind === 'deal_won';
                    return (
                      <div key={i} className="flex items-start gap-2 p-2 rounded-md border border-border">
                        {won
                          ? <Trophy className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                          : <XCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />}
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium truncate">{it.deal.name}</div>
                          <div className="text-xs text-muted-foreground">
                            {fmtCurrency(it.deal.value)} · {won ? 'Won' : 'Lost'}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </main>
  );
};

export default CrmCalendarPage;
