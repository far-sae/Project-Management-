import { AppError, StoreError } from "../_signroom/errors.js";
import { sendMail } from "../_signroom/mail.js";
import { isUuid } from "../_signroom/validate.js";
import { leadAddress } from "./actions.js";
import { currentWorkspace, type SignedInUser } from "./context.js";
import type { AutoDeps } from "./deps.js";

/**
 * Emailing the link of a meeting to the lead it is with.
 *
 * A meeting with a lead (crm_meetings, migration 221) is made in the browser:
 * its room and its link come from the call server. This route only sends the
 * email. What it sends is read from the database, never from the request: the
 * meeting of this workspace, and the lead's own address from the CRM. So it
 * cannot be used to write to anybody else, or to send any other link.
 *
 * It goes out through the documents server's sendMail: the workspace's own
 * mailbox when one is connected, else the app's sender, with the same limits
 * and the same delivery log as every other email of the workspace.
 */

export const MEETING_INVITE_PURPOSE = "meeting-invite";
export const MEETING_NOT_FOUND_MESSAGE = "This meeting was not found.";
export const NO_ADDRESS_MESSAGE = "This lead has no email address. Add one on the lead, or copy the link and send it yourself.";
export const UNSUBSCRIBED_MESSAGE = "This person asked not to get emails from you, so the invite was not emailed. You can copy the link and send it another way.";
export const INVITE_NOT_SENT_MESSAGE = "The invite could not be emailed from here. Copy the link and send it yourself.";
const NO_LEAD_MESSAGE = "This meeting is not with a lead, so there is nobody to email. Copy the link and send it yourself.";
const BAD_LINK_MESSAGE = "This meeting has no link that can be sent. Make the meeting again.";

/** The only links this route ever sends: the join page of this app. */
const JOIN_LINK = /^https:\/\/taskcalendar\.co\.uk\/join\/[A-Za-z0-9_.-]{20,4096}$/;

/**
 * "Wednesday 2 December 2026, 15:00 (Europe/London)": the start in the
 * organiser's own time zone, with the zone named, because the person invited
 * may be in another one. A zone that is not one gives the time in UTC.
 */
export function whenWords(startsAt: string, timeZone: unknown): string {
  const at = new Date(startsAt);
  const words = (zone: string): string => {
    const part = new Intl.DateTimeFormat("en-GB", { timeZone: zone, weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(at);
    const get = (type: string): string => part.find((p) => p.type === type)?.value ?? "";
    return `${get("weekday")} ${get("day")} ${get("month")} ${get("year")}, ${get("hour")}:${get("minute")} (${zone})`;
  };
  if (typeof timeZone === "string" && timeZone.length <= 64) {
    try {
      return words(timeZone);
    } catch {
      // Not a time zone: fall through to UTC.
    }
  }
  return words("UTC");
}

/** The email, as plain text. */
export function inviteText(p: { firstName: string; from: string; title: string; when: string; minutes: number; joinUrl: string; message: string }): string {
  const lines = [
    p.firstName ? `Hello ${p.firstName},` : "Hello,",
    "",
    `${p.from} invites you to a video meeting.`,
    "",
    `What: ${p.title}`,
    `When: ${p.when}`,
    `How long: ${p.minutes} minutes`,
    `Join here: ${p.joinUrl}`,
  ];
  if (p.message) lines.push("", p.message);
  lines.push("", "The link opens in your browser. No account and no app is needed. You type your name, and the host lets you in.");
  return lines.join("\n");
}

/** One line of plain words. */
const oneLine = (value: string, max: number): string => value.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

export async function sendMeetingInvite(deps: AutoDeps, user: SignedInUser, id: string, body: Record<string, unknown>): Promise<{ sentTo: string }> {
  const ctx = await currentWorkspace(deps.store, user);
  const meeting = isUuid(id) ? await deps.store.getMeeting(ctx.workspaceId, id) : null;
  if (!meeting || meeting.cancelledAt) throw new AppError(MEETING_NOT_FOUND_MESSAGE, 404);
  if (!JOIN_LINK.test(meeting.joinUrl)) throw new AppError(BAD_LINK_MESSAGE);
  if (!meeting.contactId) throw new AppError(NO_LEAD_MESSAGE);
  const lead = await deps.store.getLead(ctx.workspaceId, meeting.contactId);
  const to = lead ? leadAddress(lead) : null;
  if (!lead || !to) throw new AppError(NO_ADDRESS_MESSAGE);
  if (await deps.store.emailSuppressed(ctx.organizationId, to)) throw new AppError(UNSUBSCRIBED_MESSAGE);
  if (!deps.mail) throw new AppError(INVITE_NOT_SENT_MESSAGE, 503);

  const title = oneLine(meeting.title, 150) || "Meeting";
  const when = whenWords(meeting.startsAt, body.timeZone);
  const message = typeof body.message === "string" ? body.message.replace(/\r\n/g, "\n").trim().slice(0, 2000) : "";
  try {
    // The documents server's own row for this workspace (same id): its sender name, reply-to and mailbox.
    const sender = await deps.mail.store.ensureWorkspace(ctx.workspaceId, ctx.name, user.id);
    await sendMail(deps.mail, sender, {
      to,
      subject: `Invitation: ${title}, ${when}`,
      text: inviteText({ firstName: oneLine(lead.firstName ?? "", 80), from: oneLine(sender.senderName || sender.name || ctx.name, 120), title, when, minutes: meeting.durationMinutes, joinUrl: meeting.joinUrl, message }),
      purpose: MEETING_INVITE_PURPOSE,
    });
  } catch (e) {
    // The status or the name only: the text of a mail failure can carry the address.
    console.error("[automation] meeting invite not sent", e instanceof AppError ? e.status : e instanceof Error ? e.name : "unknown");
    if (e instanceof AppError && e.status === 429) throw e;
    throw new AppError(INVITE_NOT_SENT_MESSAGE, e instanceof StoreError ? 503 : 502);
  }

  // The email is out. Bookkeeping after that must never make it look unsent.
  try {
    await deps.store.markMeetingInvited(ctx.workspaceId, meeting.id, to, (deps.now?.() ?? new Date()).toISOString());
    await deps.store.logActivity(lead, {
      type: "meeting", description: `Meeting invite sent: “${title}”, ${when}`, contactId: lead.id, companyId: lead.companyId, dealId: null,
      metadata: { source: "meeting-invite", meetingId: meeting.id, startsAt: meeting.startsAt }, userId: user.id,
    });
  } catch (e) {
    console.error("[automation] sent meeting invite not recorded", e instanceof Error ? e.name : "unknown");
  }
  return { sentTo: to };
}
