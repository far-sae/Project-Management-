const unitMs: Record<string, number> = {
  minutes: 60_000,
  hours: 3_600_000,
  days: 86_400_000,
};

export async function wait(ctx: any, config: { value: number; unit: string }) {
  if (!config.value || config.value <= 0) return { status: 'failure', message: 'value must be > 0' };
  if (ctx.nextActionIndex == null) return { status: 'failure', message: 'nextActionIndex is required' };
  const pending = await ctx.admin
    .from('pending_actions')
    .select('*', { count: 'exact', head: true })
    .eq('organization_id', ctx.orgId)
    .eq('recipe_id', ctx.recipeId)
    .neq('status', 'done');
  if ((pending.count ?? 0) >= 10) return { status: 'failure', message: 'recursion_limit' };
  const fireAt = new Date(Date.now() + config.value * (unitMs[config.unit] ?? unitMs.minutes)).toISOString();
  await ctx.admin.from('pending_actions').insert({
    organization_id: ctx.orgId,
    recipe_id: ctx.recipeId,
    next_action_index: ctx.nextActionIndex,
    fire_at: fireAt,
  });
  return { status: 'success', meta: { defer: true, fire_at: fireAt } };
}
