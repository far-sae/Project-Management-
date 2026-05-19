import { motion } from "framer-motion";
import {
  LayoutList, MessageSquare, BarChart3, Calendar, Users,
  Bot, Zap, Plug, MessageCircle, type LucideIcon,
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
    icon: Calendar,
    title: "Real meeting attached",
    description: "Pick a date and time and we'll create a Google Calendar event with a Meet link and invite everyone — without leaving the task.",
    accentClass: "bg-emerald-500/15 text-emerald-500",
    visual: <MeetVisual />,
  },
  {
    icon: BarChart3,
    title: "Analytics that update live",
    description: "Throughput, cycle time, workload, win rate, forecast — Monday-style dashboards built from your real data.",
    accentClass: "bg-amber-500/15 text-amber-500",
    visual: <AnalyticsVisual />,
  },
  {
    icon: Zap,
    title: "Automation engine",
    description: "When a deal moves to Won, fire any combination of: create task, Slack message, send email, webhook, change owner.",
    accentClass: "bg-yellow-500/15 text-yellow-500",
    visual: <AutomationVisual />,
  },
  {
    icon: Bot,
    title: "AI sales agent",
    description: "Lead scoring, follow-up suggestions, draft replies — all gated behind a Review/Approve button so nothing sends without you.",
    accentClass: "bg-purple-500/15 text-purple-500",
    visual: <AgentVisual />,
  },
  {
    icon: MessageCircle,
    title: "Telegram (and WhatsApp soon)",
    description: "Text the bot in plain English: 'add task call John tomorrow 3pm in Q1 launch'. It confirms, you tap Yes.",
    accentClass: "bg-sky-500/15 text-sky-500",
    visual: <TelegramVisual />,
  },
  {
    icon: Users,
    title: "Real-time team",
    description: "Comments, mentions, presence, notifications, and an inbox — built in. No second tool for chat.",
    accentClass: "bg-rose-500/15 text-rose-500",
    visual: <TeamVisual />,
  },
  {
    icon: MessageSquare,
    title: "CRM with pipelines",
    description: "Clients, deals, custom stages, lead forms, dedup, scoring — a real CRM next to your project work, not in another app.",
    accentClass: "bg-pink-500/15 text-pink-500",
    visual: <CrmVisual />,
  },
  {
    icon: Plug,
    title: "Integrations done right",
    description: "Google Calendar / Meet / Gmail, Slack triggers and posts, Cloudflare Turnstile on lead forms. OAuth tokens encrypted at rest.",
    accentClass: "bg-indigo-500/15 text-indigo-500",
    visual: <IntegrationsVisual />,
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
            Built to replace 5 tools
          </p>
          <h2 className="text-3xl sm:text-4xl font-extrabold text-foreground mb-3">
            Everything your team needs.
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Project management, CRM, automation, AI, and chat-bot control —
            one workspace, one data model, one bill.
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

function AnalyticsVisual() {
  return (
    <div className="flex items-end gap-1 h-full">
      {[3, 5, 4, 7, 6, 9, 8, 11, 9, 13, 11, 14].map((h, i) => (
        <motion.div
          key={i}
          initial={{ scaleY: 0 }}
          whileInView={{ scaleY: 1 }}
          viewport={{ once: true }}
          transition={{ delay: i * 0.04, duration: 0.5 }}
          style={{ originY: 1, height: `${h * 6}%` }}
          className={`flex-1 rounded-sm ${i === 11 ? 'bg-orange-500' : 'bg-foreground/40'}`}
        />
      ))}
    </div>
  );
}

function AutomationVisual() {
  return (
    <div className="h-full flex flex-col justify-center gap-1 text-[10px]">
      <div className="rounded bg-card border border-border/60 px-2 py-1">
        <span className="text-muted-foreground">When </span>
        <span className="text-orange-500">deal → Won</span>
      </div>
      <div className="rounded bg-card border border-border/60 px-2 py-1">
        <span className="text-muted-foreground">Then </span>
        <span className="text-foreground/90">create task + Slack #wins</span>
      </div>
    </div>
  );
}

function AgentVisual() {
  return (
    <div className="space-y-1 h-full text-[10px]">
      {[
        '📈 Acme opened your proposal 4× today',
        '✍️  Drafted follow-up — review?',
        '🎯 Lead score: 62 → 84',
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

function TelegramVisual() {
  return (
    <div className="h-full flex flex-col justify-center gap-1 text-[10px]">
      <div className="self-start max-w-[80%] rounded-lg rounded-tl-sm bg-muted/50 px-2 py-1">
        task: call John tomorrow 3pm
      </div>
      <div className="self-end max-w-[80%] rounded-lg rounded-tr-sm bg-orange-500/15 px-2 py-1">
        Create task <strong>call John</strong>?
      </div>
      <div className="self-end flex gap-1">
        <span className="rounded bg-emerald-500/20 text-emerald-500 px-1.5 text-[9px]">✓ Confirm</span>
      </div>
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

function CrmVisual() {
  return (
    <div className="space-y-1 h-full text-[10px]">
      {[
        { name: 'Lead', pct: 100 },
        { name: 'Proposal', pct: 60 },
        { name: 'Won', pct: 30, accent: true },
      ].map((s) => (
        <div key={s.name} className="flex items-center gap-2">
          <span className="w-14 text-muted-foreground">{s.name}</span>
          <div className="flex-1 h-2 rounded bg-muted/50 overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              whileInView={{ width: `${s.pct}%` }}
              viewport={{ once: true }}
              transition={{ duration: 1, ease: 'easeOut' }}
              className={`h-full rounded ${s.accent ? 'bg-orange-500' : 'bg-foreground/40'}`}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function IntegrationsVisual() {
  return (
    <div className="grid grid-cols-3 gap-2 h-full place-items-center text-[10px]">
      {['Google', 'Slack', 'Gmail', 'Meet', 'Telegram', 'Stripe'].map((n) => (
        <div key={n} className="rounded bg-card border border-border/60 px-2 py-1 text-foreground/85">{n}</div>
      ))}
    </div>
  );
}

export default FeaturesSection;
