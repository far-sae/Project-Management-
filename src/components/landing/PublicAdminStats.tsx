import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import {
  Users,
  Building2,
  FolderKanban,
  ListTodo,
  CreditCard,
  TrendingUp,
  TrendingDown,
  Loader2,
  BarChart3,
} from "lucide-react";
import { supabase } from "@/services/supabase/config";

interface PublicStats {
  totalUsers: number;
  totalOrganizations: number;
  totalProjects: number;
  totalTasks: number;
  newUsersThisMonth: number;
  activeTrials: number;
  byPlan: { starter: number; basic: number; advanced: number; premium: number };
  totalActiveSubscriptions: number;
  totalActiveWithTrial: number;
  churned: number;
  churnRate: number;
}

const PublicAdminStats = () => {
  const [stats, setStats] = useState<PublicStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const { data, error: fnError } = await supabase.functions.invoke("public-stats");
        if (fnError) throw fnError;
        if (data?.error) throw new Error(data.error);
        setStats(data as PublicStats);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load stats");
      } finally {
        setLoading(false);
      }
    };
    fetchStats();
  }, []);

  if (loading) {
    return (
      <section className="py-16 bg-secondary/30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col items-center justify-center gap-4 py-12">
            <Loader2 className="h-10 w-10 animate-spin text-primary" />
            <p className="text-muted-foreground">Loading usage stats...</p>
          </div>
        </div>
      </section>
    );
  }

  if (error || !stats) {
    return (
      <section className="py-16 bg-secondary/30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="rounded-xl border border-dashed border-muted-foreground/30 bg-muted/30 p-8 text-center">
            <BarChart3 className="mx-auto h-10 w-10 text-muted-foreground mb-2" />
            <p className="text-muted-foreground">
              {error || "Stats are temporarily unavailable."}
            </p>
          </div>
        </div>
      </section>
    );
  }

  const cards = [
    {
      icon: Users,
      label: "Active users",
      value: stats.totalUsers,
      sub: `+${stats.newUsersThisMonth} this month`,
    },
    {
      icon: Building2,
      label: "Organizations",
      value: stats.totalOrganizations,
    },
    {
      icon: FolderKanban,
      label: "Projects",
      value: stats.totalProjects,
      desc: "Project boards in use",
    },
    {
      icon: ListTodo,
      label: "Tasks",
      value: stats.totalTasks,
      desc: "Tasks tracked",
    },
  ];

  const tierLabels = [
    { key: "starter", label: "Starter", color: "text-slate-600" },
    { key: "basic", label: "Basic", color: "text-blue-600" },
    { key: "advanced", label: "Advanced", color: "text-purple-600" },
    { key: "premium", label: "Premium", color: "text-amber-600" },
  ];

  return (
    <section id="admin-stats" className="py-24 bg-secondary/30">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="text-center mb-12"
        >
          <h2 className="text-3xl sm:text-4xl font-extrabold text-foreground mb-4">
            Service at a glance
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            See how many people use our service, which plans they&apos;re on, and usage stats — no login required.
          </p>
        </motion.div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-6 mb-10">
          {cards.map((c, i) => (
            <motion.div
              key={c.label}
              initial={{ opacity: 0, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.3, delay: i * 0.05 }}
              className="rounded-xl border bg-card p-5 shadow-sm"
            >
              <div className="flex items-center gap-3 mb-2">
                <div className="rounded-lg bg-primary/10 p-2">
                  <c.icon className="h-5 w-5 text-primary" />
                </div>
                <span className="text-sm font-medium text-muted-foreground">{c.label}</span>
              </div>
              <p className="text-2xl font-bold text-foreground">{c.value.toLocaleString()}</p>
              {c.sub && <p className="text-xs text-muted-foreground mt-1">{c.sub}</p>}
              {c.desc && <p className="text-xs text-muted-foreground mt-1">{c.desc}</p>}
            </motion.div>
          ))}
        </div>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6"
        >
          <div className="rounded-xl border bg-card p-5 shadow-sm">
            <div className="flex items-center gap-2 mb-3">
              <CreditCard className="h-5 w-5 text-primary" />
              <span className="font-medium">Subscription breakdown</span>
            </div>
            <div className="space-y-2">
              {tierLabels.map(({ key, label, color }) => (
                <div key={key} className="flex justify-between text-sm">
                  <span className={color}>{label}</span>
                  <span className="font-medium">
                    {(stats.byPlan as Record<string, number>)[key] ?? 0}
                  </span>
                </div>
              ))}
              <div className="flex justify-between text-sm pt-2 border-t">
                <span className="text-muted-foreground">Trials</span>
                <span className="font-medium">{stats.activeTrials}</span>
              </div>
            </div>
          </div>

          <div className="rounded-xl border bg-card p-5 shadow-sm">
            <div className="flex items-center gap-2 mb-3">
              <TrendingUp className="h-5 w-5 text-green-500" />
              <span className="font-medium">Active subscriptions</span>
            </div>
            <p className="text-2xl font-bold text-foreground">
              {stats.totalActiveSubscriptions.toLocaleString()}
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              {stats.totalActiveWithTrial} including trials
            </p>
          </div>

          <div className="rounded-xl border bg-card p-5 shadow-sm">
            <div className="flex items-center gap-2 mb-3">
              <TrendingDown className="h-5 w-5 text-amber-500" />
              <span className="font-medium">People leaving</span>
            </div>
            <p className="text-2xl font-bold text-foreground">{stats.churned.toLocaleString()}</p>
            <p className="text-sm text-muted-foreground mt-1">
              Churn rate: {stats.churnRate}%
            </p>
          </div>
        </motion.div>
      </div>
    </section>
  );
};

export default PublicAdminStats;
