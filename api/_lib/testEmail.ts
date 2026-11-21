import { buildMessage } from './message';

/**
 * The test email of POST /api/email/verify. With a draft it is the email the
 * person is writing, so they see what the recipients will see; without one it
 * is the plain line that only proves the mailbox can send.
 *
 * It always goes to the caller's own address (the route decides that, never
 * the request), so a draft cannot be used to mail anyone else.
 */

export const TEST_SUBJECT_LIMIT = 300;
export const TEST_BODY_LIMIT = 500_000;
const FIELD_LIMIT = 50;
const VALUE_LIMIT = 500;
const FIELD_NAME = /^[a-zA-Z0-9_.]{1,64}$/;

export type TestDraft = { subject: string; bodyHtml: string; mergeData: Record<string, string> };

export const TEST_NOTE = 'This is a test. The real email also has an unsubscribe link here.';

/** The draft in the request body, or null when there is none worth sending. */
export function readTestDraft(body: unknown): TestDraft | null {
  const draft = (body as { draft?: unknown } | null)?.draft;
  if (!draft || typeof draft !== 'object' || Array.isArray(draft)) return null;
  const raw = draft as Record<string, unknown>;
  const subject = typeof raw.subject === 'string' ? raw.subject.trim().slice(0, TEST_SUBJECT_LIMIT) : '';
  const bodyHtml = typeof raw.bodyHtml === 'string' ? raw.bodyHtml.slice(0, TEST_BODY_LIMIT) : '';
  if (!subject && !bodyHtml.trim()) return null;

  const mergeData: Record<string, string> = {};
  const fields = raw.mergeData && typeof raw.mergeData === 'object' && !Array.isArray(raw.mergeData) ? (raw.mergeData as Record<string, unknown>) : {};
  for (const [key, value] of Object.entries(fields)) {
    if (Object.keys(mergeData).length >= FIELD_LIMIT) break;
    if (!FIELD_NAME.test(key)) continue;
    if (typeof value !== 'string' && typeof value !== 'number') continue;
    mergeData[key] = String(value).slice(0, VALUE_LIMIT);
  }
  return { subject, bodyHtml, mergeData };
}

export type TestEmail = { subject: string; text: string; html?: string };

export function buildTestEmail(draft: TestDraft | null): TestEmail {
  if (!draft) return { subject: 'TaskCalendar test email', text: 'This is a test message. Your sending account works.' };
  // "single": a test has no message to unsubscribe from, so it carries no link; the note says where the real one goes.
  const built = buildMessage({ kind: 'single', subject: draft.subject, bodyHtml: draft.bodyHtml, mergeData: draft.mergeData });
  return {
    subject: `[Test] ${built.subject.trim() || '(no subject yet)'}`,
    html: `${built.html}<p style="margin-top:24px;font-size:12px;color:#888888">${TEST_NOTE}</p>`,
    text: `${built.text}\n\n${TEST_NOTE}`,
  };
}
