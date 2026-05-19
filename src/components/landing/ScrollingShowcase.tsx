import React, { useState } from 'react';
import { motion } from 'framer-motion';
import {
  LayoutList, Calendar as CalendarIcon, GanttChartSquare, TrendingUp,
  MessageCircle, Bot, BarChart3, Zap,
} from 'lucide-react';

/**
 * Auto-scrolling horizontal marquee of mock product surfaces. Renders the same
 * card list twice so a 50% translateX loop creates an infinite feel without
 * pop-in. Pauses on hover so people can read.
 */
const ScrollingShowcase: React.FC = () => {
  const [paused, setPaused] = useState(false);
  const items = mockScreens;
  const doubled = [...items, ...items];

  return (
    <section className="py-16 overflow-hidden">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mb-8">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="text-center max-w-2xl mx-auto"
        >
          <p className="text-xs uppercase tracking-wider text-orange-500 font-semibold mb-3">
            One platform, every view
          </p>
          <h2 className="text-3xl sm:text-4xl font-extrabold text-foreground mb-3">
            See your work the way you think.
          </h2>
          <p className="text-muted-foreground">
            Boards. Calendar. Timelines. CRM. Dashboards. AI agents. Chat-bot control.
            Switch any time — same data, different lens.
          </p>
        </motion.div>
      </div>

      {/* Marquee */}
      <div
        className="relative"
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
      >
        {/* Edge masks */}
        <div className="pointer-events-none absolute inset-y-0 left-0 w-24 bg-gradient-to-r from-background to-transparent z-10" />
        <div className="pointer-events-none absolute inset-y-0 right-0 w-24 bg-gradient-to-l from-background to-transparent z-10" />

        <motion.div
          className="flex gap-5 w-max"
          animate={{ x: paused ? undefined : ['0%', '-50%'] }}
          transition={{
            duration: 40,
            repeat: Infinity,
            ease: 'linear',
          }}
        >
          {doubled.map((item, i) => (
            <ShowcaseCard key={`${item.title}-${i}`} {...item} />
          ))}
        </motion.div>
      </div>
    </section>
  );
};

// ── Mock card content ──────────────────────────────────────────────────────

interface MockScreen {
  title: string;
  subtitle: string;
  Icon: React.ComponentType<{ className?: string; size?: number | string }>;
  accentClass: string;
  render: () => React.ReactNode;
}

const ShowcaseCard: React.FC<MockScreen> = ({ title, subtitle, Icon, accentClass, render }) => (
  <div className="w-[420px] shrink-0 rounded-2xl border border-border bg-card shadow-xl overflow-hidden">
    <div className="px-5 py-3 border-b border-border flex items-center gap-3">
      <div className={`h-8 w-8 rounded-lg grid place-items-center ${accentClass}`}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <div className="text-sm font-semibold text-foreground truncate">{title}</div>
        <div className="text-xs text-muted-foreground truncate">{subtitle}</div>
      </div>
    </div>
    <div className="p-4 h-56">{render()}</div>
  </div>
);

const mockScreens: MockScreen[] = [
  {
    title: 'Kanban board',
    subtitle: 'Drag, drop, ship',
    Icon: LayoutList,
    accentClass: 'bg-orange-500/15 text-orange-500',
    render: () => (
      <div className="grid grid-cols-3 gap-2 h-full text-[11px]">
        {[
          { name: 'To do', items: ['Design hero', 'Write API docs', 'Onboarding video'] },
          { name: 'In progress', items: ['Build dashboard', 'User auth'], accent: true },
          { name: 'Done', items: ['Setup CI/CD', 'Logo'] },
        ].map((col) => (
          <div key={col.name} className={`rounded p-2 ${col.accent ? 'bg-orange-500/5 border border-orange-500/20' : 'bg-muted/30'}`}>
            <div className="text-[10px] uppercase text-muted-foreground mb-2">{col.name}</div>
            <div className="space-y-1.5">
              {col.items.map((it) => (
                <div key={it} className="rounded bg-card border border-border/60 px-2 py-1 text-foreground/90">{it}</div>
              ))}
            </div>
          </div>
        ))}
      </div>
    ),
  },
  {
    title: 'Calendar',
    subtitle: 'See deadlines at a glance',
    Icon: CalendarIcon,
    accentClass: 'bg-emerald-500/15 text-emerald-500',
    render: () => <CalendarMock />,
  },
  {
    title: 'Timeline',
    subtitle: 'Gantt-style planning',
    Icon: GanttChartSquare,
    accentClass: 'bg-violet-500/15 text-violet-500',
    render: () => <TimelineMock />,
  },
  {
    title: 'CRM dashboard',
    subtitle: 'Pipeline · forecast · win rate',
    Icon: TrendingUp,
    accentClass: 'bg-rose-500/15 text-rose-500',
    render: () => <CrmDashboardMock />,
  },
  {
    title: 'Telegram bot',
    subtitle: 'Natural-language commands',
    Icon: MessageCircle,
    accentClass: 'bg-sky-500/15 text-sky-500',
    render: () => <TelegramMock />,
  },
  {
    title: 'AI Sales Agent',
    subtitle: 'Suggestions you can approve',
    Icon: Bot,
    accentClass: 'bg-purple-500/15 text-purple-500',
    render: () => <AgentMock />,
  },
  {
    title: 'Projects analytics',
    subtitle: 'Throughput · workload · cycle',
    Icon: BarChart3,
    accentClass: 'bg-amber-500/15 text-amber-500',
    render: () => <AnalyticsMock />,
  },
  {
    title: 'Automation',
    subtitle: 'When this happens, do that',
    Icon: Zap,
    accentClass: 'bg-yellow-500/15 text-yellow-500',
    render: () => <AutomationMock />,
  },
];

const CalendarMock: React.FC = () => (
  <div className="grid grid-cols-7 gap-1 h-full text-[10px]">
    {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d) => (
      <div key={d} className="text-center text-muted-foreground">{d}</div>
    ))}
    {Array.from({ length: 35 }).map((_, i) => {
      const isPast = i < 14;
      const hasEvent = [3, 7, 10, 12, 17, 18, 22, 25, 28].includes(i);
      const isAccent = [10, 17, 22].includes(i);
      return (
        <div key={i} className={`rounded p-0.5 min-h-[26px] ${isPast ? 'bg-muted/20' : 'bg-muted/40'}`}>
          <div className="text-[9px] text-muted-foreground">{(i % 28) + 1}</div>
          {hasEvent && (
            <div className={`mt-0.5 h-1 rounded ${isAccent ? 'bg-orange-500' : 'bg-foreground/40'}`} />
          )}
        </div>
      );
    })}
  </div>
);

const TimelineMock: React.FC = () => (
  <div className="space-y-2 h-full">
    {[
      { name: 'Design phase', start: 0, len: 40, accent: false },
      { name: 'Backend API', start: 25, len: 50, accent: false },
      { name: 'Frontend MVP', start: 35, len: 55, accent: true },
      { name: 'Beta launch', start: 60, len: 30, accent: false },
      { name: 'Marketing', start: 70, len: 25, accent: false },
    ].map((row) => (
      <div key={row.name} className="flex items-center gap-2 text-[10px]">
        <div className="w-20 shrink-0 truncate text-foreground/80">{row.name}</div>
        <div className="flex-1 h-3 rounded bg-muted/30 relative overflow-hidden">
          <div
            className={`absolute top-0 h-full rounded ${row.accent ? 'bg-orange-500' : 'bg-foreground/40'}`}
            style={{ left: `${row.start}%`, width: `${row.len}%` }}
          />
        </div>
      </div>
    ))}
  </div>
);

const CrmDashboardMock: React.FC = () => (
  <div className="grid grid-cols-2 gap-2 h-full text-[10px]">
    <div className="rounded bg-muted/30 p-2">
      <div className="text-muted-foreground mb-1">Open deals</div>
      <div className="text-lg font-bold text-foreground">$182k</div>
      <div className="mt-2 flex items-end gap-0.5 h-10">
        {[3, 4, 6, 5, 8, 9, 7, 11, 12, 10, 14, 13].map((h, i) => (
          <div key={i} className="flex-1 rounded-sm bg-foreground/30" style={{ height: `${h * 6}%` }} />
        ))}
      </div>
    </div>
    <div className="rounded bg-orange-500/5 border border-orange-500/20 p-2">
      <div className="text-muted-foreground mb-1">Won (30d)</div>
      <div className="text-lg font-bold text-orange-500">$48k</div>
      <div className="mt-2 flex items-end gap-0.5 h-10">
        {[2, 3, 2, 4, 3, 5, 6, 5, 7, 8, 7, 9].map((h, i) => (
          <div key={i} className="flex-1 rounded-sm bg-orange-500/60" style={{ height: `${h * 8}%` }} />
        ))}
      </div>
    </div>
    <div className="col-span-2 rounded bg-muted/30 p-2 space-y-1">
      <div className="text-muted-foreground mb-1">Pipeline</div>
      {[
        { name: 'Lead', pct: 100 },
        { name: 'Proposal', pct: 60 },
        { name: 'Won', pct: 30, accent: true },
      ].map((s) => (
        <div key={s.name} className="flex items-center gap-1.5">
          <span className="w-14 text-muted-foreground">{s.name}</span>
          <div className="flex-1 h-1.5 rounded bg-muted/50 overflow-hidden">
            <div
              className={`h-full rounded ${s.accent ? 'bg-orange-500' : 'bg-foreground/50'}`}
              style={{ width: `${s.pct}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  </div>
);

const TelegramMock: React.FC = () => (
  <div className="h-full flex flex-col gap-2 text-[11px]">
    <div className="self-start max-w-[80%] bg-muted/50 rounded-lg rounded-tl-sm px-3 py-1.5">
      task: <em>call Acme tomorrow 3pm in Q1 launch</em>
    </div>
    <div className="self-end max-w-[80%] bg-orange-500/10 rounded-lg rounded-tr-sm px-3 py-1.5">
      Create task <strong>call Acme</strong> in <strong>Q1 launch</strong> due tomorrow 3:00 PM?
    </div>
    <div className="self-end flex gap-1.5">
      <span className="rounded bg-emerald-500/20 text-emerald-500 px-2 py-1 text-[10px]">✅ Confirm</span>
      <span className="rounded bg-rose-500/15 text-rose-500 px-2 py-1 text-[10px]">❌ Cancel</span>
    </div>
    <div className="self-end max-w-[80%] bg-emerald-500/10 rounded-lg rounded-tr-sm px-3 py-1.5">
      ✅ Created.
    </div>
  </div>
);

const AgentMock: React.FC = () => (
  <div className="space-y-2 text-[11px] h-full">
    {[
      { icon: '📈', text: 'Acme Corp opened your proposal 4× today — draft a follow-up?', kind: 'review' },
      { icon: '⏱️', text: 'Deal Globex hasn’t moved in 12 days — snooze or reach out?', kind: 'review' },
      { icon: '🎯', text: 'Lead score climbed for Initech (62 → 84)', kind: 'info' },
      { icon: '✍️', text: 'Drafted onboarding email for Acme — open to review', kind: 'review' },
    ].map((s, i) => (
      <div
        key={i}
        className="flex items-start gap-2 rounded border border-border/60 bg-muted/20 px-2 py-1.5"
      >
        <span>{s.icon}</span>
        <div className="flex-1 text-foreground/85 leading-snug">{s.text}</div>
        {s.kind === 'review' && (
          <span className="rounded bg-purple-500/15 text-purple-500 px-1.5 py-0.5 text-[9px]">Review</span>
        )}
      </div>
    ))}
  </div>
);

const AnalyticsMock: React.FC = () => (
  <div className="space-y-2 h-full">
    <div className="grid grid-cols-3 gap-1.5 text-[10px]">
      {[
        { label: 'Active', val: '142' },
        { label: 'Done 30d', val: '89', accent: true },
        { label: 'Overdue', val: '6' },
      ].map((k) => (
        <div key={k.label} className={`rounded p-1.5 ${k.accent ? 'bg-orange-500/5 border border-orange-500/20' : 'bg-muted/30'}`}>
          <div className="text-muted-foreground">{k.label}</div>
          <div className={`font-bold ${k.accent ? 'text-orange-500' : 'text-foreground'}`}>{k.val}</div>
        </div>
      ))}
    </div>
    <div className="rounded bg-muted/30 p-2">
      <div className="text-[10px] text-muted-foreground mb-1">Throughput · 14d</div>
      <div className="flex items-end gap-0.5 h-14">
        {[3, 5, 2, 6, 4, 7, 5, 8, 6, 9, 7, 11, 9, 12].map((h, i) => (
          <div key={i} className="flex-1 rounded-sm bg-foreground/35" style={{ height: `${h * 7}%` }} />
        ))}
      </div>
    </div>
  </div>
);

const AutomationMock: React.FC = () => (
  <div className="h-full flex flex-col justify-center gap-2 text-[11px]">
    <div className="rounded border border-border/60 bg-muted/20 p-2.5">
      <div className="text-[9px] uppercase text-muted-foreground mb-0.5">When</div>
      <div className="text-foreground/90">deal stage → <span className="text-orange-500">Won</span></div>
    </div>
    <div className="rounded border border-border/60 bg-muted/20 p-2.5">
      <div className="text-[9px] uppercase text-muted-foreground mb-0.5">Then</div>
      <div className="text-foreground/90">create task “Send onboarding kit”</div>
      <div className="text-foreground/90">+ post to #wins on Slack</div>
      <div className="text-foreground/90">+ email <span className="text-muted-foreground">{'{{ client.email }}'}</span></div>
    </div>
    <div className="self-end text-[10px] text-emerald-500">Saved · 1.4s avg</div>
  </div>
);

export default ScrollingShowcase;
