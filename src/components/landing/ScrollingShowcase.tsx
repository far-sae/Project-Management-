import React, { useState } from 'react';
import { motion } from 'framer-motion';
import {
  LayoutList, Calendar as CalendarIcon, GanttChartSquare, TrendingUp,
  Trophy, Upload, BarChart3, Coins, UserCircle, StickyNote, type LucideIcon,
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
            Boards. Calendar. Timelines. CRM. Dashboards. Reports.
            Same data, different lens.
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
  Icon: LucideIcon;
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
    title: 'Deal pipeline',
    subtitle: 'Drag deals across stages',
    Icon: TrendingUp,
    accentClass: 'bg-rose-500/15 text-rose-500',
    render: () => <DealKanbanMock />,
  },
  {
    title: 'Deal-Won handoff',
    subtitle: 'From sold to shipping in one click',
    Icon: Trophy,
    accentClass: 'bg-emerald-500/15 text-emerald-500',
    render: () => <HandoffMock />,
  },
  {
    title: 'Calendar',
    subtitle: 'See deadlines at a glance',
    Icon: CalendarIcon,
    accentClass: 'bg-teal-500/15 text-teal-500',
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
    title: 'CRM reports',
    subtitle: 'Pipeline · forecast · win rate',
    Icon: BarChart3,
    accentClass: 'bg-amber-500/15 text-amber-500',
    render: () => <CrmDashboardMock />,
  },
  {
    title: 'CSV import wizard',
    subtitle: 'Auto-match, review, import',
    Icon: Upload,
    accentClass: 'bg-sky-500/15 text-sky-500',
    render: () => <ImportMock />,
  },
  {
    title: 'Multi-currency',
    subtitle: '20 currencies · one setting',
    Icon: Coins,
    accentClass: 'bg-yellow-500/15 text-yellow-500',
    render: () => <CurrencyMock />,
  },
  {
    title: 'Contact notes + activity',
    subtitle: 'Realtime timeline per contact',
    Icon: StickyNote,
    accentClass: 'bg-pink-500/15 text-pink-500',
    render: () => <NotesMock />,
  },
  {
    title: 'HR & payroll',
    subtitle: 'People · time · payslips',
    Icon: UserCircle,
    accentClass: 'bg-indigo-500/15 text-indigo-500',
    render: () => <HrMock />,
  },
];

const DealKanbanMock: React.FC = () => (
  <div className="grid grid-cols-4 gap-1 h-full text-[10px]">
    {[
      { name: 'Lead', deals: ['Nimbus', 'Brightline'], val: '£24k' },
      { name: 'Qualified', deals: ['Acme', 'Forge'], val: '£62k', accent: true },
      { name: 'Proposal', deals: ['Helios'], val: '£40k' },
      { name: 'Won', deals: ['Vertex'], val: '£28k', won: true },
    ].map((col) => (
      <div
        key={col.name}
        className={`rounded p-1.5 ${
          col.won ? 'bg-emerald-500/10 border border-emerald-500/30' :
          col.accent ? 'bg-orange-500/5 border border-orange-500/20' :
          'bg-muted/30'
        }`}
      >
        <div className="uppercase text-[8px] tracking-wide text-muted-foreground mb-0.5">{col.name}</div>
        <div className="text-foreground/80 text-[9px] mb-1">{col.val}</div>
        <div className="space-y-1">
          {col.deals.map((d) => (
            <div key={d} className="rounded bg-card border border-border/60 px-1.5 py-1 text-foreground/85 text-[9px]">
              {d}
            </div>
          ))}
        </div>
      </div>
    ))}
  </div>
);

const HandoffMock: React.FC = () => (
  <div className="h-full flex flex-col gap-2 text-[11px]">
    <div className="rounded bg-emerald-500/10 border border-emerald-500/30 p-2.5">
      <div className="flex items-center gap-2">
        <div className="text-emerald-500 text-lg">🏆</div>
        <div>
          <div className="font-bold text-foreground">Deal Won — Acme Corp</div>
          <div className="text-xs text-muted-foreground">£48,000 · closed today</div>
        </div>
      </div>
    </div>
    <button className="rounded-lg bg-emerald-500 text-white font-semibold py-1.5 text-sm">
      → Create workspace & project
    </button>
    <div className="flex-1 rounded bg-muted/30 p-2 text-[10px]">
      <div className="uppercase text-[9px] tracking-wide text-muted-foreground mb-1">Auto-created</div>
      <div className="flex items-center gap-1">
        <span className="text-orange-500">▸</span>
        <span className="text-foreground/85">Workspace: <strong>Acme Corp Delivery</strong></span>
      </div>
      <div className="flex items-center gap-1 mt-0.5">
        <span className="text-orange-500">▸</span>
        <span className="text-foreground/85">Project: <strong>Onboarding phase 1</strong></span>
      </div>
    </div>
  </div>
);

const CalendarMock: React.FC = () => (
  <div className="grid grid-cols-7 gap-1 h-full text-[10px]">
    {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, index) => (
      <div key={`${d}-${index}`} className="text-center text-muted-foreground">{d}</div>
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
      <div className="text-lg font-bold text-foreground">£182k</div>
      <div className="mt-2 flex items-end gap-0.5 h-10">
        {[3, 4, 6, 5, 8, 9, 7, 11, 12, 10, 14, 13].map((h, i) => (
          <div key={i} className="flex-1 rounded-sm bg-foreground/30" style={{ height: `${h * 6}%` }} />
        ))}
      </div>
    </div>
    <div className="rounded bg-orange-500/5 border border-orange-500/20 p-2">
      <div className="text-muted-foreground mb-1">Won (30d)</div>
      <div className="text-lg font-bold text-orange-500">£48k</div>
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

const ImportMock: React.FC = () => (
  <div className="h-full flex flex-col gap-1.5 text-[10px]">
    <div className="flex items-center gap-2 rounded bg-muted/30 p-2">
      <div className="text-xl">📄</div>
      <div className="flex-1">
        <div className="font-semibold text-foreground">contacts.csv</div>
        <div className="text-muted-foreground">142 rows · 6 columns</div>
      </div>
      <div className="rounded bg-emerald-500/20 text-emerald-500 px-2 py-0.5 text-[9px]">6 mapped</div>
    </div>
    <div className="grid grid-cols-3 gap-1">
      {[
        ['first_name', 'First name *'],
        ['last_name', 'Last name'],
        ['email', 'Email'],
        ['phone', 'Phone'],
        ['job_title', 'Job title'],
        ['source', 'Source'],
      ].map(([from, to]) => (
        <div key={from} className="rounded bg-card border border-border/60 p-1 text-[9px]">
          <div className="text-muted-foreground truncate">{from}</div>
          <div className="text-orange-500 text-center leading-none">↓</div>
          <div className="text-foreground/85 truncate">{to}</div>
        </div>
      ))}
    </div>
  </div>
);

const CurrencyMock: React.FC = () => (
  <div className="h-full grid grid-cols-4 gap-1 text-[10px]">
    {[
      { s: '$', code: 'USD' },
      { s: '£', code: 'GBP', accent: true },
      { s: '€', code: 'EUR' },
      { s: '₹', code: 'INR' },
      { s: 'A$', code: 'AUD' },
      { s: '¥', code: 'JPY' },
      { s: 'S$', code: 'SGD' },
      { s: 'C$', code: 'CAD' },
      { s: 'د.إ', code: 'AED' },
      { s: 'CHF', code: 'CHF' },
      { s: 'R', code: 'ZAR' },
      { s: 'R$', code: 'BRL' },
    ].map((c) => (
      <div
        key={c.code}
        className={`rounded flex flex-col items-center justify-center py-1 ${c.accent ? 'bg-orange-500 text-white' : 'bg-card border border-border/60 text-foreground/85'}`}
      >
        <div className="text-sm font-bold">{c.s}</div>
        <div className="text-[8px] opacity-80">{c.code}</div>
      </div>
    ))}
  </div>
);

const NotesMock: React.FC = () => (
  <div className="h-full flex flex-col gap-1.5 text-[10px]">
    <div className="flex items-center gap-2 border-b border-border/60 pb-1">
      <div className="h-6 w-6 rounded-full bg-orange-500 grid place-items-center text-white text-[10px] font-bold">A</div>
      <div>
        <div className="font-semibold text-foreground">Alice Chen — Acme Corp</div>
        <div className="text-[9px] text-muted-foreground">Head of Ops</div>
      </div>
    </div>
    {[
      { icon: '📝', text: 'Wants pricing PDF + Meet next Tuesday' },
      { icon: '📞', text: 'Call — walked through the demo' },
      { icon: '✉️', text: 'Sent proposal · opened 4×' },
    ].map((s, i) => (
      <div key={i} className="flex items-start gap-1.5 rounded bg-muted/30 px-2 py-1 text-foreground/85">
        <span>{s.icon}</span>
        <div className="flex-1 leading-snug">{s.text}</div>
      </div>
    ))}
  </div>
);

const HrMock: React.FC = () => (
  <div className="h-full grid grid-cols-2 gap-2 text-[10px]">
    <div className="rounded bg-muted/30 p-2">
      <div className="text-muted-foreground text-[9px] uppercase">People</div>
      <div className="font-bold text-foreground text-lg">24</div>
      <div className="flex -space-x-1 mt-1">
        {['F', 'A', 'M', 'S', 'K'].map((c, i) => (
          <div key={i} className={`h-5 w-5 rounded-full border-2 border-card grid place-items-center text-[8px] font-bold text-white ${['bg-orange-500/80', 'bg-emerald-500/80', 'bg-sky-500/80', 'bg-purple-500/80', 'bg-rose-500/80'][i]}`}>
            {c}
          </div>
        ))}
      </div>
    </div>
    <div className="rounded bg-orange-500/5 border border-orange-500/20 p-2">
      <div className="text-muted-foreground text-[9px] uppercase">Payroll · Nov</div>
      <div className="font-bold text-orange-500 text-lg">£62,300</div>
      <div className="text-[9px] text-emerald-500 mt-1">✓ Processed</div>
    </div>
    <div className="col-span-2 rounded bg-muted/30 p-2">
      <div className="text-muted-foreground text-[9px] uppercase mb-1">Time this week</div>
      <div className="flex items-end gap-1 h-8">
        {[6, 8, 8, 7, 8, 3, 0].map((h, i) => (
          <div key={i} className="flex-1 rounded-sm bg-foreground/40" style={{ height: `${h * 10}%` }} />
        ))}
      </div>
    </div>
  </div>
);

export default ScrollingShowcase;
