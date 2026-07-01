import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import {
  ArrowRight, Check, Sparkles, Trophy, TrendingUp, Video, StickyNote,
} from "lucide-react";
import { Link } from "react-router-dom";

const float = (delay = 0, duration = 6) => ({
  y: [0, -10, 0],
  transition: {
    duration,
    delay,
    repeat: Infinity,
    ease: "easeInOut" as const,
  },
});

const HeroSection = () => {
  return (
    <section className="relative pt-[calc(7rem+1px)] pb-24 overflow-hidden">
      {/* Ambient glow */}
      <div className="absolute inset-0 -z-10">
        <div className="absolute top-20 left-[10%] w-[28rem] h-[28rem] bg-primary/10 rounded-full blur-3xl" />
        <div className="absolute bottom-0 right-[5%] w-[24rem] h-[24rem] bg-orange-500/10 rounded-full blur-3xl" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[40rem] h-[40rem] bg-purple-500/5 rounded-full blur-3xl" />
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
          {/* Left — copy + CTAs */}
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.05 }}
              className="inline-flex items-center gap-2 rounded-full border border-border bg-card/60 backdrop-blur px-3 py-1 text-xs text-muted-foreground mb-6"
            >
              <Sparkles className="h-3 w-3 text-orange-500" />
              <span>New: CRM Hub with Deal-Won → project handoff</span>
            </motion.div>

            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold leading-[1.05] tracking-tight mb-6">
              Close the deal.<br />
              Ship the <span className="text-gradient">work.</span>
            </h1>

            <p className="text-lg text-muted-foreground max-w-xl mb-8 leading-relaxed">
              Plan projects, run your sales pipeline, and hand every won deal
              straight into a project workspace — one login, one data model,
              one bill.
            </p>

            <div className="flex flex-col sm:flex-row gap-3 max-w-md mb-6">
              <Button size="lg" className="h-12 px-6 shrink-0 group" asChild>
                <Link to="/signup">
                  Get started free
                  <ArrowRight size={16} className="transition-transform group-hover:translate-x-0.5" />
                </Link>
              </Button>
              <Button size="lg" variant="outline" className="h-12 px-6" asChild>
                <Link to="/login">Log in</Link>
              </Button>
            </div>

            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5"><Check className="h-3.5 w-3.5 text-emerald-500" /> 28 day free trial</span>
              <span className="flex items-center gap-1.5"><Check className="h-3.5 w-3.5 text-emerald-500" /> No credit card</span>
              <span className="flex items-center gap-1.5"><Check className="h-3.5 w-3.5 text-emerald-500" /> Cancel anytime</span>
            </div>
          </motion.div>

          {/* Right — floating multi-card mockup */}
          <motion.div
            initial={{ opacity: 0, x: 40 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.7, delay: 0.15 }}
            className="relative h-[480px]"
          >
            {/* Card 1 — Kanban (primary) */}
            <motion.div
              animate={float(0, 7)}
              className="absolute top-4 left-2 right-2 bg-card rounded-2xl border border-border shadow-2xl shadow-primary/10 p-5 z-20"
            >
              <div className="flex items-center gap-2 mb-4">
                <div className="w-3 h-3 rounded-full bg-rose-400/70" />
                <div className="w-3 h-3 rounded-full bg-amber-400/70" />
                <div className="w-3 h-3 rounded-full bg-emerald-400/70" />
                <span className="ml-2 text-xs font-semibold text-foreground/90">Sprint Board · Q2 launch</span>
                <span className="ml-auto text-[10px] text-muted-foreground">Live</span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <KanbanColumn title="To do" items={['Design homepage', 'Write API docs']} />
                <KanbanColumn title="In progress" items={['Build dashboard', 'User auth']} accent />
                <KanbanColumn title="Done" items={['Setup CI/CD']} />
              </div>
            </motion.div>

            {/* Card 2 — Deal Won → Project handoff (top right) */}
            <motion.div
              animate={float(0.5, 8)}
              className="absolute -top-2 -right-2 w-64 bg-card rounded-2xl border border-border shadow-xl shadow-emerald-500/10 p-3 z-30"
            >
              <div className="flex items-center gap-2 mb-2">
                <div className="h-7 w-7 rounded-full bg-emerald-500/15 grid place-items-center">
                  <Trophy className="h-3.5 w-3.5 text-emerald-500" />
                </div>
                <div className="text-xs">
                  <div className="font-semibold text-foreground/90">Deal Won: Acme Corp</div>
                  <div className="text-[10px] text-muted-foreground">£48,000 · closed today</div>
                </div>
              </div>
              <button className="w-full rounded-lg bg-emerald-500 text-white text-[11px] font-semibold px-2 py-1.5">
                → Create workspace & project
              </button>
              <div className="mt-1.5 text-[10px] text-muted-foreground text-center">
                One click into <strong>project management</strong>
              </div>
            </motion.div>

            {/* Card 3 — CRM funnel (bottom right) */}
            <motion.div
              animate={float(1.2, 9)}
              className="absolute bottom-2 right-0 w-64 bg-card rounded-2xl border border-border shadow-xl shadow-orange-500/10 p-3 z-30"
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground/90">
                  <TrendingUp className="h-3.5 w-3.5 text-orange-500" />
                  Pipeline
                </div>
                <div className="text-[10px] text-emerald-500 font-medium">+12%</div>
              </div>
              <FunnelMini />
            </motion.div>

            {/* Card 4 — Google Meet pill (left middle) */}
            <motion.div
              animate={float(0.8, 6)}
              className="absolute top-32 -left-2 bg-card rounded-xl border border-border shadow-lg shadow-emerald-500/10 px-3 py-2 flex items-center gap-2 z-30"
            >
              <Video className="h-4 w-4 text-emerald-500" />
              <div className="text-[11px]">
                <div className="font-semibold text-foreground/90">Meet attached</div>
                <div className="text-muted-foreground">Tomorrow · 3:00 PM</div>
              </div>
            </motion.div>

            {/* Card 5 — Note on contact (bottom left) */}
            <motion.div
              animate={float(1.8, 7)}
              className="absolute bottom-4 -left-2 w-56 bg-card rounded-xl border border-border shadow-lg shadow-amber-500/10 p-3 z-30"
            >
              <div className="flex items-center gap-2 mb-1.5">
                <div className="h-6 w-6 rounded-full bg-amber-500/15 grid place-items-center">
                  <StickyNote className="h-3.5 w-3.5 text-amber-500" />
                </div>
                <span className="text-xs font-semibold text-foreground/90">Note · Acme Corp</span>
              </div>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                Follow up next Tuesday. They want the pricing PDF and a
                proposal template.
              </p>
            </motion.div>
          </motion.div>
        </div>
      </div>
    </section>
  );
};

// ── Small inline mock components ────────────────────────────────────────────

const KanbanColumn: React.FC<{
  title: string;
  items: string[];
  accent?: boolean;
}> = ({ title, items, accent }) => (
  <div className={`rounded-lg p-2 ${accent ? 'bg-orange-500/5 border border-orange-500/20' : 'bg-muted/40'}`}>
    <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-2">{title}</div>
    <div className="space-y-1.5">
      {items.map((it) => (
        <div key={it} className="bg-card rounded-md px-2 py-1.5 text-[11px] text-foreground/90 border border-border/60">
          {it}
        </div>
      ))}
    </div>
  </div>
);

const FunnelMini: React.FC = () => {
  const stages = [
    { name: 'Lead', pct: 100, accent: false },
    { name: 'Qualified', pct: 70, accent: false },
    { name: 'Proposal', pct: 45, accent: false },
    { name: 'Won', pct: 25, accent: true },
  ];
  return (
    <div className="space-y-1">
      {stages.map((s) => (
        <div key={s.name} className="flex items-center gap-2 text-[10px]">
          <span className="w-14 shrink-0 text-muted-foreground">{s.name}</span>
          <div className="flex-1 h-3 rounded bg-muted/50 overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${s.pct}%` }}
              transition={{ duration: 1.4, delay: 0.6, ease: 'easeOut' }}
              className={`h-full rounded ${s.accent ? 'bg-orange-500' : 'bg-foreground/40'}`}
            />
          </div>
        </div>
      ))}
    </div>
  );
};

export default HeroSection;
