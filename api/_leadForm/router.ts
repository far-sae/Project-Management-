import { AppError } from "../_signroom/errors.js";
import { isUuid } from "../_signroom/validate.js";
import {
  COMPANY_MAX,
  EMAIL_MAX,
  EMAIL_MESSAGE,
  FORM_GONE_MESSAGE,
  MESSAGE_MAX,
  NAME_MAX,
  NAME_MESSAGE,
  PHONE_MAX,
  TOO_LONG_MESSAGE,
  TOO_MANY_MESSAGE,
  type PublicForm,
  type SubmitReply,
} from "./shared/types.js";
import type { LeadFormStore, StoredForm } from "./store.js";

/**
 * A web form that creates a lead. Public: anyone with the form's address can
 * read its wording and send it, from our own form page or from a form on the
 * owner's website.
 *
 *   GET  ?id=<form>   the form's wording and questions
 *   POST ?id=<form>   send it: a new lead, or a note on the lead that already has that email
 *
 * What keeps it from being abused: the form must be switched on; a hidden
 * field only robots fill; every answer has a length; one sender may send a
 * form a few times in ten minutes, and a form takes a few hundred a day.
 */

/** One sender, one form: this many in ten minutes. */
export const PER_SENDER = 5;
export const SENDER_WINDOW_MS = 10 * 60_000;
/** One form, everyone together: this many in a day. */
export const PER_FORM_DAY = 300;
const DAY_MS = 24 * 60 * 60_000;

export type LeadFormDeps = {
  store: LeadFormStore;
  now?: () => Date;
};

export type FormRequest = {
  method: string;
  formId: string;
  body: Record<string, unknown>;
  /** A one-way fingerprint of where the request came from; never the address itself. */
  senderHash: string;
};
export type FormResult = { status: number; json: unknown };

const nowOf = (d: LeadFormDeps): Date => (d.now ? d.now() : new Date());
const text = (v: unknown): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");
/** The message keeps its line breaks. */
const lines = (v: unknown): string => (typeof v === "string" ? v.replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").trim() : "");

async function openForm(d: LeadFormDeps, formId: string): Promise<StoredForm> {
  const form = isUuid(formId) ? await d.store.form(formId) : null;
  // Switched off and never existed give the same answer.
  if (!form || !form.enabled) throw new AppError(FORM_GONE_MESSAGE, 404);
  return form;
}

const publicView = (form: StoredForm): PublicForm => ({
  heading: form.heading,
  intro: form.intro,
  askPhone: form.askPhone,
  askCompany: form.askCompany,
  askMessage: form.askMessage,
  buttonLabel: form.buttonLabel,
  thankYou: form.thankYou,
});

/** "Elena Maria Rossi" as first name "Elena" and last name "Maria Rossi". */
export function splitName(name: string): { firstName: string; lastName: string | null } {
  const [first, ...rest] = name.split(" ").filter(Boolean);
  return { firstName: first ?? "", lastName: rest.length ? rest.join(" ") : null };
}

async function submit(d: LeadFormDeps, r: FormRequest): Promise<FormResult> {
  const form = await openForm(d, r.formId);
  const reply: SubmitReply = { ok: true, thankYou: form.thankYou };

  // A robot fills every field it finds. It is told all went well and nothing is kept.
  if (text(r.body.website)) return { status: 200, json: reply };

  const name = text(r.body.name);
  const email = text(r.body.email).toLowerCase();
  const phone = form.askPhone ? text(r.body.phone) : "";
  const company = form.askCompany ? text(r.body.company) : "";
  const message = form.askMessage ? lines(r.body.message) : "";
  if (!name) throw new AppError(NAME_MESSAGE, 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > EMAIL_MAX) throw new AppError(EMAIL_MESSAGE, 400);
  if (name.length > NAME_MAX || phone.length > PHONE_MAX || company.length > COMPANY_MAX || message.length > MESSAGE_MAX) throw new AppError(TOO_LONG_MESSAGE, 400);

  const now = nowOf(d);
  const [bySender, byForm] = await Promise.all([
    d.store.sentBySender(form.id, r.senderHash, new Date(now.getTime() - SENDER_WINDOW_MS).toISOString()),
    d.store.sentToForm(form.id, new Date(now.getTime() - DAY_MS).toISOString()),
  ]);
  if (bySender >= PER_SENDER || byForm >= PER_FORM_DAY) {
    await d.store.recordSubmission(form.id, r.senderHash, "refused", null).catch(() => undefined);
    throw new AppError(TOO_MANY_MESSAGE, 429);
  }

  const scope = { organizationId: form.organizationId, workspaceId: form.workspaceId };
  const existing = await d.store.leadByEmail(form.workspaceId, email);
  if (existing) {
    // The same person again: one lead, with what they wrote this time on its timeline.
    await d.store.note({ id: existing.id, ...scope }, "note", message ? `Sent the form “${form.name}” again:\n${message}` : `Sent the form “${form.name}” again.`, form.id);
    await d.store.recordSubmission(form.id, r.senderHash, "again", existing.id);
    await tell(d, form, existing.ownerId, `${name} wrote again`, `${name} (${email}) sent the form “${form.name}” again.`, existing.id);
    return { status: 200, json: reply };
  }

  const ownerId = await ownerFor(d, form);
  const companyId = company ? await d.store.companyByName(form.organizationId, form.workspaceId, company, ownerId) : null;
  const leadId = await d.store.insertLead({ ...scope, ownerId, ...splitName(name), email, phone: phone || null, companyId, source: form.source });
  // The lead exists from here on; nothing after this may make the visitor think it failed.
  await d.store.recordSubmission(form.id, r.senderHash, "lead", leadId).catch(() => undefined);
  await d.store.note({ id: leadId, ...scope }, "contact_created", `Came in through the form “${form.name}”.`, form.id).catch(() => undefined);
  if (message) await d.store.note({ id: leadId, ...scope }, "note", `Wrote in the form:\n${message}`, form.id).catch(() => undefined);
  await tell(d, form, ownerId, "New lead from your form", `${name} (${email}) filled in “${form.name}”.`, leadId);
  return { status: 200, json: reply };
}

/**
 * Who gets this lead. A form shared between people gives its leads to them in
 * turn, passing over anyone who is no longer an active member. A form that is
 * not shared, or whose people have all left, gives the lead to its one owner
 * (or to nobody). Never fails the form: when the turn cannot be worked out the
 * lead still comes in, to the form's owner.
 */
export async function ownerFor(d: LeadFormDeps, form: StoredForm): Promise<string | null> {
  if (form.shareWith.length === 0) return form.ownerId;
  try {
    const active = new Set(await d.store.activeMembers(form.organizationId));
    const people = form.shareWith.filter((id) => active.has(id));
    if (people.length === 0) return form.ownerId;
    const owner = people[form.shareNext % people.length];
    await d.store.takeTurn(form.id, form.shareNext).catch(() => undefined);
    return owner;
  } catch {
    return form.ownerId;
  }
}

/** The bell: the person the lead belongs to, or the owner and admins when it belongs to nobody. Never fails the form. */
async function tell(d: LeadFormDeps, form: StoredForm, ownerId: string | null, title: string, message: string, leadId: string): Promise<void> {
  try {
    const to = ownerId ? [ownerId] : await d.store.admins(form.organizationId);
    await d.store.notify(to, title, message, `/crm/contacts/${leadId}`);
  } catch (e) {
    console.error("[lead-form] notification not written", e instanceof Error ? e.name : "unknown");
  }
}

export async function route(d: LeadFormDeps, r: FormRequest): Promise<FormResult> {
  try {
    if (r.method === "GET") return { status: 200, json: publicView(await openForm(d, r.formId)) };
    if (r.method === "POST") return await submit(d, r);
    return { status: 405, json: { error: "Method not allowed" } };
  } catch (e) {
    if (e instanceof AppError) return { status: e.status, json: { error: e.message } };
    throw e;
  }
}
