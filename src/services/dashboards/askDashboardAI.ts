import { supabase } from '@/services/supabase/config';
import { METRICS } from './metrics';

type Failure = { error: string };
type Success = { widget: any; takeaway: string };

export const isFailure = (value: Failure | Success): value is Failure => 'error' in value;

export const buildCatalog = () =>
  METRICS.map((metric) => ({
    id: metric.id,
    chartTypes: [...metric.chartTypes],
    dimensions: [...metric.dimensions],
    timeframe: metric.timeframe,
  }));

const sanitizeWidget = (widget: any) => {
  const metric = METRICS.find((item) => item.id === widget?.metricId);
  if (!metric) return null;
  const chartTypes: readonly string[] = metric.chartTypes;
  const dimensions: readonly { id: string }[] = metric.dimensions;
  if (!chartTypes.includes(widget.chartType)) return null;
  if (widget.dimension && !dimensions.some((dimension) => dimension.id === widget.dimension)) return null;
  if (widget.timeframe && !metric.timeframe) return null;
  return {
    metricId: metric.id,
    chartType: widget.chartType,
    title: widget.title ?? metric.id,
    ...(widget.dimension ? { dimension: widget.dimension } : {}),
    ...(widget.timeframe ? { timeframe: widget.timeframe } : {}),
  };
};

export const askDashboardAI = async (organizationId: string, question: string): Promise<Failure | Success> => {
  const trimmed = question.trim();
  if (!trimmed) return { error: 'Ask a question first' };
  const catalog = buildCatalog();
  const { data, error } = await supabase.functions.invoke('dashboard-ai', {
    body: { organization_id: organizationId, question: trimmed, catalog },
  });
  if (error || data?.error) return { error: error?.message ?? data?.error ?? 'Request failed' };
  const widget = sanitizeWidget(data?.widget);
  if (!widget) return { error: 'The AI returned an unsupported widget' };
  return { widget, takeaway: data?.takeaway ?? '' };
};
