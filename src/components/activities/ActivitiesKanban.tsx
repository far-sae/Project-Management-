import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import {
  groupByCategory, ACTIVITY_CATEGORY_LABEL, type Activity, type ActivityCategory,
} from '@/services/supabase/activities';
import { ActivityCard } from './ActivityCard';

interface ActivitiesKanbanProps {
  activities: Activity[];
  onSelect: (a: Activity) => void;
}

const CATEGORY_ORDER: ActivityCategory[] = ['customers', 'open_deals', 'leads_contacts', 'others'];

const ACCENT: Record<ActivityCategory, string> = {
  customers: 'border-t-emerald-500/40',
  open_deals: 'border-t-amber-500/40',
  leads_contacts: 'border-t-sky-500/40',
  others: 'border-t-slate-400/40',
};

/**
 * 4-column kanban that mirrors Zoho's Activities kanban: Customers /
 * Open Deals / Leads/Contacts / Others. Just a presentational view of
 * a pre-bucketed activities list; the parent decides which filter view
 * is active and passes a filtered list.
 */
export const ActivitiesKanban: React.FC<ActivitiesKanbanProps> = ({ activities, onSelect }) => {
  const grouped = groupByCategory(activities);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
      {CATEGORY_ORDER.map((cat) => {
        const items = grouped[cat];
        return (
          <Card key={cat} className={cn('border-t-2', ACCENT[cat])}>
            <CardContent className="pt-3 space-y-2">
              <header className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">{ACTIVITY_CATEGORY_LABEL[cat]}</h3>
                <span className="text-[11px] text-muted-foreground">
                  {items.length}
                </span>
              </header>
              <div className="space-y-1.5 min-h-[80px]">
                {items.length === 0 && (
                  <p className="text-[11px] text-muted-foreground italic px-1 py-2">
                    No activities in this category.
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
