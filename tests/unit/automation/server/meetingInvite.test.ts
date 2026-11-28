// @vitest-environment node
// Emailing the link of a meeting to the lead it is with: the meeting is read
// from the database (never from the request), the address is the lead's own
// from the CRM, and the email goes out through the workspace's own sender.
import { describe, expect, it } from "vitest";
import { MEETING_INVITE_PURPOSE, inviteText, whenWords } from "../../../../api/_automation/meetings";
import { errorOf, MEMBER, OTHER_OWNER, OUTSIDER, OWNER, VIEWER, world, WS, WS_OTHER } from "./helpers";

const JOIN = "https://taskcalendar.co.uk/join/eyJyb29tIjoiY3JtOndzOm1lZXRpbmcifQ.c2lnbmF0dXJlLW9mLXRoZS1saW5r";
const STARTS = "2026-12-02T15:00:00.000Z";

function setup(over: { email?: string | null; mail?: boolean } = {}) {
  const w = world({ mail: over.mail });
  const lead = w.store.seedLead({ workspaceId: WS, firstName: "Elena", lastName: "Rossi", email: over.email === undefined ? "elena@northwind.example" : (over.email ?? "") });
  const meeting = w.store.seedMeeting({ workspaceId: WS, contactId: lead.id, title: "Website review", startsAt: STARTS, durationMinutes: 30, joinUrl: JOIN });
  const invite = (user = OWNER, id = meeting.id, body: Record<string, unknown> = { timeZone: "Europe/London" }) => w.call(user, "POST", `meetings/${id}/invite`, body);
  return { w, lead, meeting, invite };
}

describe("the words of an invite", () => {
  it("writes the day and the time in the organiser's own time zone, and says which", () => {
    expect(whenWords(STARTS, "Europe/London")).toBe("Wednesday 2 December 2026, 15:00 (Europe/London)");
    expect(whenWords(STARTS, "Asia/Karachi")).toBe("Wednesday 2 December 2026, 20:00 (Asia/Karachi)");
    // A zone that is not one falls back to a time nobody can misread.
    expect(whenWords(STARTS, "Mars/Olympus")).toBe("Wednesday 2 December 2026, 15:00 (UTC)");
    expect(whenWords(STARTS, undefined)).toBe("Wednesday 2 December 2026, 15:00 (UTC)");
  });

  it("says who invites, what, when, how long, the link, and how joining works", () => {
    const text = inviteText({ firstName: "Elena", from: "Studio", title: "Website review", when: "Wednesday 2 December 2026, 15:00 (Europe/London)", minutes: 30, joinUrl: JOIN, message: "Bring the login details." });
    expect(text).toContain("Hello Elena,");
    expect(text).toContain("Studio invites you to a video meeting.");
    expect(text).toContain("What: Website review");
    expect(text).toContain("When: Wednesday 2 December 2026, 15:00 (Europe/London)");
    expect(text).toContain("How long: 30 minutes");
    expect(text).toContain(`Join here: ${JOIN}`);
    expect(text).toContain("Bring the login details.");
    expect(text).toMatch(/No account and no app is needed/);
    expect(inviteText({ firstName: "", from: "Studio", title: "T", when: "W", minutes: 30, joinUrl: JOIN, message: "" }).startsWith("Hello,")).toBe(true);
  });
});

describe("sending the invite", () => {
  it("emails the link to the lead's own address, and remembers that it was sent", async () => {
    const s = setup();
    const out = await s.invite();
    expect(out.status).toBe(200);
    expect(out.json).toEqual({ sentTo: "elena@northwind.example" });
    expect(s.w.resend.calls).toHaveLength(1);
    const sent = s.w.resend.calls[0].body;
    expect(sent.to).toEqual(["elena@northwind.example"]);
    expect(sent.subject).toBe("Invitation: Website review, Wednesday 2 December 2026, 15:00 (Europe/London)");
    expect(String(sent.text)).toContain(`Join here: ${JOIN}`);
    const kept = s.w.store.meetings().find((m) => m.id === s.meeting.id)!;
    expect(kept.invitedEmail).toBe("elena@northwind.example");
    expect(kept.invitedAt).toBeTruthy();
    // It is on the lead's timeline, as a meeting.
    const line = s.w.store.activities().find((a) => a.contactId === s.lead.id && a.type === "meeting");
    expect(line?.description).toBe("Meeting invite sent: “Website review”, Wednesday 2 December 2026, 15:00 (Europe/London)");
    expect(MEETING_INVITE_PURPOSE).toBe("meeting-invite");
  });

  it("can be sent by a member of the workspace, and never by a viewer or an outsider", async () => {
    const s = setup();
    expect((await s.invite(MEMBER)).status).toBe(200);
    expect((await s.invite(VIEWER)).status).toBe(403);
    expect((await s.invite(OUTSIDER)).status).toBe(403);
    expect(s.w.resend.calls).toHaveLength(1);
  });

  it("never sends a meeting of another workspace, or one that does not exist", async () => {
    const s = setup();
    const theirs = s.w.store.seedMeeting({ workspaceId: WS_OTHER, contactId: null, title: "Theirs", startsAt: STARTS, durationMinutes: 30, joinUrl: JOIN });
    expect((await s.invite(OWNER, theirs.id)).status).toBe(404);
    expect((await s.invite(OTHER_OWNER, s.meeting.id)).status).toBe(404);
    expect((await s.invite(OWNER, "0d000000-0000-4000-8000-00000000dead")).status).toBe(404);
    expect((await s.invite(OWNER, "not-an-id")).status).toBe(404);
    expect(s.w.resend.calls).toHaveLength(0);
  });

  it("says what to do when the lead has no email address", async () => {
    const s = setup({ email: null });
    const out = await s.invite();
    expect(out.status).toBe(400);
    expect(errorOf(out)).toBe("This lead has no email address. Add one on the lead, or copy the link and send it yourself.");
    expect(s.w.resend.calls).toHaveLength(0);
  });

  it("does not write to somebody who asked for no more email", async () => {
    const s = setup();
    s.w.store.leadUnsubscribes(s.lead.organizationId, "elena@northwind.example");
    const out = await s.invite();
    expect(out.status).toBe(400);
    expect(errorOf(out)).toMatch(/asked not to get emails/);
    expect(s.w.resend.calls).toHaveLength(0);
  });

  it("only ever sends a link to this app's own join page", async () => {
    const s = setup();
    const odd = s.w.store.seedMeeting({ workspaceId: WS, contactId: s.lead.id, title: "Odd", startsAt: STARTS, durationMinutes: 30, joinUrl: "https://evil.example/join/abc" });
    const out = await s.invite(OWNER, odd.id);
    expect(out.status).toBe(400);
    expect(s.w.resend.calls).toHaveLength(0);
  });

  it("does not send for a meeting that was cancelled", async () => {
    const s = setup();
    s.w.store.cancelMeeting(s.meeting.id);
    expect((await s.invite()).status).toBe(404);
  });

  it("says so, without set-up words, when email cannot be sent from this server", async () => {
    const s = setup({ mail: false });
    const out = await s.invite();
    expect(out.status).toBe(503);
    expect(errorOf(out)).toBe("The invite could not be emailed from here. Copy the link and send it yourself.");
  });

  it("takes a short note for the lead, and only POST", async () => {
    const s = setup();
    await s.invite(OWNER, s.meeting.id, { timeZone: "Europe/London", message: "  See you then.\n\nSam  " });
    expect(String(s.w.resend.calls[0].body.text)).toContain("See you then.\n\nSam");
    expect((await s.w.call(OWNER, "GET", `meetings/${s.meeting.id}/invite`)).status).toBe(404);
  });
});
