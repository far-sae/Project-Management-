import React, { useEffect, useState } from "react";
import { motion, useInView } from "framer-motion";
import { CheckCircle, Users, FolderKanban, Zap, type LucideIcon } from "lucide-react";

interface Stat {
  icon: LucideIcon;
  value: number;
  suffix?: string;
  label: string;
  description: string;
}

const stats: Stat[] = [
  {
    icon: FolderKanban,
    value: 9,
    suffix: '+ views',
    label: 'Work surfaces',
    description: 'Board, list, calendar, timeline, dashboards, CRM, AI, bot',
  },
  {
    icon: Zap,
    value: 25,
    suffix: '+ automations',
    label: 'Triggers & actions',
    description: 'Stage moves, scores, tags, schedules — wired to email, Slack, webhooks',
  },
  {
    icon: Users,
    value: 100,
    suffix: '%',
    label: 'Your data',
    description: 'Multi-tenant Postgres, RLS on every table, OAuth tokens encrypted at rest',
  },
  {
    icon: CheckCircle,
    value: 28,
    suffix: '-day',
    label: 'Full-feature trial',
    description: 'No credit card. Advanced plan unlocks on day one.',
  },
];

const CountUp: React.FC<{ to: number; start: boolean; duration?: number }> = ({ to, start, duration = 1.4 }) => {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (!start) return;
    const startTs = performance.now();
    let frame: number;
    const tick = (now: number) => {
      const elapsed = (now - startTs) / 1000;
      const t = Math.min(1, elapsed / duration);
      const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
      setValue(Math.round(to * eased));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [start, to, duration]);
  return <>{value}</>;
};

const StatsSection: React.FC = () => {
  const ref = React.useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: '-80px' });
  return (
    <section ref={ref} className="py-20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
          {stats.map((stat, i) => (
            <motion.div
              key={stat.label}
              initial={{ opacity: 0, y: 16 }}
              animate={inView ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.5, delay: i * 0.08 }}
              className="rounded-2xl border border-border bg-card/40 backdrop-blur p-5"
            >
              <div className="w-10 h-10 rounded-xl bg-orange-500/15 text-orange-500 flex items-center justify-center mb-3">
                <stat.icon size={18} />
              </div>
              <div className="text-3xl font-extrabold text-foreground leading-none">
                <CountUp to={stat.value} start={inView} />
                {stat.suffix && <span className="text-base font-bold text-muted-foreground ml-0.5">{stat.suffix}</span>}
              </div>
              <p className="font-semibold text-foreground mt-2">{stat.label}</p>
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{stat.description}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default StatsSection;
