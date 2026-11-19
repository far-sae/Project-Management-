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
