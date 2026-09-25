export const METRICS = [
  {
    id: 'deals_by_stage',
    chartTypes: ['bar', 'donut', 'funnel'],
    dimensions: [],
    timeframe: false,
  },
  {
    id: 'expenses_by_month',
    chartTypes: ['line', 'bar'],
    dimensions: [{ id: 'expenses' }, { id: 'bills' }],
    timeframe: true,
  },
  {
    id: 'open_pipeline_value',
    chartTypes: ['kpi'],
    dimensions: [],
    timeframe: false,
  },
  {
    id: 'win_rate',
    chartTypes: ['kpi'],
    dimensions: [],
    timeframe: true,
  },
] as const;
