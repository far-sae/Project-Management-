import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Loader2, Plus, MoreVertical, ArrowUp, ArrowDown, Trash2, Sparkles, AlertTriangle,
  Send, Pin, X,
} from "lucide-react";
import { useOrganization } from "@/context/OrganizationContext";
import { useAuth } from "@/context/AuthContext";
import { useFormatMoney } from "@/hooks/useFormatMoney";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { ChartCard } from "@/components/dashboards/ChartCard";
import { KpiTile } from "@/components/dashboards/KpiTile";
import { StatusDonut, type DonutDatum } from "@/components/dashboards/StatusDonut";
import { TrendArea, type TrendDatum } from "@/components/dashboards/TrendArea";
import { BarHorizontal, type HBarDatum } from "@/components/dashboards/BarHorizontal";
import { PipelineFunnel, type FunnelDatum } from "@/components/dashboards/PipelineFunnel";

import {
  METRICS, getMetric, type ChartType, type DataPoint, type SeriesPoint, type MetricResult,
} from "@/services/dashboards/metrics";
import {
  getOrCreateMyDashboard, saveWidgets, type Dashboard, type Widget,
} from "@/services/dashboards/dashboards";
import {
  addWidget, removeWidget, reorderWidget, setWidgetSize, type WidgetSize,
} from "@/lib/dashboardWidgets";
import {
  askDashboardAI, isFailure, type AiWidgetSpec,
} from "@/services/dashboards/askDashboardAI";

const SIZE_SPAN: Record<WidgetSize, string> = {
  sm: "lg:col-span-1",
  md: "lg:col-span-2",
  lg: "lg:col-span-4",
};

const TIMEFRAMES: { id: string; label: string }[] = [
  { id: "30d", label: "Last 30 days" },
  { id: "90d", label: "Last 90 days" },
  { id: "qtd", label: "Quarter to date" },
  { id: "ytd", label: "Year to date" },
];

const CHART_LABEL: Record<ChartType, string> = {
  kpi: "KPI tile",
  bar: "Bar",
  line: "Line",
  donut: "Donut",
  funnel: "Funnel",
};

// Money metrics → format the KPI value as currency.
const MONEY_METRICS = new Set([
  "open_pipeline_value",
  "invoices_outstanding",
  "bills_payable",
]);

const isDataPoints = (r: MetricResult): r is DataPoint[] =>
  Array.isArray(r) && (r.length === 0 || "label" in (r[0] as object));
const isSeries = (r: MetricResult): r is SeriesPoint[] =>
  Array.isArray(r) && r.length > 0 && "date" in (r[0] as object);

// ─────────────────────────────────────────────────────────────────────────────
// One widget: runs its metric, handles loading/error/no-data, renders a chart.
// Wrapped so a single failing metric never takes down the grid.
// ─────────────────────────────────────────────────────────────────────────────

const WidgetView: React.FC<{
  widget: Widget;
  orgId: string;
  fmtMoney: (n: number, c?: string) => string;
  onReorder?: (dir: "up" | "down") => void;
  onResize?: (size: WidgetSize) => void;
  onRemove?: () => void;
  // Preview mode (AI Ask): render the chart exactly the same way but drop the
  // per-widget arrange/size/remove menu (the preview has its own controls).
  hideMenu?: boolean;
}> = ({ widget, orgId, fmtMoney, onReorder, onResize, onRemove, hideMenu }) => {
  const [result, setResult] = useState<MetricResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const metric = getMetric(widget.metricId);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    if (!metric) {
      setError("Unknown metric");
      setLoading(false);
      return;
    }
    metric
      .compute(orgId, { dimension: widget.dimension, timeframe: widget.timeframe })
      .then((r) => {
        if (active) {
          setResult(r);
          setLoading(false);
        }
      })
      .catch(() => {
        if (active) {
          setError("Couldn't load this metric");
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [metric, orgId, widget.dimension, widget.timeframe]);

  const menu = hideMenu ? null : (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-7 w-7 -mr-1">
          <MoreVertical className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuLabel className="text-xs">Arrange</DropdownMenuLabel>
        <DropdownMenuItem onClick={() => onReorder?.("up")}>
          <ArrowUp className="mr-2 h-4 w-4" /> Move up
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onReorder?.("down")}>
          <ArrowDown className="mr-2 h-4 w-4" /> Move down
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs">Size</DropdownMenuLabel>
        {(["sm", "md", "lg"] as const).map((s) => (
          <DropdownMenuItem
            key={s}
            onClick={() => onResize?.(s)}
            className={widget.size === s ? "font-medium text-foreground" : ""}
          >
            {s === "sm" ? "Small" : s === "md" ? "Medium" : "Large"}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onRemove} className="text-rose-600 focus:text-rose-600">
          <Trash2 className="mr-2 h-4 w-4" /> Remove
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const inlineState = (icon: React.ReactNode, text: string) => (
    <div className="h-full grid place-items-center text-sm text-muted-foreground gap-1 text-center px-4">
      <div className="flex flex-col items-center gap-1">
        {icon}
        <span>{text}</span>
      </div>
    </div>
  );

  // KPI is rendered without ChartCard (the tile is its own card), but we keep
  // the per-widget menu in a small floating control.
  if (widget.chartType === "kpi") {
    let value: string | number = "—";
    if (loading) value = "…";
    else if (!error && typeof result === "number") {
      value = MONEY_METRICS.has(widget.metricId)
        ? fmtMoney(result)
        : result.toLocaleString();
    }
    return (
      <div className="relative">
        <div className="absolute right-2 top-2 z-10">{menu}</div>
        <KpiTile
          label={widget.title}
          value={value}
          hint={error ?? undefined}
        />
      </div>
    );
  }

  let body: React.ReactNode;
  if (loading) {
    body = (
      <div className="h-full grid place-items-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  } else if (error) {
    body = inlineState(<AlertTriangle className="h-5 w-5 text-amber-500" />, error);
  } else if (result == null || (Array.isArray(result) && result.length === 0)) {
    body = inlineState(null, "No data");
  } else if (widget.chartType === "line") {
    const data: TrendDatum[] = isSeries(result)
      ? result.map((p) => ({ label: p.date, value: p.value }))
      : [];
    const moneyish = MONEY_METRICS.has(widget.metricId) || /value|paid|expense|bill/i.test(widget.metricId);
    body = (
      <TrendArea
        data={data}
        primaryName={widget.title}
        yFormatter={moneyish ? (v) => fmtMoney(v).replace(/\.00$/, "") : undefined}
      />
    );
  } else if (widget.chartType === "donut") {
    const data: DonutDatum[] = isDataPoints(result)
      ? result.map((p) => ({ name: p.label, value: p.value }))
      : [];
    const total = data.reduce((s, d) => s + d.value, 0);
    body = (
      <StatusDonut data={data} centerValue={total.toLocaleString()} />
    );
  } else if (widget.chartType === "funnel") {
    const data: FunnelDatum[] = isDataPoints(result)
      ? result.map((p) => ({ stage: p.label, count: p.value }))
      : [];
    body = <PipelineFunnel data={data} />;
  } else {
    // bar (default)
    const data: HBarDatum[] = isDataPoints(result)
      ? result.map((p) => ({ name: p.label, value: p.value }))
      : [];
    const moneyish = /value|paid|expense|bill/i.test(widget.metricId);
    body = (
      <BarHorizontal data={data} valueFormatter={moneyish ? fmtMoney : undefined} highlightTop />
    );
  }

  return (
    <ChartCard
      title={widget.title}
      subtitle={metric ? metric.label : undefined}
      bodyHeight="h-64"
      action={menu}
    >
      {body}
    </ChartCard>
  );
};

// Catch render-time errors per widget so one bad widget never blanks the grid.
class WidgetBoundary extends React.Component<
  { children: React.ReactNode; title: string },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed) {
      return (
        <Card>
          <CardContent className="h-64 grid place-items-center text-center text-sm text-muted-foreground p-4">
            <div className="flex flex-col items-center gap-1">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              <span>{this.props.title}: failed to render</span>
            </div>
          </CardContent>
        </Card>
      );
    }
    return this.props.children;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Add-widget dialog
// ─────────────────────────────────────────────────────────────────────────────

const AddWidgetDialog: React.FC<{
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onAdd: (w: Widget) => void;
  nextOrder: number;
}> = ({ open, onOpenChange, onAdd, nextOrder }) => {
  const [metricId, setMetricId] = useState<string>(METRICS[0]?.id ?? "");
  const metric = getMetric(metricId);
  const [chartType, setChartType] = useState<ChartType>(metric?.defaultChart ?? "bar");
  const [dimension, setDimension] = useState<string | undefined>(undefined);
  const [timeframe, setTimeframe] = useState<string>("90d");
  const [title, setTitle] = useState<string>(metric?.label ?? "");
  const [size, setSize] = useState<WidgetSize>("md");

  // Reset dependent fields whenever the chosen metric changes.
  useEffect(() => {
    const m = getMetric(metricId);
    if (!m) return;
    setChartType(m.defaultChart);
    setDimension(m.dimensions?.[0]?.id);
    setTitle(m.label);
  }, [metricId]);

  const grouped = useMemo(() => {
    const groups: Record<string, typeof METRICS> = {};
    for (const m of METRICS) (groups[m.group] ??= []).push(m);
    return groups;
  }, []);

  const submit = () => {
    if (!metric) return;
    onAdd({
      id: crypto.randomUUID(),
      metricId,
      title: title.trim() || metric.label,
      chartType,
      dimension: metric.dimensions ? dimension : undefined,
      timeframe: metric.timeframe ? timeframe : undefined,
      size,
      order: nextOrder,
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add a widget</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Metric</Label>
            <Select value={metricId} onValueChange={setMetricId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(grouped).map(([group, list]) => (
                  <React.Fragment key={group}>
                    <div className="px-2 py-1 text-xs font-medium text-muted-foreground">{group}</div>
                    {list.map((m) => (
                      <SelectItem key={m.id} value={m.id}>{m.label}</SelectItem>
                    ))}
                  </React.Fragment>
                ))}
              </SelectContent>
            </Select>
          </div>

          {metric?.dimensions && metric.dimensions.length > 0 && (
            <div className="space-y-1.5">
              <Label>Breakdown</Label>
              <Select value={dimension} onValueChange={setDimension}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {metric.dimensions.map((d) => (
                    <SelectItem key={d.id} value={d.id}>{d.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Chart type</Label>
            <Select value={chartType} onValueChange={(v) => setChartType(v as ChartType)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {(metric?.chartTypes ?? []).map((c) => (
                  <SelectItem key={c} value={c}>{CHART_LABEL[c]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {metric?.timeframe && (
            <div className="space-y-1.5">
              <Label>Timeframe</Label>
              <Select value={timeframe} onValueChange={setTimeframe}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TIMEFRAMES.map((t) => (
                    <SelectItem key={t.id} value={t.id}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>

          <div className="space-y-1.5">
            <Label>Size</Label>
            <Select value={size} onValueChange={(v) => setSize(v as WidgetSize)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="sm">Small (1 column)</SelectItem>
                <SelectItem value="md">Medium (2 columns)</SelectItem>
                <SelectItem value="lg">Large (full width)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={!metric}>Add widget</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Ask AI — plain-English question → constrained widget spec + takeaway.
// The preview reuses the EXACT widget render path (WidgetView) so what the
// user previews is what gets pinned. A "Pin to dashboard" turns the spec into
// a real Widget; "Dismiss" clears the preview.
// ─────────────────────────────────────────────────────────────────────────────

// Turn an AI spec into a renderable Widget. `order` is filled at pin time.
const specToWidget = (spec: AiWidgetSpec, order: number, size: WidgetSize = "md"): Widget => ({
  id: crypto.randomUUID(),
  metricId: spec.metricId,
  title: spec.title,
  chartType: spec.chartType,
  dimension: spec.dimension,
  timeframe: spec.timeframe,
  size,
  order,
});

const AskAi: React.FC<{
  orgId: string;
  fmtMoney: (n: number, c?: string) => string;
  onPin: (spec: AiWidgetSpec) => void;
}> = ({ orgId, fmtMoney, onPin }) => {
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ spec: AiWidgetSpec; takeaway: string } | null>(null);

  const submit = async () => {
    const q = question.trim();
    if (!q || loading) return;
    setLoading(true);
    setError(null);
    setPreview(null);
    const result = await askDashboardAI(orgId, q);
    setLoading(false);
    if (isFailure(result)) {
      setError(result.error);
      return;
    }
    setPreview({ spec: result.widget, takeaway: result.takeaway });
  };

  // A self-contained, full-width preview widget (md size). order is a
  // placeholder for rendering only — the real order is assigned on pin.
  const previewWidget = useMemo(
    () => (preview ? specToWidget(preview.spec, 0, "lg") : null),
    [preview],
  );

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <Sparkles className="h-4 w-4 text-orange-500" /> Ask AI
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          <Input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void submit();
              }
            }}
            placeholder='Ask a question, e.g. "won value by month" or "leads by status"'
            disabled={loading}
          />
          <Button onClick={() => void submit()} disabled={loading || !question.trim()}>
            {loading ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <Send className="mr-1 h-4 w-4" />
            )}
            Ask
          </Button>
        </div>

        {error && (
          <div className="flex items-start gap-2 rounded-md bg-amber-50 dark:bg-amber-950/30 p-3 text-sm text-amber-700 dark:text-amber-400">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {preview && previewWidget && (
          <div className="space-y-2 rounded-lg border border-dashed border-orange-300 dark:border-orange-800 p-3">
            <WidgetView
              widget={previewWidget}
              orgId={orgId}
              fmtMoney={fmtMoney}
              hideMenu
            />
            {preview.takeaway && (
              <p className="text-sm text-muted-foreground px-1">{preview.takeaway}</p>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setPreview(null)}>
                <X className="mr-1 h-4 w-4" /> Dismiss
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  onPin(preview.spec);
                  setPreview(null);
                  setQuestion("");
                }}
              >
                <Pin className="mr-1 h-4 w-4" /> Pin to dashboard
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────

export const InsightsDashboard: React.FC = () => {
  const { organization } = useOrganization();
  const { user } = useAuth();
  const fmtMoney = useFormatMoney();

  const orgId = organization?.organizationId ?? "";
  const userId = user?.userId ?? "";

  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  useEffect(() => {
    if (!orgId || !userId) return;
    let active = true;
    setLoading(true);
    setLoadError(null);
    getOrCreateMyDashboard(orgId, userId)
      .then((d) => {
        if (active) {
          setDashboard(d);
          setLoading(false);
        }
      })
      .catch(() => {
        if (active) {
          setLoadError("Couldn't load your dashboard.");
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [orgId, userId]);

  // Apply a widget-list transform, persist, and update local state.
  const persist = useCallback(
    (next: Widget[]) => {
      setDashboard((prev) => (prev ? { ...prev, widgets: next } : prev));
      const dashId = dashboard?.dashboardId;
      if (!dashId) return;
      void saveWidgets(dashId, next, { orgId, userId }).catch(() => {
        /* non-fatal: optimistic state already applied */
      });
    },
    [dashboard?.dashboardId, orgId, userId],
  );

  const widgets = useMemo(
    () => (dashboard?.widgets ?? []).slice().sort((a, b) => a.order - b.order),
    [dashboard?.widgets],
  );

  // Pin an AI-previewed spec onto the dashboard as a real widget (order =
  // last+1). Reuses the same addWidget + persist path as the Add dialog.
  const pinFromAi = useCallback(
    (spec: AiWidgetSpec) => {
      setDashboard((prev) => {
        if (!prev) return prev;
        const next = addWidget(prev.widgets, specToWidget(spec, prev.widgets.length));
        if (prev.dashboardId) {
          void saveWidgets(prev.dashboardId, next, { orgId, userId }).catch(() => {
            /* non-fatal: optimistic state already applied */
          });
        }
        return { ...prev, widgets: next };
      });
    },
    [orgId, userId],
  );

  if (loading) {
    return (
      <div className="flex h-[60vh] items-center justify-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading insights…
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="mx-auto max-w-2xl p-6">
        <Card>
          <CardContent className="p-8 text-center space-y-3">
            <AlertTriangle className="h-8 w-8 mx-auto text-amber-500" />
            <p className="text-sm text-muted-foreground">{loadError}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-4 p-4 md:px-8 md:py-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold text-foreground flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-orange-500" /> Insights
          </h1>
          <p className="text-sm text-muted-foreground">
            Your customizable dashboard. Add widgets and arrange them how you like.
          </p>
        </div>
        <Button onClick={() => setAddOpen(true)}>
          <Plus className="mr-1 h-4 w-4" /> Add widget
        </Button>
      </div>

      <AskAi orgId={orgId} fmtMoney={fmtMoney} onPin={pinFromAi} />

      {widgets.length === 0 ? (
        <Card>
          <CardContent className="p-10 text-center space-y-3">
            <Sparkles className="h-10 w-10 mx-auto text-orange-500" />
            <h2 className="text-lg font-semibold">Add your first widget</h2>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              Build a dashboard from your own data — pipeline, leads, tasks, and money.
              Pick a metric and a chart type to get started.
            </p>
            <Button onClick={() => setAddOpen(true)}>
              <Plus className="mr-1 h-4 w-4" /> Add widget
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-3">
          {widgets.map((w) => (
            <div key={w.id} className={SIZE_SPAN[w.size]}>
              <WidgetBoundary title={w.title}>
                <WidgetView
                  widget={w}
                  orgId={orgId}
                  fmtMoney={fmtMoney}
                  onReorder={(dir) => persist(reorderWidget(widgets, w.id, dir))}
                  onResize={(size) => persist(setWidgetSize(widgets, w.id, size))}
                  onRemove={() => persist(removeWidget(widgets, w.id))}
                />
              </WidgetBoundary>
            </div>
          ))}
        </div>
      )}

      <AddWidgetDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        nextOrder={widgets.length}
        onAdd={(w) => persist(addWidget(widgets, w))}
      />
    </div>
  );
};

export default InsightsDashboard;
