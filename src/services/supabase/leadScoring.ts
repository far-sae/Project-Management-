export const mapRuleRow = (row: any) => ({
  ruleId: row.rule_id,
  organizationId: row.organization_id,
  label: row.label,
  field: row.field,
  operator: row.operator,
  value: row.value,
  points: row.points,
  position: row.position,
  enabled: row.enabled,
  createdAt: new Date(row.created_at),
  updatedAt: new Date(row.updated_at),
});

const OPERATORS = new Set(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'contains']);

export const validateRuleInput = (input: { label: string; field: string; operator: string; value: unknown; points: number }) => {
  if (!input.label.trim()) throw new Error('Rule label is required');
  if (!input.field.trim()) throw new Error('Rule field is required');
  if (!OPERATORS.has(input.operator)) throw new Error('Invalid operator');
  if (!Number.isFinite(input.points)) throw new Error('Invalid points');
};

export const bandFromScore = (score: number, thresholds: { hot: number; warm: number }) => {
  if (score >= thresholds.hot) return 'hot';
  if (score >= thresholds.warm) return 'warm';
  return 'cold';
};
