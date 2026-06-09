import React, { useMemo } from "react";
import { Phone, Calendar, ListTodo, StickyNote, Mail, CheckCircle2 } from "lucide-react";
import { dayBucket, type Activity, type DayBucket, type ActivityKind } from "@/services/supabase/activities";

const KIND_ICON: Record<ActivityKind, React.ComponentType<{ className?: string }>> = {
  task: ListTodo, meeting: Calendar, call: Phone, note: StickyNote, email: Mail,
  pm_task: CheckCircle2,
};
const fmt = (d: Date | null) => d ? d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "";

export const ActivitiesTimeline: React.FC<{
  activities: Activity[];
  onOpen?: (a: Activity) => void;
}> = ({ activities, onOpen }) => {
  const now = new Date();
  const { upcoming, logged } = useMemo(() => {
    const upcoming = activities.filter((a) => a.open && a.whenAt && a.whenAt.getTime() >= now.getTime());
    const logged = activities.filter((a) => !(a.open && a.whenAt && a.whenAt.getTime() >= now.getTime()));
    return { upcoming, logged };
  }, [activities]);

  const buckets = useMemo(() => {
    const order: DayBucket[] = ["Today", "Yesterday", "This week", "Earlier"];
    const map = new Map<DayBucket, Activity[]>(order.map((b) => [b, []]));
    for (const a of logged) map.get(dayBucket(a.whenAt, now))!.push(a);
    return order.filter((b) => map.get(b)!.length > 0).map((b) => ({ bucket: b, items: map.get(b)! }));
  }, [logged]);

  const Row: React.FC<{ a: Activity }> = ({ a }) => {
    const Icon = KIND_ICON[a.kind];
    return (
      <button onClick={() => onOpen?.(a)} className="w-full flex items-start gap-3 text-left rounded-md px-2 py-2 hover:bg-muted/50">
        <span className={`mt-0.5 ${a.overdue ? "text-red-500" : "text-muted-foreground"}`}><Icon className="w-4 h-4" /></span>
        <span className="flex-1 min-w-0">
          <span className="block text-sm truncate">{a.title}</span>
          <span className="block text-xs text-muted-foreground">
            {a.kind}{a.relatedToLabel ? ` · ${a.relatedToLabel}` : ""}{a.whenAt ? ` · ${fmt(a.whenAt)}` : ""}{a.ownerName ? ` · ${a.ownerName}` : ""}
          </span>
        </span>
      </button>
    );
  };

  if (activities.length === 0) {
    return <div className="p-8 text-center text-sm text-muted-foreground">No activity yet.</div>;
  }
  return (
    <div className="space-y-5">
      {upcoming.length > 0 && (
        <section>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-primary mb-1">Upcoming</h4>
          <div className="space-y-0.5">{upcoming.map((a) => <Row key={a.id} a={a} />)}</div>
        </section>
      )}
      {buckets.map(({ bucket, items }) => (
        <section key={bucket}>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">{bucket}</h4>
          <div className="space-y-0.5">{items.map((a) => <Row key={a.id} a={a} />)}</div>
        </section>
      ))}
    </div>
  );
};
