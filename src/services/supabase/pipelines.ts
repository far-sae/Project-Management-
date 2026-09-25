export const mapPipelineRow = (row: any) => ({
  pipelineId: row.pipeline_id,
  organizationId: row.organization_id,
  name: row.name,
  description: row.description,
  isDefault: row.is_default,
  position: row.position,
  createdBy: row.created_by,
  createdAt: new Date(row.created_at),
  updatedAt: new Date(row.updated_at),
});

export const mapStageRow = (row: any) => ({
  stageId: row.stage_id,
  pipelineId: row.pipeline_id,
  organizationId: row.organization_id,
  key: row.key,
  label: row.label,
  color: row.color,
  position: row.position,
  defaultProbability: row.default_probability,
  isWon: row.is_won,
  isLost: row.is_lost,
  requiredFields: row.required_fields ?? [],
  createdAt: new Date(row.created_at),
});
