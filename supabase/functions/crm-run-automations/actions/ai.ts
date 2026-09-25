export function computeCostCents(inputTokens: number, outputTokens: number): number {
  return inputTokens * 0.0003 + outputTokens * 0.0015;
}

export function parseClassifyResponse(text: string): 'hot' | 'warm' | 'cold' | null {
  const first = text.trim().toLowerCase().split(/\s+|—|-/)[0];
  return first === 'hot' || first === 'warm' || first === 'cold' ? first : null;
}

export function parseDraftEmailResponse(text: string): { subject: string; body: string } {
  const parts = text.split(/\r?\n\r?\n/);
  if (parts.length < 2) return { subject: '', body: text };
  const subject = parts.shift()!.replace(/^subject:\s*/i, '').trim();
  return { subject, body: parts.join('\n\n').trim() };
}

export function parseExtractResponse(text: string): Record<string, unknown> | null {
  const cleaned = text.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();
  try {
    const parsed = JSON.parse(cleaned);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
