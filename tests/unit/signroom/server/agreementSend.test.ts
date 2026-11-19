// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { agreementAction, getAgreement } from "../../../../api/_signroom/agreements";
import {
  activate,
  cancelAgreement,
  resendInvitations,
  sendAgreement,
  stableJson,
} from "../../../../api/_signroom/agreementSend";
import { sha } from "../../../../api/_signroom/billing";
import { currentWorkspace } from "../../../../api/_signroom/context";
import type { Agreement } from "../../../../api/_signroom/shared/types";
import { HELD_DELIVERY_MESSAGE } from "../../../../api/_signroom/jobs";
import type { Store } from "../../../../api/_signroom/store";
import { UNAVAILABLE_MESSAGE } from "../../../../api/_signroom/host/rateLimit";
import { madeDraft, mailSetup, newClient, OWNER, sent, type Resend } from "./agreementFixtures";
import { WS, withMemberRole } from "./helpers";

const ORIGIN = "https://app.example.com";

let logged: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => logged.mockRestore());

async function setup(opts: Parameters<typeof mailSetup>[0] = {}) {
  const m = mailSetup(opts);
  const ws = (await currentWorkspace(m.store, OWNER)).workspace;
  const client = await newClient(m.store);
  return { ...m, ws, client };
}

const body = (a: Agreement, extra: Record<string, unknown> = {}) => ({
  revision: a.revision,
  eligible: true,
  idempotencyKey: "send-" + a.id,
  ...extra,
});

const save = (store: Store, a: Agreement, patch: Record<string, unknown>) =>
  agreementAction(store, OWNER, a.id, "save", { ...a, ...patch }) as Promise<Agreement>;

type Sent = { to: string[]; subject: string; text: string };
const mails = (resend: Resend): Sent[] => resend.calls.map((c) => JSON.parse(String(c.init.body)) as Sent);
const rawOf = (text: string) => text.split("#access=")[1].trim();

describe("sendAgreement: SR's checks before freezing", () => {
  it("refuses without the eligibility confirmation (SR 'Eligibility confirmation enforced server-side')", async () => {
    const { deps, client } = await setup();
    const a = await madeDraft(deps, client.id);
    await expect(sendAgreement(deps, OWNER, a.id, body(a, { eligible: false }), ORIGIN)).rejects.toMatchObject({
      status: 400,
      message:
        "This release supports ordinary commercial agreements only. Documents requiring deeds, witnessing or special formalities cannot be sent.",
    });
    expect((await getAgreement(deps.store, OWNER, a.id)).status).toBe("Draft");
  });

  it("needs a required signature field for every signer", async () => {
    const { deps, client } = await setup();
    let a = await madeDraft(deps, client.id);
    a = await save(deps.store, a, { fields: [] });
    await expect(sendAgreement(deps, OWNER, a.id, body(a), ORIGIN)).rejects.toMatchObject({
      status: 400,
      message: "Add a required signature field for Signer 1.",
    });
  });

  it("needs unique recipient emails", async () => {
    const { deps, client } = await setup();
    let a = await madeDraft(deps, client.id, { recipients: 2 });
    a = await save(deps.store, a, {
      participants: a.participants.map((p) => ({ ...p, email: "same@example.test" })),
    });
    await expect(sendAgreement(deps, OWNER, a.id, body(a), ORIGIN)).rejects.toMatchObject({
      status: 400,
      message: "Use unique email addresses for recipients.",
    });
  });

  it("refuses a deadline in the past", async () => {
    const { deps, client } = await setup();
    let a = await madeDraft(deps, client.id);
    a = await save(deps.store, a, { deadline: "2020-01-01" });
    await expect(sendAgreement(deps, OWNER, a.id, body(a), ORIGIN)).rejects.toMatchObject({
      status: 400,
      message: "Choose a future deadline.",
    });
  });

  it("sign-first needs the sender as the first signer", async () => {
    const { deps, client } = await setup();
    let a = await madeDraft(deps, client.id, { recipients: 2 });
    a = await save(deps.store, a, { senderFirst: true });
    await expect(sendAgreement(deps, OWNER, a.id, body(a), ORIGIN)).rejects.toMatchObject({
      status: 400,
      message: "Sign-first requires you as the first signer and at least one other signer.",
    });
  });

  it("a stale revision is 409 'The draft changed. Review it again.'", async () => {
    const { deps, client } = await setup();
    const a = await madeDraft(deps, client.id);
    await expect(sendAgreement(deps, OWNER, a.id, body(a, { revision: a.revision - 1 }), ORIGIN)).rejects.toMatchObject({
      status: 409,
      message: "The draft changed. Review it again.",
    });
  });

  it("with no Resend key: 503 UNAVAILABLE_MESSAGE, and the agreement stays a Draft (Ruling A5)", async () => {
    const { deps, client, resend } = await setup({ resendKey: undefined });
    const a = await madeDraft(deps, client.id);
    await expect(sendAgreement(deps, OWNER, a.id, body(a), ORIGIN)).rejects.toMatchObject({
      status: 503,
      message: UNAVAILABLE_MESSAGE,
    });
    expect((await getAgreement(deps.store, OWNER, a.id)).status).toBe("Draft");
    expect(await deps.store.listSignTokens(a.id)).toEqual([]);
    expect(resend.calls).toHaveLength(0);
  });

  for (const missing of ["jobKey", "evidenceKey"] as const)
    it(`with no ${missing}: 503 UNAVAILABLE_MESSAGE, a Draft and no spend (Ruling B18, Review Focus 4)`, async () => {
      const { deps, client, resend, store } = await setup({ [missing]: null });
      const a = await madeDraft(deps, client.id);
      const spent: string[] = [];
      const spend = deps.spend!;
      deps.spend = async (sb, tool, key, limit, win) => (spent.push(tool), spend(sb, tool, key, limit, win));
      await expect(sendAgreement(deps, OWNER, a.id, body(a), ORIGIN)).rejects.toMatchObject({
        status: 503,
        message: UNAVAILABLE_MESSAGE,
      });
      expect((await getAgreement(deps.store, OWNER, a.id)).status).toBe("Draft");
      expect(spent).toEqual([]);
      expect(await deps.store.listSignTokens(a.id)).toEqual([]);
      expect(store.jobs()).toEqual([]);
      expect(resend.calls).toHaveLength(0);
    });

  it("the 101st send in a day is refused", async () => {
    const { deps, client } = await setup();
    const a = await madeDraft(deps, client.id);
    const spend = deps.spend!;
    deps.spend = async (sb, tool, key, limit, win) =>
      tool === "signroom-send" ? { ok: false, minutesLeft: 600 } : spend(sb, tool, key, limit, win);
    await expect(sendAgreement(deps, OWNER, a.id, body(a), ORIGIN)).rejects.toMatchObject({
      status: 429,
      message: "You can send up to 100 agreements a day. Try again tomorrow.",
    });
    expect((await getAgreement(deps.store, OWNER, a.id)).status).toBe("Draft");
  });
});

describe("sendAgreement: freezing", () => {
  it("freezes the agreement with a recomputable snapshot hash (Ruling A8)", async () => {
    const { deps, client, ws } = await setup();
    const a = await madeDraft(deps, client.id);
    const out = await sent(deps, a);
    expect(out.status).toBe("Awaiting signatures");
    expect(out).not.toHaveProperty("rowVersion");
    const got = await getAgreement(deps.store, OWNER, a.id);
    const { snapshotHash, ...rest } = got.frozen!;
    expect(snapshotHash).toBe(sha(stableJson(rest)));
    expect(got.frozen!.sourceHash).toBe(a.documentHash);
    expect(got.frozen!.consent.version).toBe("2026-11-v1");
    expect(got.frozen!.revision).toBe(a.revision);
    expect(got.frozen!.participants.map((p) => p.id)).toEqual(a.participants.map((p) => p.id));
    expect(got.frozen!.settings).toEqual({ sequential: false, deadline: "", reminderDays: 3, subject: "", message: "" });
    // Ruling A10: no "From name", so the email's local part.
    expect(got.frozen!.sender).toEqual({ name: "owner", email: OWNER.email, workspaceName: ws.name });
    // The inline run appends "Email accepted by provider" after it.
    const last = got.events.find((e) => e.type === "Agreement frozen and sent")!;
    expect(last.actor).toBe(OWNER.email);
    expect(last.detail).toEqual({
      sourceHash: a.documentHash,
      brandingHash: sha(stableJson(got.branding ?? {})),
      snapshotHash,
      consentVersion: "2026-11-v1",
    });
    expect(got.sendKey).toBe("send-" + a.id);
    expect(got.sentAt).toBeTruthy();
    expect(got.lastReminderAt).toBe(got.sentAt);
    expect(got.participants[0]).toMatchObject({ progress: "invited", version: 1 });
  });

  it("send records the link origin (Ruling B6)", async () => {
    const { deps, client } = await setup();
    const a = await madeDraft(deps, client.id);
    await sent(deps, a);
    expect((await getAgreement(deps.store, OWNER, a.id)).linkOrigin).toBe("https://app.example.com");
  });

  it("the invitations are queued jobs, run inside the same request", async () => {
    const { deps, client, store, resend } = await setup();
    const a = await madeDraft(deps, client.id, { recipients: 2 });
    await sent(deps, a);
    const jobs = store.jobs();
    expect(jobs.map((j) => [j.kind, j.purpose, j.status, j.payload])).toEqual([
      ["mail", "invite", "done", ""],
      ["mail", "invite", "done", ""],
    ]);
    const tokens = await deps.store.listSignTokens(a.id);
    for (const t of tokens) expect(jobs.some((j) => j.dedupe === `sign:${a.id}:${t.participantId}:${t.id}`)).toBe(true);
    expect(resend.calls).toHaveLength(2);
  });

  it("a failing job claim is logged and does not fail the send", async () => {
    const { deps, client, store, resend } = await setup();
    const a = await madeDraft(deps, client.id);
    deps.store = {
      ...store,
      claimJobs: async () => {
        const e = new Error("claim refused");
        e.name = "ClaimError";
        throw e;
      },
    };
    const out = await sent(deps, a);
    expect(out.status).toBe("Awaiting signatures");
    expect(store.jobs().map((j) => j.status)).toEqual(["queued"]);
    expect(resend.calls).toHaveLength(0);
    expect(logged).toHaveBeenCalledWith("[signroom] jobs run failed", "ClaimError");
  });

  it("a claim failing mid-run still returns what the run already wrote", async () => {
    const { deps, client, store, resend } = await setup();
    const a = await madeDraft(deps, client.id, { recipients: 2 });
    let claims = 0;
    deps.store = {
      ...store,
      claimJobs: async (limit, lease, ids) => {
        if (++claims === 2) throw new TypeError("claim refused");
        return store.claimJobs(limit, lease, ids);
      },
    };
    const out = await sent(deps, a);
    expect(out.status).toBe("Awaiting signatures");
    expect(resend.calls).toHaveLength(1);
    expect(out.events.filter((e) => e.type === "Email accepted by provider")).toHaveLength(1);
    expect(store.jobs().map((j) => j.status)).toEqual(["done", "queued"]);
    expect(logged).toHaveBeenCalledWith("[signroom] jobs run failed", "TypeError");
  });

  it("the frozen sender name is the workspace's From name when set (Ruling A10)", async () => {
    const { deps, client, ws } = await setup();
    await deps.store.updateWorkspace(ws.id, { senderName: "Bloom Legal" });
    const a = await madeDraft(deps, client.id);
    await sent(deps, a);
    expect((await getAgreement(deps.store, OWNER, a.id)).frozen!.sender!.name).toBe("Bloom Legal");
  });

  it("a double send freezes once and invites once (Review Focus 2)", async () => {
    const { deps, client, resend } = await setup();
    const a = await madeDraft(deps, client.id, { recipients: 2 });
    const first = await sent(deps, a);
    const repeat = await sendAgreement(deps, OWNER, a.id, body(a), ORIGIN);
    expect(repeat.id).toBe(first.id);
    const tokens = await deps.store.listSignTokens(a.id);
    for (const p of a.participants) expect(tokens.filter((t) => t.participantId === p.id)).toHaveLength(1);
    for (const p of a.participants) expect(mails(resend).filter((m) => m.to[0] === p.email)).toHaveLength(1);
    expect((await getAgreement(deps.store, OWNER, a.id)).events.filter((e) => e.type === "Agreement frozen and sent")).toHaveLength(1);
  });

  it("two sends at once with the same key freeze once and invite once", async () => {
    const { deps, client, resend } = await setup();
    const a = await madeDraft(deps, client.id, { recipients: 2 });
    const [x, y] = await Promise.all([
      sendAgreement(deps, OWNER, a.id, body(a), ORIGIN),
      sendAgreement(deps, OWNER, a.id, body(a), ORIGIN),
    ]);
    expect(x.id).toBe(a.id);
    expect(y.id).toBe(a.id);
    const tokens = await deps.store.listSignTokens(a.id);
    expect(tokens).toHaveLength(2);
    expect(resend.calls).toHaveLength(2);
  });

  it("two sends at once with different keys: one wins, the other is 409", async () => {
    const { deps, client } = await setup();
    const a = await madeDraft(deps, client.id);
    const out = await Promise.allSettled([
      sendAgreement(deps, OWNER, a.id, body(a, { idempotencyKey: "one" }), ORIGIN),
      sendAgreement(deps, OWNER, a.id, body(a, { idempotencyKey: "two" }), ORIGIN),
    ]);
    expect(out.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const lost = out.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(lost.reason).toMatchObject({ status: 409 });
    expect(await deps.store.listSignTokens(a.id)).toHaveLength(1);
  });

  it("a sent agreement is frozen: save is 409 (SR 'Frozen agreements reject edits')", async () => {
    const { deps, client } = await setup();
    const a = await madeDraft(deps, client.id);
    const out = await sent(deps, a);
    await expect(agreementAction(deps.store, OWNER, a.id, "save", { ...out, content: "Modified" })).rejects.toMatchObject({
      status: 409,
      message: "This agreement is frozen. Duplicate it to change terms.",
    });
    await expect(sendAgreement(deps, OWNER, a.id, body(a, { idempotencyKey: "other" }), ORIGIN)).rejects.toMatchObject({
      status: 409,
      message: "This agreement has already been sent.",
    });
  });

  it("sequential: only the first signer is invited (SR 'Sequential second signer not invited early')", async () => {
    const { deps, client, resend } = await setup();
    const a = await madeDraft(deps, client.id, { recipients: 2 });
    const out = await sent(deps, a, { sequential: true });
    const [one, two] = out.participants;
    const tokens = await deps.store.listSignTokens(a.id);
    expect(tokens.map((t) => t.participantId)).toEqual([one.id]);
    const deliveries = await deps.store.listAgreementDeliveries(a.id);
    expect(deliveries.map((d) => d.participantId)).toEqual([one.id]);
    expect(mails(resend).map((m) => m.to[0])).toEqual([one.email]);
    expect(one.progress).toBe("invited");
    expect(two.progress).toBe("waiting");
  });

  it("trash of an agreement awaiting signatures is 409", async () => {
    const { deps, client } = await setup();
    const a = await madeDraft(deps, client.id);
    await sent(deps, a);
    await expect(agreementAction(deps.store, OWNER, a.id, "trash", {})).rejects.toMatchObject({
      status: 409,
      message: "Cancel or complete the signing process before moving this document to Trash.",
    });
  });
});

describe("invitations", () => {
  it("emails <origin>/sign#access=<raw>; only the digest is stored, and the raw token is never logged", async () => {
    const { deps, client, resend } = await setup();
    const a = await madeDraft(deps, client.id);
    await sent(deps, a);
    const [mail] = mails(resend);
    expect(mail.to).toEqual([a.participants[0].email]);
    expect(mail.subject).toBe("Please sign: " + a.title);
    expect(mail.text).toContain("Please review and sign this agreement.\nhttps://app.example.com/sign#access=");
    const raw = rawOf(mail.text);
    expect(raw.length).toBeGreaterThan(20);
    const [token] = await deps.store.listSignTokens(a.id);
    expect(token).toMatchObject({
      digest: sha(raw),
      purpose: "sign",
      participantId: a.participants[0].id,
      email: a.participants[0].email,
      version: 1,
      revoked: false,
    });
    expect(token.expires - Date.now()).toBeGreaterThan(7 * 86400000 - 60000);
    expect(token.expires - Date.now()).toBeLessThanOrEqual(7 * 86400000);
    expect(JSON.stringify(token)).not.toContain(raw);
    const got = await getAgreement(deps.store, OWNER, a.id);
    expect(JSON.stringify(got)).not.toContain(raw);
    expect(JSON.stringify(await deps.store.listAgreementDeliveries(a.id))).not.toContain(raw);
    for (const call of logged.mock.calls) expect(JSON.stringify(call)).not.toContain(raw);
  });

  it("uses the agreement's own subject and message, and trims a trailing slash from the origin", async () => {
    const { deps, client, resend } = await setup();
    let a = await madeDraft(deps, client.id);
    a = await save(deps.store, a, { subject: "Your NDA", message: "Hello Bea." });
    await sendAgreement(deps, OWNER, a.id, body(a), ORIGIN + "/");
    const [mail] = mails(resend);
    expect(mail.subject).toBe("Your NDA");
    expect(mail.text).toMatch(/^Hello Bea\.\nhttps:\/\/app\.example\.com\/sign#access=[\w-]+$/);
    const [d] = await deps.store.listAgreementDeliveries(a.id);
    expect(d).toMatchObject({ purpose: "invite", agreementId: a.id, participantId: a.participants[0].id, status: "sent" });
  });

  it("a failed invitation does not fail the send (Review Focus 3)", async () => {
    const { deps, client, resend, store } = await setup();
    const a = await madeDraft(deps, client.id, { recipients: 2 });
    const two = a.participants[1];
    const fetch = deps.fetch;
    deps.fetch = (async (url: string, init: RequestInit) => {
      const to = (JSON.parse(String(init.body)) as Sent).to[0];
      if (to === two.email) {
        resend.calls.push({ url, init });
        return new Response("{}", { status: 500 });
      }
      return fetch(url, init);
    }) as never;
    const out = await sent(deps, a);
    expect(out.status).toBe("Awaiting signatures");
    expect(out.participants.map((p) => p.progress)).toEqual(["invited", "invited"]);
    // Ruling B2: Resend failed after the live attempt, so the job is held, never retried.
    const held = store.jobs().find((j) => j.participantId === two.id)!;
    expect(held).toMatchObject({ status: "failed", manualReview: true });
    const tokens = await deps.store.listSignTokens(a.id);
    expect(tokens.find((t) => t.participantId === a.participants[0].id)!.revoked).toBe(false);
    expect(tokens.find((t) => t.participantId === two.id)!.revoked).toBe(false);
    const deliveries = await deps.store.listAgreementDeliveries(a.id);
    const last = deliveries.filter((d) => d.participantId === two.id).at(-1)!;
    expect(last).toMatchObject({ status: "failed", error: HELD_DELIVERY_MESSAGE });
    const got = await getAgreement(deps.store, OWNER, a.id);
    expect(got.deliveries!.find((d) => d.participantId === two.id)!.state).toBe("failed");
    expect(got.deliveries!.find((d) => d.participantId === a.participants[0].id)!.state).toBe("sent");
    const raw = rawOf(mails(resend).find((m) => m.to[0] === two.email)!.text);
    for (const call of logged.mock.calls) expect(JSON.stringify(call)).not.toContain(raw);
    for (const call of logged.mock.calls) expect(JSON.stringify(call)).not.toContain(two.email);

    // A later resend issues a fresh token for both invited signers.
    deps.fetch = fetch;
    await resendInvitations(deps, OWNER, a.id, ORIGIN);
    const fresh = (await deps.store.listSignTokens(a.id)).filter((t) => t.participantId === two.id && !t.revoked);
    expect(fresh).toHaveLength(1);
    expect(fresh[0].version).toBe(2);
  });

  it("a refused invitation (the Securovix day limit) is a failed delivery; the send still succeeds (Review Focus 3)", async () => {
    const { deps, client, resend, store } = await setup();
    const a = await madeDraft(deps, client.id, { recipients: 2 });
    const two = a.participants[1];
    let peeks = 0;
    deps.peek = async (_sb, tool) => (tool === "signroom-mail" && ++peeks === 2 ? { ok: false, minutesLeft: 600 } : { ok: true });
    const out = await sent(deps, a);
    expect(out.status).toBe("Awaiting signatures");
    expect(out.participants.map((p) => p.progress)).toEqual(["invited", "invited"]);
    expect(mails(resend).map((m) => m.to[0])).toEqual([a.participants[0].email]);
    // A refusal is definite (Ruling B2): the job waits about a minute and tries again by itself.
    const job = store.jobs().find((j) => j.participantId === two.id)!;
    expect(job.status).toBe("queued");
    expect(job.available - Date.now()).toBeGreaterThan(50_000);
    expect(job.available - Date.now()).toBeLessThanOrEqual(60_000);
    const tokens = await deps.store.listSignTokens(a.id);
    expect(tokens.find((t) => t.participantId === two.id)!.revoked).toBe(false);
    expect(tokens.find((t) => t.participantId === a.participants[0].id)!.revoked).toBe(false);
    const failed = (await deps.store.listAgreementDeliveries(a.id)).filter((d) => d.participantId === two.id);
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({
      status: "failed",
      purpose: "invite",
      agreementId: a.id,
      route: "securovix",
      error: "New workspaces can send 100 emails a day for their first week. Try again tomorrow.",
    });
    expect(failed[0].error).not.toContain("@");
    expect(failed[0].error).not.toContain("#access=");
    const got = await getAgreement(deps.store, OWNER, a.id);
    expect(got.deliveries!.find((d) => d.participantId === two.id)!.state).toBe("failed");
  });

  it("activate does nothing while the sender's release is pending", async () => {
    const { deps, client, ws } = await setup();
    const a = await madeDraft(deps, client.id);
    const stored = (await deps.store.getAgreement(ws.id, a.id))!;
    const { a: out, jobIds } = await activate(deps, ws, { ...stored, senderReleasePending: true }, ORIGIN);
    expect(out.participants[0].progress).toBe("waiting");
    expect(jobIds).toEqual([]);
    expect(await deps.store.listSignTokens(a.id)).toEqual([]);
  });
});

describe("resendInvitations", () => {
  it("revokes the old link and issues a new one, version + 1; the 6th within the hour is 429", async () => {
    const { deps, client, resend } = await setup();
    const a = await madeDraft(deps, client.id);
    await sent(deps, a);
    const [old] = await deps.store.listSignTokens(a.id);
    const out = await resendInvitations(deps, OWNER, a.id, ORIGIN);
    expect(out.participants[0]).toMatchObject({ progress: "invited", version: 2 });
    expect(out.events.some((e) => e.type === "Invitations resent; previous links and sessions revoked")).toBe(true);
    const tokens = await deps.store.listSignTokens(a.id);
    expect(tokens.find((t) => t.id === old.id)!.revoked).toBe(true);
    const fresh = tokens.filter((t) => !t.revoked);
    expect(fresh).toHaveLength(1);
    expect(fresh[0].version).toBe(old.version + 1);
    const last = mails(resend).at(-1)!;
    expect(sha(rawOf(last.text))).toBe(fresh[0].digest);
    const deliveries = await deps.store.listAgreementDeliveries(a.id);
    expect(deliveries.at(-1)!.purpose).toBe("reminder");

    for (let i = 0; i < 4; i++) await resendInvitations(deps, OWNER, a.id, ORIGIN);
    await expect(resendInvitations(deps, OWNER, a.id, ORIGIN)).rejects.toMatchObject({
      status: 429,
      message: "Invitations for this agreement have been resent 5 times this hour. Try again in 42 minutes.",
    });
  });

  it("with no Resend key: 503 before any link is revoked, no event and no spend", async () => {
    const { deps, client } = await setup();
    const a = await madeDraft(deps, client.id);
    await sent(deps, a);
    const before = await getAgreement(deps.store, OWNER, a.id);
    const spend = deps.spend!;
    const spent: string[] = [];
    deps.spend = async (sb, tool, key, limit, win) => (spent.push(tool), spend(sb, tool, key, limit, win));
    deps.resendKey = undefined;
    await expect(resendInvitations(deps, OWNER, a.id, ORIGIN)).rejects.toMatchObject({ status: 503, message: UNAVAILABLE_MESSAGE });
    const tokens = await deps.store.listSignTokens(a.id);
    expect(tokens).toHaveLength(1);
    expect(tokens[0].revoked).toBe(false);
    expect((await getAgreement(deps.store, OWNER, a.id)).events).toEqual(before.events);
    expect(spent).toEqual([]);
  });

  it("skips signers still waiting (sequential), and refuses a Draft", async () => {
    const { deps, client, resend } = await setup();
    const draft = await madeDraft(deps, client.id);
    await expect(resendInvitations(deps, OWNER, draft.id, ORIGIN)).rejects.toMatchObject({
      status: 409,
      message: "This agreement is not awaiting signatures.",
    });
    const a = await madeDraft(deps, client.id, { recipients: 2 });
    await sent(deps, a, { sequential: true });
    const before = resend.calls.length;
    await resendInvitations(deps, OWNER, a.id, ORIGIN);
    expect(mails(resend).slice(before).map((m) => m.to[0])).toEqual([a.participants[0].email]);
  });
});

describe("cancelAgreement", () => {
  it("needs a reason, then cancels, revokes every link and tells each signer; a second cancel is 409", async () => {
    const { deps, client, resend } = await setup();
    const a = await madeDraft(deps, client.id, { recipients: 2 });
    await sent(deps, a);
    await expect(cancelAgreement(deps, OWNER, a.id, {})).rejects.toMatchObject({
      status: 400,
      message: "Give a cancellation reason.",
    });
    const out = await cancelAgreement(deps, OWNER, a.id, { reason: "Synthetic cancellation test" });
    expect(out.status).toBe("Cancelled");
    // The inline run appends "Email accepted by provider" for each notice after it.
    expect(out.events.find((e) => e.type === "Agreement cancelled")).toMatchObject({
      type: "Agreement cancelled",
      actor: OWNER.email,
      detail: { reason: "Synthetic cancellation test" },
    });
    expect((await deps.store.listSignTokens(a.id)).every((t) => t.revoked)).toBe(true);
    const notices = mails(resend).filter((m) => m.subject.startsWith("Cancelled: "));
    expect(notices.map((m) => m.to[0]).sort()).toEqual(a.participants.map((p) => p.email).sort());
    for (const m of notices) {
      expect(m.subject).toBe("Cancelled: " + a.title);
      expect(m.text).toBe("The sender cancelled this agreement. Reason: Synthetic cancellation test");
    }
    expect((await deps.store.listAgreementDeliveries(a.id)).filter((d) => d.purpose === "notice")).toHaveLength(2);
    await expect(cancelAgreement(deps, OWNER, a.id, { reason: "again" })).rejects.toMatchObject({
      status: 409,
      message: "Only an agreement awaiting signatures can be cancelled.",
    });
  });

  it("a failed notice email does not undo the cancellation", async () => {
    const { deps, client, resend } = await setup();
    const a = await madeDraft(deps, client.id);
    await sent(deps, a);
    resend.status = 500;
    const out = await cancelAgreement(deps, OWNER, a.id, { reason: "Changed terms" });
    expect(out.status).toBe("Cancelled");
    const notice = (await deps.store.listAgreementDeliveries(a.id)).find((d) => d.purpose === "notice")!;
    expect(notice.status).toBe("failed");
  });

  it("a cancel racing a send: Cancelled with every link revoked, or the cancel is 409 (Review Focus 2)", async () => {
    const { deps, client } = await setup();
    const a = await madeDraft(deps, client.id, { recipients: 2 });
    const [sendOut, cancelOut] = await Promise.allSettled([
      sendAgreement(deps, OWNER, a.id, body(a), ORIGIN),
      cancelAgreement(deps, OWNER, a.id, { reason: "Race" }),
    ]);
    expect(sendOut.status).toBe("fulfilled");
    const got = await getAgreement(deps.store, OWNER, a.id);
    if (cancelOut.status === "fulfilled") {
      expect(got.status).toBe("Cancelled");
      expect((await deps.store.listSignTokens(a.id)).every((t) => t.revoked)).toBe(true);
    } else {
      expect((cancelOut as PromiseRejectedResult).reason).toMatchObject({ status: 409 });
    }
  });

  it("a cancel that lands while invitations are going out leaves every link revoked", async () => {
    const { deps, client, store } = await setup();
    const a = await madeDraft(deps, client.id, { recipients: 2 });
    let cancelled: Promise<Agreement> | null = null;
    deps.store = {
      ...store,
      // The first invitation's token: the agreement is frozen, so the cancel finds it awaiting.
      insertSignToken: async (t) => {
        cancelled ??= cancelAgreement({ ...deps, store }, OWNER, a.id, { reason: "Race" });
        await cancelled;
        return store.insertSignToken(t);
      },
    };
    const out = await sendAgreement(deps, OWNER, a.id, body(a), ORIGIN);
    expect((await cancelled!).status).toBe("Cancelled");
    expect(out.status).toBe("Cancelled");
    const got = await getAgreement(store, OWNER, a.id);
    expect(got.status).toBe("Cancelled");
    const tokens = await store.listSignTokens(a.id);
    expect(tokens.length).toBeGreaterThan(0);
    expect(tokens.every((t) => t.revoked)).toBe(true);
  });

  it("a cancel landing between two invitations stops the second", async () => {
    const { deps, client, store, resend } = await setup();
    const a = await madeDraft(deps, client.id, { recipients: 2 });
    const [one, two] = a.participants;
    let cancelled = false;
    deps.store = {
      ...store,
      insertSignToken: async (t) => {
        const out = await store.insertSignToken(t);
        if (!cancelled) {
          cancelled = true;
          const row = (await store.getAgreement(t.workspaceId, t.agreementId))!;
          await store.updateAgreement(row.workspaceId, row.id, row.rowVersion, { status: "Cancelled" });
        }
        return out;
      },
    };
    const out = await sendAgreement(deps, OWNER, a.id, body(a), ORIGIN);
    expect(out.status).toBe("Cancelled");
    const tokens = await store.listSignTokens(a.id);
    expect(tokens.map((t) => t.participantId)).toEqual([one.id]);
    expect(tokens.every((t) => t.revoked)).toBe(true);
    expect(store.jobs().filter((j) => j.participantId === two.id)).toEqual([]);
    // The first invitation was queued before the cancel was seen; the runner suppresses it.
    expect(store.jobs().map((j) => j.status)).toEqual(["suppressed"]);
    expect(resend.calls).toHaveLength(0);
  });
});

describe("who may act", () => {
  it("a Member reaching another sender's agreement gets 404 on send, cancel and resend (Review Focus 4)", async () => {
    const { deps, client } = await setup();
    const a = await madeDraft(deps, client.id);
    const member = { id: "m1", email: "member@example.com", workspaceId: WS };
    const store = deps.store;
    const asMember = {
      ...deps,
      store: withMemberRole(store, member.id),
    };
    const notFound = { status: 404, message: "Agreement not found." };
    await expect(sendAgreement(asMember, member, a.id, body(a), ORIGIN)).rejects.toMatchObject(notFound);
    await sent(deps, a);
    await expect(cancelAgreement(asMember, member, a.id, { reason: "x" })).rejects.toMatchObject(notFound);
    await expect(resendInvitations(asMember, member, a.id, ORIGIN)).rejects.toMatchObject(notFound);
    expect((await getAgreement(store, OWNER, a.id)).status).toBe("Awaiting signatures");
  });
});

describe("sign-first belongs to the draft's sender", () => {
  it("the Owner sending a Member's sign-first draft is 409 before anything is frozen or spent", async () => {
    const { deps, client, resend } = await setup();
    const member = { id: "m1", email: "member@example.com", workspaceId: WS };
    const store = deps.store;
    const memberDeps = {
      ...deps,
      store: withMemberRole(store, member.id),
    };
    let a = await madeDraft(memberDeps, client.id, { recipients: 2, user: member });
    // The Owner is the first signer, so only the sender check stands in the way.
    const participants = a.participants.map((p, i) => (i === 0 ? { ...p, email: OWNER.email } : p));
    a = (await agreementAction(memberDeps.store, member, a.id, "save", { ...a, participants, senderFirst: true })) as Agreement;
    const spent: string[] = [];
    const spend = deps.spend!;
    deps.spend = async (sb, tool, key, limit, win) => (spent.push(tool), spend(sb, tool, key, limit, win));
    await expect(sendAgreement(deps, OWNER, a.id, body(a), ORIGIN)).rejects.toMatchObject({
      status: 409,
      message: "Only the person who created this draft can sign it first.",
    });
    const after = await getAgreement(store, OWNER, a.id);
    expect(after.status).toBe("Draft");
    expect(after.frozen).toBeUndefined();
    expect(after.revision).toBe(a.revision);
    expect(spent).toEqual([]);
    expect(await store.listSignTokens(a.id)).toEqual([]);
    expect(resend.calls).toHaveLength(0);
  });
});

describe("stableJson", () => {
  it("sorts object keys recursively, keeps array order, drops undefined like JSON, and has no whitespace", () => {
    expect(stableJson({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: "x" }, u: undefined })).toBe(
      '{"a":{"c":"x","d":[3,{"y":2,"z":1}]},"b":1}',
    );
    expect(stableJson({ b: 1, a: 2 })).toBe(stableJson({ a: 2, b: 1 }));
    expect(stableJson([2, 1])).toBe("[2,1]");
    expect(stableJson("a b")).toBe('"a b"');
    expect(stableJson(null)).toBe("null");
  });
});
