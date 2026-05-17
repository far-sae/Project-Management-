// supabase/functions/ai-agent-suggest/draftPrompt.ts
// Pure prompt assembly helpers (no I/O, no Deno-only APIs) so they're
// trivially testable under Node vitest.

export const SYSTEM_PROMPT = `You are an AI sales development representative.
Your job is to write short, personalized B2B outreach emails — never
generic, never salesy. You write the way a thoughtful human SDR would
after 5 minutes of research.

Brand voice: friendly, direct, no jargon, no superlatives, no emoji.

Your output MUST be valid JSON matching this schema:
{
  "subject": "string, <60 chars, no marketing words like 'amazing'",
  "body_text": "string, plaintext, 60-120 words, ends with one specific question",
  "body_html": "string, same content, simple HTML <p> wrapped",
  "confidence": "number 0-1, how strongly this lead matches our ICP",
  "reasoning": "string, 1-2 sentences explaining your draft choices for the human reviewer",
  "suggested_next_stage_id": "uuid or null"
}

Rules:
- Reference one specific detail from enrichment if available.
- Re-engagement emails: acknowledge time elapsed + reference a recent signal.
- Never invent facts. If enrichment is empty, write a shorter generic intro.
- No 'Hope this finds you well'. No 'Just checking in'.`;

export interface ClientFacts {
  name: string;
  email: string;
  company: string | null;
}

export interface DealFacts {
  title: string;
  value: number;
  stageName: string;
  daysInStage: number;
  lastActivityAt: string;
}

export interface StageRef {
  stageId: string;
  name: string;
}

export interface BuildUserMessageArgs {
  triggerType: "intake" | "re_engagement";
  client: ClientFacts;
  deal: DealFacts | null;
  enrichment: Record<string, unknown> | null;
  recentActivity: string[];
  stages: StageRef[];
}

export const buildUserMessage = (a: BuildUserMessageArgs): string => {
  const parts: string[] = [];
  parts.push(`TRIGGER: ${a.triggerType}`);
  parts.push("");
  parts.push(`CLIENT/LEAD: ${a.client.name}, ${a.client.email}`);
  parts.push(`COMPANY (from CRM): ${a.client.company ?? "(unknown)"}`);
  parts.push("");
  parts.push("ENRICHMENT (from Apollo, may be null):");
  parts.push(a.enrichment ? JSON.stringify(a.enrichment, null, 2) : "null");
  parts.push("");
  parts.push("RECENT CRM ACTIVITY (last 5 events):");
  if (a.recentActivity.length === 0) {
    parts.push("(none)");
  } else {
    for (const e of a.recentActivity) parts.push(`- ${e}`);
  }
  parts.push("");
  if (a.deal) {
    parts.push(
      `DEAL: "${a.deal.title}", £${a.deal.value}, in stage "${a.deal.stageName}" ` +
      `for ${a.deal.daysInStage} days, last activity ${a.deal.lastActivityAt}`,
    );
    parts.push("");
  }
  parts.push("PIPELINE STAGES (for suggested_next_stage_id):");
  parts.push(JSON.stringify(a.stages, null, 2));
  return parts.join("\n");
};
