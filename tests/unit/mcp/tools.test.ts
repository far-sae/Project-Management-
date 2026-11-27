// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
  ALREADY_STARTED_MESSAGE,
  callTool,
  CAMPAIGN_NOT_FOUND_MESSAGE,
  emailReach,
  hasBrokenField,
  MAX_RECIPIENTS,
  NO_ACCESS_MESSAGE,
  NO_MAILBOX_MESSAGE,
  NOBODY_MESSAGE,
  NOT_CLAUDES_MESSAGE,
  PREPARES_PER_HOUR,
  sendingHours,
  SENDS_PER_HOUR,
  TOO_OFTEN_MESSAGE,
  TOOLS,
  WORKSPACE_MESSAGE,
  type Campaign,
  type Contact,
  type EmailStore,
  type Mailbox,
  type OutboxRow,
  type TestSend,
  type ToolDeps,
} from "../../../api/_mcp/tools";

/**
 * What Claude can do in the Email area for the person who connected it. A
 * store in memory stands in for the database; nothing is sent anywhere.
 */

const ORG = "0b000000-0000-4000-8000-000000000001";
const WS = "0a000000-0000-4000-8000-000000000001";
const WS2 = "0a000000-0000-4000-8000-000000000002";
const OWNER = "0c000000-0000-4000-8000-000000000001";
const MEMBER = "0c000000-0000-4000-8000-000000000003";
const VIEWER = "0c000000-0000-4000-8000-000000000004";
const BOX = "0f000000-0000-4000-8000-000000000001";
const BOX2 = "0f000000-0000-4000-8000-000000000002";
const GROUP = "0e000000-0000-4000-8000-000000000001";
const lead = (n: number) => `0d000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function world() {
  const state = { now: new Date("2026-11-27T10:00:00Z"), n: 0 };
  const roles: Record<string, "owner" | "admin" | "member" | "viewer"> = { [OWNER]: "owner", [MEMBER]: "member", [VIEWER]: "viewer" };
  const given: Record<string, string> = {};
  const memberWorkspaces: Record<string, string[]> = { [MEMBER]: [WS] };
  const ownOnly = new Set<string>();
  const mailboxes: Record<string, Mailbox[]> = {
    [WS]: [{ id: BOX, label: "Sales", fromEmail: "sam@northwind.test", status: "active", isActive: true, pausedReason: null, dailyAllowance: 40, sentToday: 5 }],
    [WS2]: [],
  };
  const contacts: Array<Contact & { workspaceId: string; ownerId: string | null }> = [
    { id: lead(1), firstName: "Elena", lastName: "Rossi", email: "elena@harbour.test", jobTitle: "Owner", painPoint: "missed calls", groupId: GROUP, workspaceId: WS, ownerId: OWNER },
    { id: lead(2), firstName: "Priya", lastName: "Nair", email: "priya@fieldway.test", jobTitle: "", painPoint: "", groupId: GROUP, workspaceId: WS, ownerId: MEMBER },
    { id: lead(3), firstName: "Tom", lastName: "Okafor", email: "ELENA@harbour.test", jobTitle: "", painPoint: "", groupId: GROUP, workspaceId: WS, ownerId: OWNER },
    { id: lead(4), firstName: "Dana", lastName: "", email: "dana@left.test", jobTitle: "", painPoint: "", groupId: GROUP, workspaceId: WS, ownerId: OWNER },
    { id: lead(5), firstName: "No", lastName: "Address", email: null, jobTitle: "", painPoint: "", groupId: GROUP, workspaceId: WS, ownerId: OWNER },
    { id: lead(6), firstName: "Other", lastName: "Place", email: "other@place.test", jobTitle: "", painPoint: "", groupId: null, workspaceId: WS2, ownerId: OWNER },
  ];
  const suppressed = ["dana@left.test"];
  const campaigns = new Map<string, Campaign>();
  const outbox = new Map<string, OutboxRow[]>();
  const actions: Array<{ tool: string; targetId: string | null; summary: string; at: string; connectionId: string }> = [];
  const templates: Array<{ id: string; workspaceId: string; name: string; subject: string; bodyHtml: string }> = [];
  const tests: TestSend[] = [];
  const fail = { outbox: false, test: false, log: "" };
  /** Whether this database shares a campaign out over the mailboxes (216) or gives it one (168). */
  const turns = { on: false };
  const made: Array<{ senderName?: string | null; replyTo?: string | null; accountId: string | null }> = [];

  const store: EmailStore = {
    orgRole: async (org, user) => (org === ORG ? roles[user] ?? null : null),
    emailGiven: async (_org, user) => given[user] ?? null,
    workspaces: async () => [{ id: WS, name: "Northwind Studio" }, { id: WS2, name: "Second" }],
    memberWorkspaceIds: async (_org, user) => memberWorkspaces[user] ?? [],
    ownOnly: async (ws) => ownOnly.has(ws),
    mailboxes: async (_org, ws) => mailboxes[ws] ?? [],
    groups: async (_org, ws) => (ws === WS ? [{ id: GROUP, name: "Dentists", angle: "fewer missed calls" }] : []),
    contacts: async (_org, ws, f) =>
      contacts
        .filter((c) => c.workspaceId === ws && (!f.groupId || c.groupId === f.groupId) && (!f.ids || f.ids.includes(c.id)) && (!f.ownerId || c.ownerId === f.ownerId) && (f.ids ? true : c.email !== null))
        .filter((c) => !f.search || `${c.firstName} ${c.lastName} ${c.email}`.toLowerCase().includes(f.search.toLowerCase()))
        .slice(0, f.limit),
    countContacts: async (_org, ws, f) => contacts.filter((c) => c.workspaceId === ws && c.email !== null && (!f.groupId || c.groupId === f.groupId) && (!f.ownerId || c.ownerId === f.ownerId)).length,
    suppressed: async () => suppressed,
    sendWindow: async () => ({ enabled: true, start: 8, end: 18, days: [1, 2, 3, 4, 5], timezone: "Europe/London" }),
    templates: async (_org, ws) => templates.filter((t) => t.workspaceId === ws),
    saveTemplate: async (t) => {
      if (t.id) {
        const old = templates.find((x) => x.id === t.id);
        if (!old) return null;
        Object.assign(old, { name: t.name, subject: t.subject, bodyHtml: t.bodyHtml });
        return old.id;
      }
      const id = `0e100000-0000-4000-8000-${String(++state.n).padStart(12, "0")}`;
      templates.push({ id, workspaceId: t.workspaceId, name: t.name, subject: t.subject, bodyHtml: t.bodyHtml });
      return id;
    },
    takesTurns: async () => turns.on,
    createCampaign: async (c) => {
      made.push({ senderName: c.senderName, replyTo: c.replyTo, accountId: c.accountId });
      const id = `0e200000-0000-4000-8000-${String(++state.n).padStart(12, "0")}`;
      campaigns.set(id, { id, organizationId: c.organizationId, workspaceId: c.workspaceId, kind: "bulk", name: c.name, subject: c.subject, bodyHtml: c.bodyHtml, status: "draft", accountId: c.accountId, scheduledAt: null, createdAt: state.now.toISOString(), counts: { queued: 0, sent: 0, failed: 0, leftOut: 0, replied: 0, bounced: 0, opened: 0 } });
      return id;
    },
    addToOutbox: async (id, _org, rows) => {
      if (fail.outbox) throw new Error("database is down");
      outbox.set(id, rows);
    },
    setCounts: async (id, queued, leftOut) => {
      const c = campaigns.get(id);
      if (c) Object.assign(c.counts, { queued, leftOut });
    },
    campaign: async (org, id) => {
      const c = campaigns.get(id);
      return c && c.organizationId === org ? c : null;
    },
    campaigns: async (_org, ws, limit) => [...campaigns.values()].filter((c) => c.workspaceId === ws && c.kind !== "sequence").slice(0, limit),
    firstOutboxRow: async (id) => outbox.get(id)?.[0] ?? null,
    startCampaign: async (id, at) => {
      const c = campaigns.get(id);
      if (!c || c.status !== "draft") return "changed";
      if (!(mailboxes[String(c.workspaceId)] ?? []).some((m) => m.status === "active" && m.isActive)) return "no_mailbox";
      c.status = at ? "scheduled" : "sending";
      c.scheduledAt = at;
      return "started";
    },
    pauseCampaign: async (id) => {
      const c = campaigns.get(id);
      if (!c || (c.status !== "sending" && c.status !== "scheduled")) return false;
      c.status = "paused";
      return true;
    },
    resumeCampaign: async (id, waiting) => {
      const c = campaigns.get(id);
      if (!c || c.status !== "paused") return false;
      c.status = waiting ? "scheduled" : "sending";
      return true;
    },
    deleteDraft: async (id) => {
      const c = campaigns.get(id);
      if (!c || c.status !== "draft") return false;
      campaigns.delete(id);
      outbox.delete(id);
      return true;
    },
    userEmail: async (user) => (user === OWNER ? "sam@northwind.test" : user === MEMBER ? "member@northwind.test" : null),
    logAction: async (a) => {
      if (fail.log === a.tool) throw new Error("the record could not be written");
      actions.push({ tool: a.tool, targetId: a.targetId, summary: a.summary, at: state.now.toISOString(), connectionId: a.connectionId });
    },
    countActions: async (_org, tool, since) => actions.filter((a) => a.tool === tool && a.at >= since).length,
    madeByClaude: async (_org, id, tool) => actions.some((a) => a.tool === tool && a.targetId === id),
  };
  const deps: ToolDeps = {
    store,
    site: "https://app.example.test",
    now: () => state.now,
    sendTest: async (t) => {
      tests.push(t);
      return !fail.test;
    },
  };
  const as = (userId: string) => (name: string, args: Record<string, unknown> = {}) => callTool(deps, { organizationId: ORG, userId, connectionId: "conn-1" }, name, args);
  const draft = { workspace_id: WS, name: "November offer", subject: "A quick idea, {{first_name}}", body: "Hi {{first_name}},\n\nWe help with {{pain_point}}.", to: { group_id: GROUP } };
  /** The owner prepares the usual campaign; its id. */
  const prepared = async (over: Record<string, unknown> = {}) => {
    const out = await as(OWNER)("prepare_campaign", { ...draft, ...over });
    if (!out.ok) throw new Error(out.message);
    return (out.data as { campaign_id: string }).campaign_id;
  };
  return { state, roles, given, memberWorkspaces, ownOnly, mailboxes, contacts, suppressed, campaigns, outbox, actions, templates, tests, fail, turns, made, store, deps, as, draft, prepared };
}

const data = <T,>(out: { ok: boolean; data?: unknown; message?: string }): T => {
  if (!out.ok) throw new Error(out.message);
  return out.data as T;
};
const refusal = (out: { ok: boolean; message?: string }): string => (out.ok ? "(it worked)" : String(out.message));

describe("Claude and email: who it may act for", () => {
  it("gives the owner every workspace, and a member only what the owner switched on, where they are on a project", async () => {
    const w = world();
    expect((await emailReach(w.store, ORG, OWNER))?.workspaces.map((x) => x.id)).toEqual([WS, WS2]);
    expect(await emailReach(w.store, ORG, MEMBER)).toBeNull();
    w.given[MEMBER] = "off";
    expect(await emailReach(w.store, ORG, MEMBER)).toBeNull();
    w.given[MEMBER] = "use";
    expect((await emailReach(w.store, ORG, MEMBER))?.workspaces.map((x) => x.id)).toEqual([WS]);
    expect(await emailReach(w.store, ORG, VIEWER)).toBeNull();
    expect(await emailReach(w.store, "99999999-9999-4999-8999-999999999999", OWNER)).toBeNull();
  });

  it("stops at once when the person lost the Email page, whatever was connected before", async () => {
    const w = world();
    w.given[MEMBER] = "use";
    expect((await w.as(MEMBER)("list_workspaces")).ok).toBe(true);
    w.given[MEMBER] = "off";
    for (const tool of TOOLS) expect(refusal(await w.as(MEMBER)(tool.name, { workspace_id: WS })), tool.name).toBe(NO_ACCESS_MESSAGE);
    expect(refusal(await w.as(VIEWER)("list_workspaces"))).toBe(NO_ACCESS_MESSAGE);
  });

  it("never reaches into a workspace the person is not in", async () => {
    const w = world();
    w.given[MEMBER] = "use";
    for (const name of ["list_mailboxes", "list_groups", "find_leads", "list_templates", "list_campaigns"]) expect(refusal(await w.as(MEMBER)(name, { workspace_id: WS2 })), name).toBe(WORKSPACE_MESSAGE);
    expect(refusal(await w.as(MEMBER)("prepare_campaign", { ...w.draft, workspace_id: WS2, to: { all_leads: true } }))).toBe(WORKSPACE_MESSAGE);
    // A campaign of that workspace does not exist for them either.
    w.mailboxes[WS2] = w.mailboxes[WS];
    const theirs = await w.prepared({ workspace_id: WS2, to: { all_leads: true } });
    expect(refusal(await w.as(MEMBER)("campaign_results", { campaign_id: theirs }))).toBe(CAMPAIGN_NOT_FOUND_MESSAGE);
    expect(refusal(await w.as(MEMBER)("pause_campaign", { campaign_id: theirs }))).toBe(CAMPAIGN_NOT_FOUND_MESSAGE);
  });

  it("shows a member only their own leads where the workspace is set to own leads only", async () => {
    const w = world();
    w.given[MEMBER] = "use";
    w.ownOnly.add(WS);
    const found = data<{ leads: Array<{ email: string }> }>(await w.as(MEMBER)("find_leads", { workspace_id: WS }));
    expect(found.leads.map((l) => l.email)).toEqual(["priya@fieldway.test"]);
    const out = data<{ people: number }>(await w.as(MEMBER)("prepare_campaign", { ...w.draft }));
    expect(out.people).toBe(1);
    expect(data<{ leads: unknown[] }>(await w.as(OWNER)("find_leads", { workspace_id: WS })).leads).toHaveLength(4);
  });
});

describe("Claude and email: looking around", () => {
  it("lists workspaces, mailboxes and groups in plain words", async () => {
    const w = world();
    expect(data(await w.as(OWNER)("list_workspaces"))).toMatchObject({ workspaces: [{ id: WS, name: "Northwind Studio", mailboxes_ready: 1, leads_with_email: 4 }, { id: WS2, mailboxes_ready: 0, leads_with_email: 1 }] });
    expect(data(await w.as(OWNER)("list_mailboxes", { workspace_id: WS }))).toMatchObject({
      mailboxes: [{ id: BOX, name: "Sales", sends_from: "sam@northwind.test", state: "ready", emails_a_day: 40, sent_today: 5, left_today: 35 }],
      sending_hours: "Emails go out Monday to Friday, 08:00 to 18:00 (Europe/London), a few at a time. Outside those hours they wait.",
    });
    expect(data<{ note: string }>(await w.as(OWNER)("list_mailboxes", { workspace_id: WS2 })).note).toBe(NO_MAILBOX_MESSAGE);
    expect(data(await w.as(OWNER)("list_groups", { workspace_id: WS }))).toMatchObject({ all_leads_with_email: 4, groups: [{ id: GROUP, name: "Dentists", angle: "fewer missed calls", leads_with_email: 4 }] });
  });

  it("says when emails go out", () => {
    expect(sendingHours(null)).toBe("Emails go out at any time of day, a few at a time.");
    expect(sendingHours({ enabled: true, start: 9, end: 17, days: [1, 2, 3, 4, 5, 6, 7], timezone: "UTC" })).toContain("every day, 09:00 to 17:00 (UTC)");
    expect(sendingHours({ enabled: true, start: 9, end: 17, days: [6, 1], timezone: "UTC" })).toContain("Monday, Saturday,");
  });
});

describe("Claude and email: preparing a campaign", () => {
  it("makes a draft, says who gets it and who is left out and why, and sends nothing", async () => {
    const w = world();
    const out = data<Record<string, any>>(await w.as(OWNER)("prepare_campaign", w.draft));
    expect(out).toMatchObject({
      people: 2,
      chosen_from: 'the group "Dentists"',
      left_out: { on_the_do_not_email_list: 1, without_a_usable_email_address: 0, doubles: 1 },
      sends_from: "sam@northwind.test",
      pace: "sam@northwind.test sends up to 40 emails a day, so this takes about 1 sending day.",
      sample: { to: "elena@harbour.test", subject: "A quick idea, Elena", body: "Hi Elena,\nWe help with missed calls." },
      see_it_in_the_app: "https://app.example.test/email",
    });
    const made = w.campaigns.get(out.campaign_id);
    expect(made).toMatchObject({ status: "draft", kind: "bulk", name: "November offer", accountId: null, counts: { queued: 2, leftOut: 1 } });
    expect(made?.bodyHtml).toBe("<p>Hi {{first_name}},</p><p>We help with {{pain_point}}.</p>");
    expect(w.outbox.get(out.campaign_id)?.map((r) => r.email)).toEqual(["elena@harbour.test", "priya@fieldway.test"]);
    expect(w.outbox.get(out.campaign_id)?.[0]).toMatchObject({ contactId: lead(1), name: "Elena Rossi", mergeData: { first_name: "Elena", full_name: "Elena Rossi", pain_point: "missed calls", angle: "fewer missed calls", group_name: "Dentists" } });
    // Priya has no pain point written down: the person is told that the field is empty for some.
    expect(out.warnings).toEqual(["{{pain_point}} is empty for some of these people; for them nothing is written there."]);
    expect(w.tests).toEqual([]);
  });

  it("takes anything a browser would run out of the email before it is saved", async () => {
    const w = world();
    const id = await w.prepared({ body: '<p onclick="x()">Hi</p><script>alert(1)</script><img src=x onerror=alert(1)><a href="javascript:alert(1)">go</a>' });
    expect(w.campaigns.get(id)?.bodyHtml).toBe("<p>Hi</p><a>go</a>");
  });

  it("can go to chosen leads, to every lead, or to addresses the person named", async () => {
    const w = world();
    const chosen = data<Record<string, any>>(await w.as(OWNER)("prepare_campaign", { ...w.draft, to: { lead_ids: [lead(2), lead(5), lead(6), "not-an-id"] } }));
    // Lead 5 has no address; lead 6 is in another workspace, so it is not found.
    expect(chosen).toMatchObject({ people: 1, left_out: { without_a_usable_email_address: 1, leads_not_found: 1 } });
    const all = data<Record<string, any>>(await w.as(OWNER)("prepare_campaign", { ...w.draft, to: { all_leads: true } }));
    expect(all).toMatchObject({ people: 2, chosen_from: "every lead in Northwind Studio" });
    const typed = data<Record<string, any>>(await w.as(OWNER)("prepare_campaign", { ...w.draft, to: { addresses: [{ email: "new@person.test", first_name: "Sam" }, { email: "not an address" }, { email: "DANA@left.test" }] } }));
    expect(typed).toMatchObject({ people: 1, left_out: { on_the_do_not_email_list: 1, without_a_usable_email_address: 1 }, sample: { to: "new@person.test", subject: "A quick idea, Sam" } });
    expect(w.outbox.get(typed.campaign_id)?.[0]).toMatchObject({ contactId: null, mergeData: { first_name: "Sam" } });
  });

  it("refuses a campaign with nobody in it, no clear recipients, no words, or a broken field, and leaves nothing behind", async () => {
    const w = world();
    const no = async (over: Record<string, unknown>) => refusal(await w.as(OWNER)("prepare_campaign", { ...w.draft, ...over }));
    expect(await no({ to: { lead_ids: [lead(4)] } })).toBe(NOBODY_MESSAGE);
    expect(await no({ to: {} })).toContain("exactly one way");
    expect(await no({ to: { group_id: GROUP, all_leads: true } })).toContain("exactly one way");
    expect(await no({ to: { group_id: "0e000000-0000-4000-8000-00000000ffff" } })).toContain("group was not found");
    expect(await no({ subject: "  " })).toBe("The email needs a subject.");
    expect(await no({ body: "<p> </p>" })).toBe("The email needs some text.");
    expect(await no({ name: "" })).toBe("The campaign needs a name.");
    expect(await no({ body: "<p>Hi {{first_<b>name</b>}}</p>" })).toContain("broken by formatting");
    expect(w.campaigns.size).toBe(0);
  });

  it("warns about a field that no lead has", async () => {
    const w = world();
    const out = data<Record<string, any>>(await w.as(OWNER)("prepare_campaign", { ...w.draft, subject: "Hello", body: "Hi {{nickname}}, {{signature}}" }));
    expect(out.warnings[0]).toContain("{{nickname}} is not a field of a lead");
    expect(out.warnings).toHaveLength(1);
    expect(out.sample.body).toBe("Hi ,");
  });

  it("needs a mailbox that can send, and uses the one that was asked for", async () => {
    const w = world();
    expect(refusal(await w.as(OWNER)("prepare_campaign", { ...w.draft, workspace_id: WS2, to: { all_leads: true } }))).toBe(NO_MAILBOX_MESSAGE);
    w.mailboxes[WS].push({ id: BOX2, label: "", fromEmail: "second@northwind.test", status: "active", isActive: false, pausedReason: "too many bounces", dailyAllowance: 1, sentToday: 0 });
    expect(refusal(await w.as(OWNER)("prepare_campaign", { ...w.draft, mailbox_id: BOX2 }))).toContain("cannot send right now");
    expect(refusal(await w.as(OWNER)("prepare_campaign", { ...w.draft, mailbox_id: "0f000000-0000-4000-8000-00000000ffff" }))).toContain("mailbox was not found");
    const id = await w.prepared({ mailbox_id: BOX });
    expect(w.campaigns.get(id)?.accountId).toBe(BOX);
    expect(data<{ mailboxes: Array<{ state: string; why_paused?: string }> }>(await w.as(OWNER)("list_mailboxes", { workspace_id: WS })).mailboxes[1]).toMatchObject({ state: "paused", why_paused: "too many bounces" });
  });

  it("shares a campaign out over all working mailboxes when none is named, with one sender name and one reply address", async () => {
    const w = world();
    w.turns.on = true;
    w.mailboxes[WS].push({ id: BOX2, label: "Second", fromEmail: "second@northwind.test", status: "active", isActive: true, pausedReason: null, dailyAllowance: 25, sentToday: 0 });
    w.mailboxes[WS].push({ id: "0f000000-0000-4000-8000-000000000003", label: "Paused", fromEmail: "paused@northwind.test", status: "active", isActive: false, pausedReason: "x", dailyAllowance: 99, sentToday: 0 });
    const out = data<Record<string, any>>(await w.as(OWNER)("prepare_campaign", { ...w.draft, sender_name: "  Northwind   Studio ", reply_to: " Hello@Northwind.test " }));
    expect(out.sends_from).toBe("your 2 working mailboxes, in turn (sam@northwind.test, second@northwind.test)");
    expect(out.pace).toBe("Together they send up to 65 emails a day, so this takes about 1 sending day. Each email comes from the address of the mailbox that sends it.");
    expect(out.shown_as).toBe("Northwind Studio");
    expect(out.replies_go_to).toBe("hello@northwind.test");
    expect(w.made[0]).toEqual({ senderName: "Northwind Studio", replyTo: "hello@northwind.test", accountId: null });
    expect(refusal(await w.as(OWNER)("prepare_campaign", { ...w.draft, reply_to: "not an address" }))).toBe("reply_to is not an email address.");
  });

  it("says one mailbox sends it all when a mailbox is named, or on a database where mailboxes do not take turns yet", async () => {
    const w = world();
    w.mailboxes[WS].push({ id: BOX2, label: "Second", fromEmail: "second@northwind.test", status: "active", isActive: true, pausedReason: null, dailyAllowance: 25, sentToday: 0 });
    const before = data<Record<string, any>>(await w.as(OWNER)("prepare_campaign", { ...w.draft, sender_name: "Northwind Studio", reply_to: "hello@northwind.test" }));
    expect(before.sends_from).toBe("sam@northwind.test");
    expect(before.shown_as).toBeUndefined();
    // Nothing the database cannot keep is written.
    expect(w.made[0]).toEqual({ senderName: null, replyTo: null, accountId: null });
    w.turns.on = true;
    const named = data<Record<string, any>>(await w.as(OWNER)("prepare_campaign", { ...w.draft, mailbox_id: BOX2, sender_name: "Northwind Studio" }));
    expect(named.sends_from).toBe("second@northwind.test");
    expect(named.pace).toContain("second@northwind.test sends up to 25 emails a day");
    expect(w.made[1]).toMatchObject({ accountId: BOX2, senderName: "Northwind Studio" });
  });

  it("refuses more people than one campaign may have, and too many campaigns in an hour", async () => {
    const w = world();
    for (let i = 0; i < MAX_RECIPIENTS + 1; i++) w.contacts.push({ id: lead(1000 + i), firstName: "P", lastName: String(i), email: `p${i}@many.test`, jobTitle: "", painPoint: "", groupId: null, workspaceId: WS, ownerId: OWNER });
    expect(refusal(await w.as(OWNER)("prepare_campaign", { ...w.draft, to: { all_leads: true } }))).toContain("at most 5,000");
    expect(w.campaigns.size).toBe(0);
    for (let i = 0; i < PREPARES_PER_HOUR; i++) await w.prepared();
    expect(refusal(await w.as(OWNER)("prepare_campaign", w.draft))).toBe(TOO_OFTEN_MESSAGE);
    w.state.now = new Date(w.state.now.getTime() + 61 * 60_000);
    expect((await w.as(OWNER)("prepare_campaign", w.draft)).ok).toBe(true);
  });

  it("reads a hostile body in no time, and still finds a field broken by formatting", async () => {
    const w = world();
    const started = Date.now();
    // Sixteen thousand characters of this took a pattern fifteen seconds; twice as many, two minutes.
    const out = await w.as(OWNER)("prepare_campaign", { ...w.draft, body: "{{<b>".repeat(3200) });
    expect(Date.now() - started).toBeLessThan(2000);
    expect(out.ok).toBe(true);
    expect(hasBrokenField("Hi {{first_<b>name</b>}}")).toBe(true);
    expect(hasBrokenField("Hi {{ first_name }} and <b>{{email}}</b> {{</b>")).toBe(false);
    expect(hasBrokenField("{{a} <b>x</b> {{b}}")).toBe(false);
  });

  it("asks 'too often?' before it reads anybody's leads", async () => {
    const w = world();
    for (let i = 0; i < PREPARES_PER_HOUR; i++) await w.prepared();
    const contacts = vi.spyOn(w.store, "contacts");
    const suppressed = vi.spyOn(w.store, "suppressed");
    expect(refusal(await w.as(OWNER)("prepare_campaign", { ...w.draft, to: { all_leads: true } }))).toBe(TOO_OFTEN_MESSAGE);
    expect(contacts).not.toHaveBeenCalled();
    expect(suppressed).not.toHaveBeenCalled();
  });

  it("takes control characters out of the words, and refuses an address with one in it", async () => {
    const w = world();
    const id = await w.prepared({ subject: "Hello\u0000 there", body: "Hi\u0000 {{first_name}}\u0007" });
    expect(w.campaigns.get(id)).toMatchObject({ subject: "Hello there", bodyHtml: "<p>Hi {{first_name}}</p>" });
    const typed = data<Record<string, any>>(await w.as(OWNER)("prepare_campaign", { ...w.draft, to: { addresses: [{ email: "a\u0001b@person.test" }, { email: "fine@person.test" }] } }));
    expect(typed).toMatchObject({ people: 1, left_out: { without_a_usable_email_address: 1 } });
  });

  it("leaves no half-made campaign when the outbox cannot be written", async () => {
    const w = world();
    w.fail.outbox = true;
    await expect(w.as(OWNER)("prepare_campaign", w.draft)).rejects.toThrow("database is down");
    expect(w.campaigns.size).toBe(0);
    expect(w.actions).toEqual([]);
  });
});

describe("Claude and email: sending", () => {
  it("starts a campaign it prepared, once", async () => {
    const w = world();
    const id = await w.prepared();
    const out = data<Record<string, any>>(await w.as(OWNER)("send_campaign", { campaign_id: id }));
    expect(out).toMatchObject({ status: "sending", people: 2 });
    expect(w.campaigns.get(id)?.status).toBe("sending");
    expect(refusal(await w.as(OWNER)("send_campaign", { campaign_id: id }))).toBe(ALREADY_STARTED_MESSAGE);
    expect(w.actions.map((a) => a.tool)).toEqual(["prepare_campaign", "send_campaign"]);
    expect(w.actions[1].summary).toBe('Started "November offer" to 2 people');
  });

  it("plans a campaign for later, and reads a time in the past as now", async () => {
    const w = world();
    const later = await w.prepared();
    expect(data(await w.as(OWNER)("send_campaign", { campaign_id: later, send_at: "2026-12-01T09:00:00Z" }))).toMatchObject({ status: "planned", starts_at: "2026-12-01T09:00:00.000Z" });
    expect(w.campaigns.get(later)).toMatchObject({ status: "scheduled", scheduledAt: "2026-12-01T09:00:00.000Z" });
    const past = await w.prepared();
    expect(data(await w.as(OWNER)("send_campaign", { campaign_id: past, send_at: "2020-01-01T00:00:00Z" }))).toMatchObject({ status: "sending" });
    const far = await w.prepared();
    expect(refusal(await w.as(OWNER)("send_campaign", { campaign_id: far, send_at: "2028-01-01T00:00:00Z" }))).toContain("at most 60 days ahead");
    expect(refusal(await w.as(OWNER)("send_campaign", { campaign_id: far, send_at: "next tuesday" }))).toContain("not a time");
    expect(w.campaigns.get(far)?.status).toBe("draft");
  });

  it("never starts, tests or deletes a campaign that was made on the Email page", async () => {
    const w = world();
    const id = await w.store.createCampaign({ organizationId: ORG, workspaceId: WS, userId: OWNER, accountId: null, name: "By hand", subject: "s", bodyHtml: "<p>b</p>" });
    for (const tool of ["send_campaign", "send_test", "delete_draft"]) expect(refusal(await w.as(OWNER)(tool, { campaign_id: id })), tool).toBe(NOT_CLAUDES_MESSAGE);
    expect(w.campaigns.get(id)?.status).toBe("draft");
    // It can still say how it is going.
    expect(data(await w.as(OWNER)("campaign_results", { campaign_id: id }))).toMatchObject({ name: "By hand", prepared_by_claude: false });
  });

  it("says the campaign started when it did, also when the record of it could not be written", async () => {
    const w = world();
    const id = await w.prepared();
    w.fail.log = "send_campaign";
    expect(data(await w.as(OWNER)("send_campaign", { campaign_id: id }))).toMatchObject({ status: "sending" });
    expect(w.campaigns.get(id)?.status).toBe("sending");
  });

  it("says so when the workspace lost its mailbox between preparing and sending", async () => {
    const w = world();
    const id = await w.prepared();
    w.mailboxes[WS] = [];
    expect(refusal(await w.as(OWNER)("send_campaign", { campaign_id: id }))).toBe(NO_MAILBOX_MESSAGE);
    expect(w.campaigns.get(id)?.status).toBe("draft");
  });

  it("starts only so many campaigns in an hour", async () => {
    const w = world();
    for (let i = 0; i < SENDS_PER_HOUR; i++) expect((await w.as(OWNER)("send_campaign", { campaign_id: await w.prepared() })).ok).toBe(true);
    const one = await w.prepared();
    expect(refusal(await w.as(OWNER)("send_campaign", { campaign_id: one }))).toBe(TOO_OFTEN_MESSAGE);
    expect(w.campaigns.get(one)?.status).toBe("draft");
  });

  it("sends a test only to the person's own address, filled in with the first person of the campaign", async () => {
    const w = world();
    const id = await w.prepared();
    expect(data(await w.as(OWNER)("send_test", { campaign_id: id }))).toMatchObject({ sent_to: "sam@northwind.test", from: "sam@northwind.test" });
    expect(w.tests).toEqual([{ mailboxId: BOX, to: "sam@northwind.test", subject: "A quick idea, {{first_name}}", bodyHtml: "<p>Hi {{first_name}},</p><p>We help with {{pain_point}}.</p>", mergeData: expect.objectContaining({ first_name: "Elena" }) }]);
    // Whatever is passed, there is no way to name another address.
    await w.as(OWNER)("send_test", { campaign_id: id, to: "victim@elsewhere.test", email: "victim@elsewhere.test" });
    expect(w.tests.every((t) => t.to === "sam@northwind.test")).toBe(true);
    w.fail.test = true;
    expect(refusal(await w.as(OWNER)("send_test", { campaign_id: id }))).toContain("could not be sent from sam@northwind.test");
    // A mailbox that is paused is left alone, also when the campaign names it: another working one sends the test.
    w.fail.test = false;
    w.mailboxes[WS].push({ id: BOX2, label: "", fromEmail: "second@northwind.test", status: "active", isActive: true, pausedReason: null, dailyAllowance: 10, sentToday: 0 });
    const pinned = await w.prepared({ mailbox_id: BOX });
    w.mailboxes[WS][0].isActive = false;
    expect(data(await w.as(OWNER)("send_test", { campaign_id: pinned }))).toMatchObject({ from: "second@northwind.test" });
    w.mailboxes[WS][1].status = "error";
    expect(refusal(await w.as(OWNER)("send_test", { campaign_id: pinned }))).toBe(NO_MAILBOX_MESSAGE);
    w.mailboxes[WS][0].isActive = true;
    expect(refusal(await callTool({ ...w.deps, sendTest: undefined }, { organizationId: ORG, userId: OWNER, connectionId: "c" }, "send_test", { campaign_id: id }))).toContain("could not be sent right now");
  });

  it("pauses any campaign of the workspace, but lets only its own go on again", async () => {
    const w = world();
    const byHand = await w.store.createCampaign({ organizationId: ORG, workspaceId: WS, userId: OWNER, accountId: null, name: "By hand", subject: "s", bodyHtml: "<p>b</p>" });
    w.campaigns.get(byHand)!.status = "sending";
    expect(data(await w.as(OWNER)("pause_campaign", { campaign_id: byHand }))).toMatchObject({ status: "paused" });
    // The person paused (or Claude did): only they start real mail again, on the Email page.
    expect(refusal(await w.as(OWNER)("resume_campaign", { campaign_id: byHand }))).toBe(NOT_CLAUDES_MESSAGE);
    expect(w.campaigns.get(byHand)?.status).toBe("paused");
  });

  it("pauses and resumes its own campaign, and deletes only its own unsent drafts", async () => {
    const w = world();
    const id = await w.prepared();
    expect(refusal(await w.as(OWNER)("pause_campaign", { campaign_id: id }))).toContain("nothing to pause");
    await w.as(OWNER)("send_campaign", { campaign_id: id });
    expect(data(await w.as(OWNER)("pause_campaign", { campaign_id: id }))).toMatchObject({ status: "paused" });
    expect(refusal(await w.as(OWNER)("send_campaign", { campaign_id: id }))).toContain("Use resume_campaign");
    expect(refusal(await w.as(OWNER)("delete_draft", { campaign_id: id }))).toContain("Only a draft");
    expect(data(await w.as(OWNER)("resume_campaign", { campaign_id: id }))).toMatchObject({ status: "sending" });
    expect(refusal(await w.as(OWNER)("resume_campaign", { campaign_id: id }))).toBe("This campaign is not paused.");
    const unsent = await w.prepared();
    expect(data(await w.as(OWNER)("delete_draft", { campaign_id: unsent }))).toEqual({ deleted: true });
    expect(w.campaigns.has(unsent)).toBe(false);
  });

  it("lists campaigns with how each is going, without the hidden steps of a sequence", async () => {
    const w = world();
    const id = await w.prepared();
    const step = await w.store.createCampaign({ organizationId: ORG, workspaceId: WS, userId: OWNER, accountId: null, name: "step", subject: "s", bodyHtml: "b" });
    w.campaigns.get(step)!.kind = "sequence";
    Object.assign(w.campaigns.get(id)!.counts, { sent: 1, replied: 1 });
    expect(data(await w.as(OWNER)("list_campaigns", { workspace_id: WS }))).toEqual({ campaigns: [expect.objectContaining({ id, status: "draft (not started)", people: 2, sent: 1, still_to_send: 1, replied: 1 })] });
    expect(refusal(await w.as(OWNER)("campaign_results", { campaign_id: step }))).toBe(CAMPAIGN_NOT_FOUND_MESSAGE);
    expect(refusal(await w.as(OWNER)("campaign_results", { campaign_id: "nope" }))).toBe(CAMPAIGN_NOT_FOUND_MESSAGE);
  });
});

describe("Claude and email: templates and the tool list", () => {
  it("saves a template, cleaned, and changes one that exists", async () => {
    const w = world();
    const made = data<{ template_id: string }>(await w.as(OWNER)("save_template", { workspace_id: WS, name: "Intro", subject: "Hello {{first_name}}", body: "<p>Hi</p><script>x</script>" }));
    expect(w.templates).toEqual([{ id: made.template_id, workspaceId: WS, name: "Intro", subject: "Hello {{first_name}}", bodyHtml: "<p>Hi</p>" }]);
    await w.as(OWNER)("save_template", { workspace_id: WS, name: "Intro 2", subject: "Hello", body: "Hi again", template_id: made.template_id });
    expect(w.templates).toMatchObject([{ name: "Intro 2", bodyHtml: "<p>Hi again</p>" }]);
    expect(refusal(await w.as(OWNER)("save_template", { workspace_id: WS, name: "x", subject: "s", body: "b", template_id: "0e100000-0000-4000-8000-00000000ffff" }))).toBe("This template was not found.");
    // A template a person made on the Email page is theirs: Claude makes a new one instead of changing it.
    w.templates.push({ id: "0e100000-0000-4000-8000-00000000aaaa", workspaceId: WS, name: "Ours", subject: "s", bodyHtml: "<p>ours</p>" });
    expect(refusal(await w.as(OWNER)("save_template", { workspace_id: WS, name: "x", subject: "s", body: "b", template_id: "0e100000-0000-4000-8000-00000000aaaa" }))).toContain("can only change a template that it saved itself");
    expect(w.templates.find((t) => t.name === "Ours")?.bodyHtml).toBe("<p>ours</p>");
    expect(data(await w.as(OWNER)("list_templates", { workspace_id: WS }))).toEqual({
      templates: [
        { id: made.template_id, name: "Intro 2", subject: "Hello", body: "<p>Hi again</p>" },
        { id: "0e100000-0000-4000-8000-00000000aaaa", name: "Ours", subject: "s", body: "<p>ours</p>" },
      ],
    });
  });

  it("describes every tool, marks the ones that only read, and marks sending as something that cannot be undone", () => {
    const names = TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const t of TOOLS) {
      expect(t.name).toMatch(/^[a-z_]{3,40}$/);
      expect(t.description.length).toBeGreaterThan(40);
      expect(t.inputSchema).toMatchObject({ type: "object", additionalProperties: false });
    }
    const reads = TOOLS.filter((t) => t.annotations.readOnlyHint).map((t) => t.name);
    expect(reads).toEqual(["list_workspaces", "list_mailboxes", "list_groups", "find_leads", "list_templates", "list_campaigns", "campaign_results"]);
    expect(TOOLS.find((t) => t.name === "send_campaign")?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true, openWorldHint: true });
  });

  it("answers an unknown tool with a sentence, and lets a real fault through for the server to log", async () => {
    const w = world();
    expect(refusal(await w.as(OWNER)("drop_everything"))).toBe('There is no tool called "drop_everything".');
    const broken = { ...w.deps, store: { ...w.store, workspaces: vi.fn().mockRejectedValue(new Error("boom")) } };
    await expect(callTool(broken, { organizationId: ORG, userId: OWNER, connectionId: "c" }, "list_workspaces", {})).rejects.toThrow("boom");
  });
});
