export function buildUserMessage(input: any): string {
  const lines = [
    `TRIGGER: ${input.triggerType}`,
    `CLIENT: ${input.client?.name ?? ''} <${input.client?.email ?? ''}>`,
    `COMPANY: ${input.client?.company ?? 'null'}`,
    'ENRICHMENT:',
    input.enrichment ? JSON.stringify(input.enrichment, null, 2) : 'null',
  ];
  if (input.deal) {
    lines.push(
      `DEAL: "${input.deal.title}"`,
      `VALUE: \u00a3${input.deal.value}`,
      `STAGE: ${input.deal.stageName}`,
      `DAYS IN STAGE: ${input.deal.daysInStage} days`,
    );
  }
  lines.push('STAGES:', JSON.stringify(input.stages ?? [], null, 2));
  lines.push('RECENT ACTIVITY:');
  for (const item of input.recentActivity ?? []) lines.push(`- ${item}`);
  return lines.join('\n');
}
