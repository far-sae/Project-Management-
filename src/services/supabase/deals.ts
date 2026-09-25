import { supabase } from './config';

export * from './crmHub/deals';

export type StageChangeTarget = {
  key: string;
  isWon?: boolean;
  isLost?: boolean;
};

export const resolveStageChange = (
  currentStageKey: string | null | undefined,
  target: StageChangeTarget,
): 'noop' | 'update' | 'won-confirm' => {
  if (currentStageKey === target.key) return 'noop';
  return target.isWon ? 'won-confirm' : 'update';
};

export interface CloseDealToWonInput {
  skip?: boolean;
  name?: string;
  ownerId?: string;
  startDate?: string;
  dueDate?: string;
  templateId?: string | null;
}

export const closeDealToWon = async (
  dealId: string,
  input: CloseDealToWonInput,
): Promise<{ dealId: string; projectId: string | null }> => {
  const { data, error } = await supabase.rpc('crm_close_deal_to_won', {
    p_deal_id: dealId,
    p_project_input: {
      skip: input.skip ?? false,
      name: input.name ?? null,
      owner_id: input.ownerId ?? null,
      start_date: input.startDate ?? null,
      due_date: input.dueDate ?? null,
      template_id: input.templateId ?? null,
    },
  });
  if (error) throw error;

  const result = data as Record<string, unknown> | null;
  return {
    dealId: (result?.deal_id as string | undefined) ?? dealId,
    projectId: (result?.project_id as string | null | undefined) ?? null,
  };
};
