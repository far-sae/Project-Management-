import { describe, it, expect } from 'vitest';
import { mapPipelineRow, mapStageRow } from '@/services/supabase/pipelines';

describe('pipelines mappers', () => {
  it('maps a pipeline row from snake_case to camelCase', () => {
    const row = {
      pipeline_id: 'p1',
      organization_id: 'o1',
      name: 'Sales',
      description: null,
      is_default: true,
      position: 0,
      created_by: 'u1',
      created_at: '2026-05-16T00:00:00Z',
      updated_at: '2026-05-16T00:00:00Z',
    };
    const out = mapPipelineRow(row);
    expect(out.pipelineId).toBe('p1');
    expect(out.organizationId).toBe('o1');
    expect(out.isDefault).toBe(true);
    expect(out.position).toBe(0);
  });

  it('maps a stage row preserving required_fields and won/lost flags', () => {
    const row = {
      stage_id: 's1',
      pipeline_id: 'p1',
      organization_id: 'o1',
      key: 'won',
      label: 'Won',
      color: '#10B981',
      position: 5,
      default_probability: 100,
      is_won: true,
      is_lost: false,
      required_fields: ['value'],
      created_at: '2026-05-16T00:00:00Z',
    };
    const out = mapStageRow(row);
    expect(out.isWon).toBe(true);
    expect(out.isLost).toBe(false);
    expect(out.requiredFields).toEqual(['value']);
    expect(out.defaultProbability).toBe(100);
  });
});
