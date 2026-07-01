import { motion } from "framer-motion";
import {
  LayoutList, BarChart3, Calendar, Users, Trophy, Upload, Coins,
  Layers, StickyNote, Video, GanttChartSquare, UserCircle, type LucideIcon,
} from "lucide-react";

interface Feature {
  icon: LucideIcon;
  title: string;
  description: string;
  accentClass: string;
  visual: React.ReactNode;
}

const features: Feature[] = [
  {
    icon: LayoutList,
    title: "Boards, lists, timelines",
    description: "Same data, three views. Drag cards across Kanban columns, switch to a timeline to map dependencies, or zoom out on a calendar.",
    accentClass: "bg-orange-500/15 text-orange-500",
    visual: <KanbanVisual />,
  },
  {
    icon: Trophy,
    title: "Deal-Won → project handoff",
    description: "Close a deal in the CRM, click one button, and a workspace + project appear on the PM side ready to deliver — with the deal linked back for context.",
    accentClass: "bg-emerald-500/15 text-emerald-500",
    visual: <HandoffVisual />,
  },
  {
    icon: BarChart3,
    title: "CRM reports built-in",
    description: "Pipeline value, weighted forecast, win rate, deals by stage, monthly revenue, top open deals, lead source. Real charts, live data.",
    accentClass: "bg-amber-500/15 text-amber-500",
    visual: <ReportsVisual />,
  },
  {
    icon: Layers,
    title: "Workspace-scoped CRM",
    description: "Slice the whole CRM by workspace. Switch workspaces in the sidebar and contacts, deals, tasks, notes filter to that scope instantly.",
    accentClass: "bg-violet-500/15 text-violet-500",
    visual: <WorkspaceScopeVisual />,
  },
  {
    icon: Upload,
    title: "CSV import wizard",
    description: "Drop a CSV, auto-match columns, review, import. Works for contacts and companies. Numeric coercion for revenue, required-field guards, live preview.",
    accentClass: "bg-sky-500/15 text-sky-500",
    visual: <ImportVisual />,
  },
  {
    icon: Coins,
    title: "20 currencies, one setting",
    description: "USD, GBP, EUR, INR, AUD, JPY, AED and 13 more. Pick once in CRM settings and every amount — deals, revenue, reports, charts — reformats.",
    accentClass: "bg-yellow-500/15 text-yellow-500",
    visual: <CurrencyVisual />,
  },
  {
    icon: StickyNote,
    title: "Notes + activity timeline",
    description: "Every contact, company, and deal has its own notes and activity feed. Notes are realtime, editable, and log automatically to the timeline.",
    accentClass: "bg-rose-500/15 text-rose-500",
    visual: <NotesVisual />,
  },
  {
    icon: Calendar,
    title: "Google Meet on tasks",
    description: "Pick a date and time and we'll create a Google Calendar event with a Meet link and invite everyone, without leaving the task.",
    accentClass: "bg-teal-500/15 text-teal-500",
    visual: <MeetVisual />,
  },
  {
    icon: UserCircle,
    title: "HR, time & payroll",
    description: "People directory, time tracking, expenses, payroll runs, contracts. The ops layer for delivering the work you just won.",
    accentClass: "bg-indigo-500/15 text-indigo-500",
    visual: <HrVisual />,
  },
  {
    icon: GanttChartSquare,
    title: "Timeline + workload",
    description: "Gantt-style timeline across every project. Workload view balances load per teammate so nothing slips.",
    accentClass: "bg-fuchsia-500/15 text-fuchsia-500",
    visual: <TimelineVisual />,
  },
  {
    icon: Users,
    title: "Real time team",
    description: "Comments, mentions, presence, notifications, and an inbox. Built in. No second tool for chat.",
    accentClass: "bg-pink-500/15 text-pink-500",
    visual: <TeamVisual />,
  },
  {
    icon: Video,
    title: "Google Calendar sync",
    description: "OAuth once and every task-linked Meet lives in your Google Calendar too. Tokens encrypted at rest — we never touch inbox scopes.",
    accentClass: "bg-blue-500/15 text-blue-500",
    visual: <CalSyncVisual />,
  },
];

const FeaturesSection = () => {
  return (
    <section id="features" className="py-24 bg-secondary/30">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="text-center mb-14"
        >
          <p className="text-xs uppercase tracking-wider text-orange-500 font-semibold mb-3">
            Sales pipeline meets project delivery
          </p>
          <h2 className="text-3xl sm:text-4xl font-extrabold text-foreground mb-3">
            Everything from won deal to shipped work.
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Project management, CRM, HR, and delivery ops.
            One workspace, one data model, one bill.
          </p>
        </motion.div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {features.map((feature, i) => (
            <motion.div
              key={feature.title}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-80px' }}
              transition={{ duration: 0.5, delay: (i % 3) * 0.08 }}
              whileHover={{ y: -4 }}
              className="bg-card rounded-2xl border border-border p-6 hover:shadow-xl hover:shadow-primary/5 transition-shadow"
            >
              <div className={`w-11 h-11 rounded-xl flex items-center justify-center mb-4 ${feature.accentClass}`}>
                <feature.icon size={20} />
              </div>
              <h3 className="text-lg font-bold text-foreground mb-2">{feature.title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed mb-4">{feature.description}</p>
              <div className="rounded-lg bg-muted/30 border border-border/60 p-3 h-28 overflow-hidden">
                {feature.visual}
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
};

// ── Tiny visual mocks shown inside each feature card ───────────────────────

function KanbanVisual() {
  return (
    <div className="grid grid-cols-3 gap-1.5 h-full text-[9px]">
      {[
        { items: ['Hero', 'Docs'] },
        { items: ['Auth', 'API'], accent: true },
        { items: ['CI'] },
      ].map((c, i) => (
        <div key={i} className={`rounded p-1 ${c.accent ? 'bg-orange-500/10 border border-orange-500/30' : 'bg-card border border-border/60'}`}>
          {c.items.map((it) => (
            <div key={it} className="rounded bg-muted/40 px-1 py-0.5 mb-0.5">{it}</div>
          ))}
        </div>
      ))}
    </div>
  );
}

function HandoffVisual() {
  return (
    <div className="h-full flex items-center gap-2 text-[10px]">
      <div className="flex-1 rounded bg-emerald-500/10 border border-emerald-500/30 p-1.5">
        <div className="text-emerald-500 font-bold text-[9px]">DEAL WON</div>
        <div className="text-foreground/90">Acme Corp</div>
        <div className="text-muted-foreground">£48k</div>
      </div>
      <div className="text-emerald-500">→</div>
      <div className="flex-1 rounded bg-orange-500/10 border border-orange-500/30 p-1.5">
        <div className="text-orange-500 font-bold text-[9px]">PROJECT</div>
        <div className="text-foreground/90">Acme delivery</div>
        <div className="text-muted-foreground">Kanban ready</div>
      </div>
    </div>
  );
}

function ReportsVisual() {
  return (
    <div className="grid grid-cols-2 gap-1.5 h-full text-[9px]">
      <div className="rounded bg-card border border-border/60 p-1.5">
        <div className="text-muted-foreground">Pipeline</div>
        <div className="font-bold text-foreground text-sm">£182k</div>
        <div className="text-emerald-500 text-[8px]">+12%</div>
      </div>
      <div className="rounded bg-orange-500/10 border border-orange-500/30 p-1.5">
        <div className="text-muted-foreground">Won (30d)</div>
        <div className="font-bold text-orange-500 text-sm">£48k</div>
        <div className="text-orange-500 text-[8px]">3 deals</div>
      </div>
      <div className="col-span-2 flex items-end gap-0.5 h-8">
        {[3, 5, 4, 7, 6, 9, 8, 11, 9, 13, 11, 14].map((h, i) => (
          <div
            key={i}
            className={`flex-1 rounded-sm ${i === 11 ? 'bg-orange-500' : 'bg-foreground/40'}`}
            style={{ height: `${h * 5}%` }}
          />
        ))}
      </div>
    </div>
  );
}

function WorkspaceScopeVisual() {
  return (
    <div className="h-full flex flex-col gap-1.5 text-[10px]">
      <div className="rounded bg-card border border-primary/40 px-2 py-1 text-primary flex items-center justify-between">
        <span className="font-semibold">Acme workspace</span>
        <span className="text-[9px]">selected</span>
      </div>
      <div className="rounded bg-muted/40 px-2 py-1 text-muted-foreground">Globex workspace</div>
      <div className="rounded bg-muted/40 px-2 py-1 text-muted-foreground">Initech workspace</div>
      <div className="text-[9px] text-muted-foreground text-center mt-0.5">CRM shows 12 Acme deals only</div>
    </div>
  );
}

function ImportVisual() {
  return (
    <div className="h-full flex flex-col gap-1 text-[9px]">
      <div className="rounded bg-card border border-border/60 px-1.5 py-1 flex items-center justify-between">
        <span className="text-foreground/85">contacts.csv</span>
        <span className="rounded bg-emerald-500/20 text-emerald-500 px-1">142 rows</span>
      </div>
      <div className="grid grid-cols-2 gap-0.5">
        {[
          ['first_name', 'First name'],
          ['email', 'Email'],
          ['phone', 'Phone'],
          ['job_title', 'Job title'],
        ].map(([from, to]) => (
          <div key={from} className="rounded bg-muted/40 px-1 py-0.5 text-[8px] flex items-center gap-0.5">
            <span className="text-muted-foreground truncate">{from}</span>
            <span className="text-orange-500">→</span>
            <span className="text-foreground/85 truncate">{to}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function CurrencyVisual() {
  return (
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
}

function NotesVisual() {
  return (
    <div className="space-y-1 h-full text-[10px]">
      {[
        'Follow up Tuesday with proposal',
        'They liked the pricing page',
        'Send onboarding kit + Meet link',
      ].map((t, i) => (
        <motion.div
          key={i}
          initial={{ opacity: 0, x: -8 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true }}
          transition={{ delay: i * 0.2 }}
          className="rounded bg-card border border-border/60 px-2 py-1 text-foreground/85"
        >
          {t}
        </motion.div>
      ))}
    </div>
  );
}

function MeetVisual() {
  return (
    <div className="h-full flex items-center gap-3 text-[10px]">
      <div className="h-10 w-10 rounded-lg bg-emerald-500/15 grid place-items-center text-emerald-500 font-bold">
        Meet
      </div>
      <div className="flex-1">
        <div className="font-semibold text-foreground">Acme onboarding</div>
        <div className="text-muted-foreground">Tomorrow · 3:00 PM</div>
        <div className="mt-1 text-emerald-500">✓ Calendar invite sent</div>
      </div>
    </div>
  );
}

function HrVisual() {
  return (
    <div className="h-full grid grid-cols-2 gap-1 text-[10px]">
      {[
        { label: 'People', val: '24' },
        { label: 'On leave', val: '2' },
        { label: 'Payroll', val: '£62k' },
        { label: 'Time this wk', val: '748h', accent: true },
      ].map((k) => (
        <div
          key={k.label}
          className={`rounded p-1.5 ${k.accent ? 'bg-orange-500/10 border border-orange-500/30' : 'bg-card border border-border/60'}`}
        >
          <div className="text-muted-foreground text-[8px] uppercase">{k.label}</div>
          <div className={`font-bold ${k.accent ? 'text-orange-500' : 'text-foreground'}`}>{k.val}</div>
        </div>
      ))}
    </div>
  );
}

function TimelineVisual() {
  return (
    <div className="space-y-1 h-full">
      {[
        { name: 'Design', start: 0, len: 40 },
        { name: 'Backend', start: 25, len: 50, accent: true },
        { name: 'Frontend', start: 35, len: 55 },
        { name: 'Beta', start: 60, len: 30 },
      ].map((r) => (
        <div key={r.name} className="flex items-center gap-1 text-[9px]">
          <div className="w-12 shrink-0 text-foreground/80 truncate">{r.name}</div>
          <div className="flex-1 h-2.5 rounded bg-muted/30 relative overflow-hidden">
            <div
              className={`absolute top-0 h-full rounded ${r.accent ? 'bg-orange-500' : 'bg-foreground/40'}`}
              style={{ left: `${r.start}%`, width: `${r.len}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function TeamVisual() {
  return (
    <div className="h-full flex items-center gap-3 text-[10px]">
      <div className="flex -space-x-2">
        {['F', 'A', 'M', 'S'].map((c, i) => (
          <div key={i} className={`h-6 w-6 rounded-full border-2 border-card grid place-items-center text-[9px] font-bold ${['bg-orange-500/80', 'bg-emerald-500/80', 'bg-sky-500/80', 'bg-purple-500/80'][i]} text-white`}>
            {c}
          </div>
        ))}
      </div>
      <div className="flex-1">
        <div className="text-foreground/85">@faraz mentioned you</div>
        <div className="text-muted-foreground">2 min ago</div>
      </div>
    </div>
  );
}

function CalSyncVisual() {
  return (
    <div className="h-full flex items-center gap-3 text-[10px]">
      <div className="h-10 w-10 rounded-lg bg-blue-500/15 grid place-items-center text-blue-500 text-xs font-bold">
        G
      </div>
      <div className="flex-1">
        <div className="font-semibold text-foreground">Google Calendar</div>
        <div className="text-muted-foreground">Auto-syncs task Meets</div>
        <div className="text-emerald-500 mt-0.5">✓ OAuth connected</div>
      </div>
    </div>
  );
}

export default FeaturesSection;
