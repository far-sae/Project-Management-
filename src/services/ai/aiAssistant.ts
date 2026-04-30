import { isAIEnabled, AI_CONFIG } from './openai';
import { invokeAiChatEdge } from './invokeAiChatEdge';
import { rateLimiter } from './rateLimiter';
import type { AIError, Subtask } from './types';
import type { TaskPriority } from '@/types/task';

/* ─────────────────────────────────────────────────────────────────────────
 * Shared helpers
 * ──────────────────────────────────────────────────────────────────────── */

const throwParseError = (err: unknown, snippet: string): never => {
  const msg = err instanceof Error ? err.message : String(err);
  const clip = snippet.length > 800 ? `${snippet.slice(0, 800)}…` : snippet;
  throw {
    code: 'INVALID_INPUT',
    message: `Failed to parse AI JSON response: ${msg}`,
    originalError: err,
    responseSnippet: clip,
  } as AIError;
};

/** Strip meta-instruction prefixes from user text so they don't override the system prompt. */
export function sanitizeFreeformUserInput(input: string, maxLen = 4000): string {
  let q = input.trim().replace(/\r\n/g, '\n');
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const lines = q.split('\n');
    if (lines.length === 0) break;
    const firstTrim = lines[0].trim();
    const drop =
      /^ignore\b/i.test(firstTrim) ||
      /^disregard\b/i.test(firstTrim) ||
      /^<\s*\/?\s*system\s*>/i.test(firstTrim) ||
      /^system\s*:/i.test(firstTrim) ||
      /^\s*\[(?:INST|\/INST)\]/i.test(firstTrim) ||
      /^assistant\s*:/i.test(firstTrim) ||
      /#{3,}\s*system/i.test(firstTrim);
    if (!drop) break;
    lines.shift();
    q = lines.join('\n').trim();
  }
  return q.slice(0, maxLen);
}

async function invokeAI<T>(
  userId: string,
  prompt: string,
  parse: (content: string) => T,
  options?: { maxTokens?: number; temperature?: number },
): Promise<T> {
  if (!isAIEnabled()) {
    throw {
      code: 'NO_API_KEY',
      message:
        'AI is not configured. Deploy the ai-chat Edge Function and set OPENAI_API_KEY in Supabase.',
    } as AIError;
  }

  const rate = rateLimiter.checkLimit(userId);
  if (!rate.allowed) {
    throw {
      code: 'RATE_LIMIT',
      message: `Rate limit exceeded. Try again in ${rate.retryAfter}s.`,
      retryAfter: rate.retryAfter,
    } as AIError;
  }

  const content = await invokeAiChatEdge({
    prompt,
    model: AI_CONFIG.model,
    temperature: options?.temperature ?? 0.4,
    max_tokens: options?.maxTokens ?? 700,
  });
  return parse(String(content));
}

function extractJsonBlock(content: string): string {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced && fenced[1]) {
    const inner = fenced[1].trim();
    const m = inner.match(/[{[][\s\S]*[}\]]/);
    if (m) return m[0];
  }
  const m = content.match(/[{[][\s\S]*[}\]]/);
  if (!m) throw new Error('AI response did not contain JSON');
  return m[0];
}

/* ─────────────────────────────────────────────────────────────────────────
 * 1. Daily Brief — personal "where I stand" summary for today
 * ──────────────────────────────────────────────────────────────────────── */

export interface DailyBriefTaskRef {
  taskId: string;
  title: string;
  projectName: string;
  status: string;
  priority?: TaskPriority;
  dueDate?: string;
  isOverdue?: boolean;
}

export interface DailyBriefSnapshot {
  userDisplayName: string;
  todayDate: string;
  totalAssigned: number;
  dueToday: DailyBriefTaskRef[];
  overdue: DailyBriefTaskRef[];
  thisWeek: DailyBriefTaskRef[];
  highPriorityOpen: DailyBriefTaskRef[];
  recentlyCompleted: DailyBriefTaskRef[];
  recentMentions: Array<{ taskId: string; taskTitle: string; from: string; preview: string }>;
}

export interface DailyBriefResponse {
  greeting: string;
  /** 1-2 sentence framing of how the day looks. */
  summary: string;
  /** Ordered list of what to focus on, with the taskId so the UI can deep-link. */
  focus: Array<{ taskId: string; reason: string }>;
  blockers: string[];
  wins: string[];
  /** Optional single sentence closing nudge. */
  closing: string;
  generatedAt: string;
}

const DAILY_BRIEF_PROMPT = (s: DailyBriefSnapshot) => `
You are a calm, supportive chief-of-staff giving ${s.userDisplayName} their personal stand-up
brief for ${s.todayDate}. Use ONLY the JSON below. Do not invent tasks, people, or numbers.

Return STRICT JSON:
{
  "greeting": "<one short, warm line that includes the user's first name>",
  "summary": "<1-2 sentences framing today: load, urgency, momentum>",
  "focus": [
    { "taskId": "<copy from input>", "reason": "<why this comes first today, in one sentence>" }
  ],
  "blockers": ["<one-line risk or blocker>", "..."],
  "wins": ["<recent win to acknowledge>", "..."],
  "closing": "<single closing sentence — practical, not motivational fluff>"
}

Rules:
- 3-5 entries in "focus", ordered by what to do first. Reference real titles when explaining.
- Pull "blockers" from overdue, stalled, or high-priority items
- Pull "wins" only from recentlyCompleted (omit array if empty)
- If the user has zero assigned tasks, say so honestly in summary; focus = []
- No emojis. No exclamation marks. No motivational platitudes.

Snapshot:
${JSON.stringify(s, null, 2)}
`.trim();

function parseDailyBrief(content: string): DailyBriefResponse {
  const json = extractJsonBlock(content);
  let parsed: Partial<DailyBriefResponse>;
  try {
    parsed = JSON.parse(json) as Partial<DailyBriefResponse>;
  } catch (err) {
    throwParseError(err, json);
    parsed = {};
  }
  const focus = Array.isArray(parsed.focus) ? parsed.focus : [];
  return {
    greeting: typeof parsed.greeting === 'string' ? parsed.greeting.slice(0, 200) : '',
    summary: typeof parsed.summary === 'string' ? parsed.summary.slice(0, 400) : '',
    focus: focus
      .map((f) => ({
        taskId: String((f as { taskId?: string })?.taskId || '').slice(0, 64),
        reason: String((f as { reason?: string })?.reason || '').slice(0, 240),
      }))
      .filter((f) => f.taskId),
    blockers: Array.isArray(parsed.blockers)
      ? parsed.blockers.map(String).slice(0, 8)
      : [],
    wins: Array.isArray(parsed.wins) ? parsed.wins.map(String).slice(0, 6) : [],
    closing: typeof parsed.closing === 'string' ? parsed.closing.slice(0, 240) : '',
    generatedAt: new Date().toISOString(),
  };
}

export async function generateDailyBrief(
  userId: string,
  snapshot: DailyBriefSnapshot,
): Promise<DailyBriefResponse> {
  return invokeAI(userId, DAILY_BRIEF_PROMPT(snapshot), parseDailyBrief, {
    maxTokens: 700,
  });
}

/* ─────────────────────────────────────────────────────────────────────────
 * 2. Natural-language task quick-add — "high priority bug fix due Friday for Alice"
 * ──────────────────────────────────────────────────────────────────────── */

export interface QuickAddContextMember {
  userId: string;
  displayName: string;
  email?: string;
}

export interface QuickAddContext {
  /** Today's local date in YYYY-MM-DD so the model can resolve "Friday", "tomorrow", etc. */
  today: string;
  projectName?: string;
  availableStatuses: Array<{ id: string; title: string }>;
  members: QuickAddContextMember[];
}

export interface ParsedQuickAdd {
  title: string;
  description?: string;
  priority?: TaskPriority;
  /** ISO date or null. */
  dueDate?: string | null;
  status?: string;
  assigneeUserIds: string[];
  tags: string[];
  /** Free-text reasoning the model produced — surfaced to the user before they confirm. */
  notes?: string;
}

const QUICK_ADD_PROMPT = (text: string, ctx: QuickAddContext) => `
You convert a single line of natural language into a structured task draft.
Use ONLY information from the input. Do not invent assignees or projects.

Today's date is ${ctx.today}.${ctx.projectName ? ` The project is "${ctx.projectName}".` : ''}

Available statuses (use one id from this list, or omit): ${JSON.stringify(
  ctx.availableStatuses,
)}
Team members (match names case-insensitively or by partial first/last name; only return userIds
that exist below):
${JSON.stringify(
  ctx.members.map((m) => ({
    userId: m.userId,
    displayName: m.displayName,
    email: m.email || '',
  })),
)}

Input: ${JSON.stringify(text)}

Return STRICT JSON:
{
  "title": "<imperative, <= 80 chars>",
  "description": "<optional 1-2 sentences expanding on what was said, or omit>",
  "priority": "high|medium|low" (omit if not implied),
  "dueDate": "<YYYY-MM-DD>" or null,
  "status": "<one of the available status ids>" (omit if not implied),
  "assigneeUserIds": ["<userId from members list>", "..."],
  "tags": ["<short kebab-or-lower tag>", "..."],
  "notes": "<one sentence: things you inferred or left ambiguous, or omit>"
}

Date rules:
- "today" / "tonight" → today's date
- "tomorrow" → +1 day
- "monday".."sunday" → next occurrence (today if today matches and "next" not specified)
- "next week" → 7 days from today
- "in N days/weeks" → exact offset
- If no date is implied, use null

Assignee rules:
- "me" / "myself" → leave assigneeUserIds empty (the UI will handle "me")
- A name must match a member; if not found, leave assigneeUserIds empty and mention it in notes.
- Multiple names → multiple ids.

Priority cues:
- "urgent", "critical", "asap", "p0", "high priority", "blocker" → "high"
- "low priority", "later", "p3", "minor", "whenever" → "low"
- otherwise omit.
`.trim();

function parseQuickAdd(content: string): ParsedQuickAdd {
  const json = extractJsonBlock(content);
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(json) as Record<string, unknown>;
  } catch (err) {
    throwParseError(err, json);
    parsed = {};
  }
  const priority = parsed.priority;
  const validPriority: TaskPriority | undefined =
    priority === 'high' || priority === 'medium' || priority === 'low' ? priority : undefined;
  const dueRaw = parsed.dueDate;
  let dueDate: string | null | undefined;
  if (dueRaw === null) dueDate = null;
  else if (typeof dueRaw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dueRaw)) dueDate = dueRaw;
  else dueDate = undefined;

  const assigneeIds = Array.isArray(parsed.assigneeUserIds)
    ? (parsed.assigneeUserIds as unknown[])
        .map(String)
        .filter((s) => s && s.length < 80)
        .slice(0, 10)
    : [];
  const tags = Array.isArray(parsed.tags)
    ? (parsed.tags as unknown[]).map(String).map((t) => t.trim()).filter(Boolean).slice(0, 8)
    : [];

  return {
    title: typeof parsed.title === 'string' ? parsed.title.slice(0, 120).trim() : '',
    description:
      typeof parsed.description === 'string' && parsed.description.trim()
        ? parsed.description.slice(0, 600).trim()
        : undefined,
    priority: validPriority,
    dueDate,
    status: typeof parsed.status === 'string' ? parsed.status.slice(0, 64) : undefined,
    assigneeUserIds: assigneeIds,
    tags,
    notes: typeof parsed.notes === 'string' ? parsed.notes.slice(0, 280) : undefined,
  };
}

export async function parseTaskFromText(
  userId: string,
  rawText: string,
  ctx: QuickAddContext,
): Promise<ParsedQuickAdd> {
  const text = sanitizeFreeformUserInput(rawText, 1000);
  if (!text) {
    throw { code: 'INVALID_INPUT', message: 'Type a task to add.' } as AIError;
  }
  return invokeAI(userId, QUICK_ADD_PROMPT(text, ctx), parseQuickAdd, {
    maxTokens: 500,
    temperature: 0.2,
  });
}

/* ─────────────────────────────────────────────────────────────────────────
 * 3. Comment thread summarizer — TL;DR for long discussions
 * ──────────────────────────────────────────────────────────────────────── */

export interface CommentSnippet {
  author: string;
  at: string;
  text: string;
}

export interface CommentSummary {
  tldr: string;
  decisions: string[];
  openQuestions: string[];
  actionItems: Array<{ owner: string; what: string }>;
  generatedAt: string;
}

const COMMENT_SUMMARY_PROMPT = (taskTitle: string, comments: CommentSnippet[]) => `
You are summarizing the comment thread on the task "${taskTitle}".
Use ONLY the comments below. Do not invent quotes, names, or facts.

Return STRICT JSON:
{
  "tldr": "<2-3 sentence summary of where the conversation has landed>",
  "decisions": ["<decision made, attributed by name when clear>", "..."],
  "openQuestions": ["<unresolved question or pending input>", "..."],
  "actionItems": [{ "owner": "<name from thread or 'Unassigned'>", "what": "<concrete next step>" }]
}

Rules:
- Skip empty arrays — return [] when nothing fits, never invent filler entries.
- Decisions must be supported by the thread. If no clear decision, return [].
- Quote no more than 6 words at a time. Do not paraphrase as a quote.
- No emojis.

Thread (most recent last):
${comments
  .map((c, i) => `[${i + 1}] ${c.author} @ ${c.at}: ${c.text}`)
  .join('\n')}
`.trim();

function parseCommentSummary(content: string): CommentSummary {
  const json = extractJsonBlock(content);
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(json) as Record<string, unknown>;
  } catch (err) {
    throwParseError(err, json);
    parsed = {};
  }
  const decisions = Array.isArray(parsed.decisions) ? parsed.decisions : [];
  const open = Array.isArray(parsed.openQuestions) ? parsed.openQuestions : [];
  const actions = Array.isArray(parsed.actionItems) ? parsed.actionItems : [];
  return {
    tldr: typeof parsed.tldr === 'string' ? parsed.tldr.slice(0, 600) : '',
    decisions: decisions.map((d) => String(d).slice(0, 240)).slice(0, 8),
    openQuestions: open.map((q) => String(q).slice(0, 240)).slice(0, 8),
    actionItems: actions
      .map((a) => ({
        owner: String((a as { owner?: string })?.owner || 'Unassigned').slice(0, 80),
        what: String((a as { what?: string })?.what || '').slice(0, 240),
      }))
      .filter((a) => a.what)
      .slice(0, 8),
    generatedAt: new Date().toISOString(),
  };
}

export async function summarizeCommentThread(
  userId: string,
  taskTitle: string,
  comments: CommentSnippet[],
): Promise<CommentSummary> {
  if (!comments.length) {
    throw {
      code: 'INVALID_INPUT',
      message: 'No comments to summarize yet.',
    } as AIError;
  }
  // Defensive: clip very long threads to keep the prompt small.
  const trimmed = comments.slice(-40).map((c) => ({
    author: c.author.slice(0, 80),
    at: c.at.slice(0, 32),
    text: sanitizeFreeformUserInput(c.text, 800),
  }));
  return invokeAI(
    userId,
    COMMENT_SUMMARY_PROMPT(taskTitle.slice(0, 200), trimmed),
    parseCommentSummary,
    { maxTokens: 600 },
  );
}

/* ─────────────────────────────────────────────────────────────────────────
 * 4. Meeting notes → tasks extractor
 * ──────────────────────────────────────────────────────────────────────── */

export interface ExtractedTaskDraft {
  title: string;
  description: string;
  priority?: TaskPriority;
  dueDate?: string | null;
  status?: string;
  assigneeUserIds: string[];
  tags: string[];
  /** Optional context the model captured for this entry. */
  rationale?: string;
  /** Subtasks the model split out, mirroring the Subtask shape used elsewhere. */
  subtasks: Subtask[];
}

const EXTRACT_TASKS_PROMPT = (text: string, ctx: QuickAddContext) => `
You are extracting actionable tasks from raw meeting notes / a transcript.
Use ONLY the notes below. Do not invent tasks, names, or numbers.

Today's date is ${ctx.today}.${ctx.projectName ? ` The project is "${ctx.projectName}".` : ''}
Statuses available: ${JSON.stringify(ctx.availableStatuses)}
Team members (only return userIds from this list):
${JSON.stringify(
  ctx.members.map((m) => ({ userId: m.userId, displayName: m.displayName })),
)}

Return STRICT JSON:
{
  "tasks": [
    {
      "title": "<imperative, <=80 chars>",
      "description": "<1-2 sentence context, why it matters>",
      "priority": "high|medium|low" (omit if not implied),
      "dueDate": "<YYYY-MM-DD>" or null,
      "status": "<status id>" (omit if not implied),
      "assigneeUserIds": ["..."],
      "tags": ["..."],
      "rationale": "<one sentence anchoring this to a specific note line>",
      "subtasks": [
        { "title": "...", "description": "...", "priority": "high|medium|low" }
      ]
    }
  ]
}

Rules:
- Only emit clearly actionable items. Skip discussion / status updates / FYIs.
- Resolve dates relative to today. If a date is uncertain, use null.
- Subtasks are optional. Provide them only when the parent task naturally splits.
- 0-15 tasks total. Quality over quantity.

Notes:
${text}
`.trim();

function parseExtractedTasks(content: string): { tasks: ExtractedTaskDraft[] } {
  const json = extractJsonBlock(content);
  let parsed: { tasks?: unknown };
  try {
    parsed = JSON.parse(json) as { tasks?: unknown };
  } catch (err) {
    throwParseError(err, json);
    parsed = {};
  }
  const list = Array.isArray(parsed.tasks) ? parsed.tasks : [];
  const tasks: ExtractedTaskDraft[] = list
    .map((raw) => {
      const r = raw as Record<string, unknown>;
      const priority = r.priority;
      const validPriority: TaskPriority | undefined =
        priority === 'high' || priority === 'medium' || priority === 'low'
          ? priority
          : undefined;
      const dueRaw = r.dueDate;
      const dueDate: string | null | undefined =
        dueRaw === null
          ? null
          : typeof dueRaw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dueRaw)
            ? dueRaw
            : undefined;
      const subtasksRaw = Array.isArray(r.subtasks) ? r.subtasks : [];
      return {
        title: typeof r.title === 'string' ? r.title.slice(0, 120).trim() : '',
        description: typeof r.description === 'string' ? r.description.slice(0, 600) : '',
        priority: validPriority,
        dueDate,
        status: typeof r.status === 'string' ? r.status.slice(0, 64) : undefined,
        assigneeUserIds: Array.isArray(r.assigneeUserIds)
          ? (r.assigneeUserIds as unknown[]).map(String).slice(0, 10)
          : [],
        tags: Array.isArray(r.tags)
          ? (r.tags as unknown[])
              .map(String)
              .map((t) => t.trim())
              .filter(Boolean)
              .slice(0, 8)
          : [],
        rationale: typeof r.rationale === 'string' ? r.rationale.slice(0, 240) : undefined,
        subtasks: subtasksRaw
          .map((sraw) => {
            const s = sraw as Record<string, unknown>;
            const sp = s.priority;
            return {
              title: typeof s.title === 'string' ? s.title.slice(0, 120).trim() : '',
              description: typeof s.description === 'string' ? s.description.slice(0, 240) : '',
              priority:
                sp === 'high' || sp === 'medium' || sp === 'low'
                  ? (sp as TaskPriority)
                  : 'medium',
            } as Subtask;
          })
          .filter((s) => s.title)
          .slice(0, 8),
      } satisfies ExtractedTaskDraft;
    })
    .filter((t) => t.title)
    .slice(0, 20);
  return { tasks };
}

export async function extractTasksFromNotes(
  userId: string,
  rawNotes: string,
  ctx: QuickAddContext,
): Promise<{ tasks: ExtractedTaskDraft[] }> {
  const notes = sanitizeFreeformUserInput(rawNotes, 12000);
  if (notes.length < 30) {
    throw {
      code: 'INVALID_INPUT',
      message: 'Paste at least a couple of sentences of notes to extract tasks from.',
    } as AIError;
  }
  return invokeAI(userId, EXTRACT_TASKS_PROMPT(notes, ctx), parseExtractedTasks, {
    maxTokens: 1400,
    temperature: 0.3,
  });
}

/* ─────────────────────────────────────────────────────────────────────────
 * 5. Project Health — single-project diagnostic
 * ──────────────────────────────────────────────────────────────────────── */

export interface ProjectHealthSnapshot {
  projectName: string;
  totalTasks: number;
  completedTasks: number;
  inProgressTasks: number;
  notStartedTasks: number;
  blockedTasks: number;
  overdueTasks: number;
  stalledTasks: number;
  unassignedTasks: number;
  highPriorityOpen: number;
  averageDaysSinceUpdate: number;
  velocityLast7d: number;
  velocityPrev7d: number;
  upcomingDueIn7d: number;
}

export interface ProjectHealthResponse {
  /** 0-100 — higher is better. */
  score: number;
  /** "excellent" | "good" | "watch" | "at-risk" — quick pill label. */
  status: 'excellent' | 'good' | 'watch' | 'at-risk';
  /** 1-2 sentence headline. */
  headline: string;
  strengths: string[];
  risks: string[];
  /** Ordered next moves. */
  recommendations: string[];
  generatedAt: string;
}

const PROJECT_HEALTH_PROMPT = (s: ProjectHealthSnapshot) => `
You are a senior delivery lead grading the health of one project on a single-page dashboard.
Use ONLY the JSON below. No invented data.

Return STRICT JSON:
{
  "score": <integer 0-100>,
  "status": "excellent" | "good" | "watch" | "at-risk",
  "headline": "<1-2 sentence punchline>",
  "strengths": ["..."],
  "risks": ["..."],
  "recommendations": ["..."]
}

Scoring guidance (not strict, treat as priors):
- 80+ excellent: low overdue, healthy velocity, low stalled rate
- 65-79 good: minor risks but trending fine
- 50-64 watch: meaningful stalled / unassigned / overdue clusters
- below 50 at-risk: declining velocity, many overdue, high-priority unaddressed

Rules:
- 2-4 strengths and 2-4 risks. If absent, return [].
- 3-5 recommendations, ordered by impact (most impactful first).
- Reference numbers from the snapshot to justify the score.
- No emojis. No exclamation marks.

Snapshot:
${JSON.stringify(s, null, 2)}
`.trim();

function parseProjectHealth(content: string): ProjectHealthResponse {
  const json = extractJsonBlock(content);
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(json) as Record<string, unknown>;
  } catch (err) {
    throwParseError(err, json);
    parsed = {};
  }
  let score = Number(parsed.score);
  if (!Number.isFinite(score)) score = 50;
  score = Math.max(0, Math.min(100, Math.round(score)));
  const rawStatus = String(parsed.status || '').toLowerCase();
  const status: ProjectHealthResponse['status'] = (
    ['excellent', 'good', 'watch', 'at-risk'] as const
  ).includes(rawStatus as ProjectHealthResponse['status'])
    ? (rawStatus as ProjectHealthResponse['status'])
    : score >= 80
      ? 'excellent'
      : score >= 65
        ? 'good'
        : score >= 50
          ? 'watch'
          : 'at-risk';
  return {
    score,
    status,
    headline: typeof parsed.headline === 'string' ? parsed.headline.slice(0, 400) : '',
    strengths: Array.isArray(parsed.strengths)
      ? parsed.strengths.map(String).slice(0, 6)
      : [],
    risks: Array.isArray(parsed.risks) ? parsed.risks.map(String).slice(0, 6) : [],
    recommendations: Array.isArray(parsed.recommendations)
      ? parsed.recommendations.map(String).slice(0, 6)
      : [],
    generatedAt: new Date().toISOString(),
  };
}

export async function assessProjectHealth(
  userId: string,
  snapshot: ProjectHealthSnapshot,
): Promise<ProjectHealthResponse> {
  return invokeAI(userId, PROJECT_HEALTH_PROMPT(snapshot), parseProjectHealth, {
    maxTokens: 800,
  });
}

/* ─────────────────────────────────────────────────────────────────────────
 * 6. Meeting transcript → structured notes
 *    Used by the in-call recorder to turn a raw transcript into a tidy
 *    summary + decisions + action items the user can paste anywhere.
 * ──────────────────────────────────────────────────────────────────────── */

export interface MeetingNotes {
  summary: string;
  decisions: string[];
  actionItems: Array<{
    title: string;
    owner?: string;
    dueDate?: string | null;
  }>;
  openQuestions: string[];
}

const MEETING_NOTES_PROMPT = (transcript: string) => `
You are turning a meeting transcript into clean, shareable notes.
Use ONLY the transcript. Do not invent participants, tasks, or dates.

Return STRICT JSON with this exact shape:
{
  "summary": "<2-4 sentence overview of what was discussed>",
  "decisions": ["<concrete decision 1>", "..."],
  "actionItems": [
    { "title": "<imperative, <=80 chars>", "owner": "<name from transcript or omit>", "dueDate": "<YYYY-MM-DD or null>" }
  ],
  "openQuestions": ["<question or unresolved point>", "..."]
}

Rules:
- Skip filler ("um", "you know") and repeated phrases when summarising.
- Action items must be clearly actionable. Do not promote casual mentions.
- Owners only if a specific person was named in the transcript.
- 0-12 action items, 0-8 decisions, 0-8 open questions. Quality over quantity.

Transcript:
${transcript}
`.trim();

function parseMeetingNotes(content: string): MeetingNotes {
  const json = extractJsonBlock(content);
  let parsed: Partial<MeetingNotes> & {
    actionItems?: unknown;
    decisions?: unknown;
    openQuestions?: unknown;
  };
  try {
    parsed = JSON.parse(json) as typeof parsed;
  } catch (err) {
    throwParseError(err, json);
    return { summary: '', decisions: [], actionItems: [], openQuestions: [] };
  }
  const asStringArray = (v: unknown): string[] =>
    Array.isArray(v) ? v.map((x) => String(x)).filter(Boolean) : [];
  type ActionItem = { title: string; owner?: string; dueDate?: string | null };
  const actionItems: ActionItem[] = Array.isArray(parsed.actionItems)
    ? (parsed.actionItems
        .map((it): ActionItem | null => {
          if (!it || typeof it !== 'object') return null;
          const r = it as { title?: unknown; owner?: unknown; dueDate?: unknown };
          const title = typeof r.title === 'string' ? r.title.trim() : '';
          if (!title) return null;
          const item: ActionItem = { title: title.slice(0, 200) };
          if (typeof r.owner === 'string' && r.owner.trim()) {
            item.owner = r.owner.trim().slice(0, 120);
          }
          item.dueDate =
            typeof r.dueDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.dueDate)
              ? r.dueDate
              : null;
          return item;
        })
        .filter((x): x is ActionItem => x !== null))
    : [];

  return {
    summary: typeof parsed.summary === 'string' ? parsed.summary.trim() : '',
    decisions: asStringArray(parsed.decisions),
    actionItems,
    openQuestions: asStringArray(parsed.openQuestions),
  };
}

export async function summarizeMeetingTranscript(
  userId: string,
  transcript: string,
): Promise<MeetingNotes> {
  const trimmed = sanitizeFreeformUserInput(transcript, 12000);
  if (!trimmed) {
    throw {
      code: 'INVALID_INPUT',
      message: 'Transcript is empty.',
    } as AIError;
  }
  return invokeAI(userId, MEETING_NOTES_PROMPT(trimmed), parseMeetingNotes, {
    maxTokens: 900,
  });
}
