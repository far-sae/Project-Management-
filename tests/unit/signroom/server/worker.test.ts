// @vitest-environment node
import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cancelAgreement } from "../../../../api/_signroom/agreementSend";
import { currentWorkspace } from "../../../../api/_signroom/context";
import {
  decryptPayload,
  encryptPayload,
  FAILED_JOB_MESSAGE,
  HELD_DELIVERY_MESSAGE,
  HELD_MESSAGE,
  queueMail,
  readJobKey,
} from "../../../../api/_signroom/jobs";
import { runJobs } from "../../../../api/_signroom/worker";
import type { SpendResult } from "../../../../api/_signroom/host/rateLimit";
import { madeDraft, mailSetup, newClient, OWNER, sent } from "./agreementFixtures";

const TO = "signer-1@example.test";
const LINK = "https://app.example.com/sign#access=RAW-LINK-SECRET";
const TEXT = "Please review and sign this agreement.\n" + LINK;

let logged: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  logged.mockRestore();
  vi.useRealTimers();
});

/** A sent one-signer agreement, its live invitation token, and mail deps (the fixture sets the job key). */
async function setup() {
  const m = mailSetup();
  const ws = (await currentWorkspace(m.store, OWNER)).workspace;
  const client = await newClient(m.store);
  const a = await sent(m.deps, await madeDraft(m.deps, client.id));
  m.resend.calls.length = 0;
  const token = (await m.store.listSignTokens(a.id)).find((t) => !t.revoked)!;
  const p = a.participants[0];
  const queue = (extra: Partial<Parameters<typeof queueMail>[1]> = {}) =>
    queueMail(m.deps, {
      workspaceId: ws.id,
      agreementId: a.id,
      participantId: p.id,
      tokenId: token.id,
      to: TO,
      subject: "Please sign: " + a.title,
      text: TEXT,
      purpose: "invite",
      dedupe: `invite:${a.id}:${p.id}:${token.id}`,
      ...extra,
    });
  return { ...m, ws, a, p, token, queue };
}

const job = async (t: Awaited<ReturnType<typeof setup>>, id: string) => (await t.store.getJob(id))!;
/** The jobs this file queues (the send's own invitation job is left out). */
const queued = (t: Awaited<ReturnType<typeof setup>>) => t.store.jobs().filter((j) => !j.dedupe.startsWith("sign:"));
/** The participant's delivery rows, oldest first. */
const rows = async (t: Awaited<ReturnType<typeof setup>>) => (await t.store.listAgreementDeliveries(t.a.id)).filter((d) => d.participantId === t.p.id);
const lastEvent = async (t: Awaited<ReturnType<typeof setup>>) => (await t.store.getAgreement(t.ws.id, t.a.id))!.events.at(-1)!;
/** The minute limit refuses every send. */
const minuteRefuses = (t: Awaited<ReturnType<typeof setup>>) => {
  t.deps.spend = async (): Promise<SpendResult> => ({ ok: false, minutesLeft: 1 });
};

describe("job payloads", () => {
  it("round-trips through AES-256-GCM", () => {
    const k = randomBytes(32);
    expect(decryptPayload(k, encryptPayload(k, { a: 1 }))).toEqual({ a: 1 });
  });

  it("throws when one character of the ciphertext changes", () => {
    const k = randomBytes(32);
    const data = encryptPayload(k, { a: 1, b: "some longer value to encrypt" });
    const i = data.length - 6;
    const flipped = data.slice(0, i) + (data[i] === "A" ? "B" : "A") + data.slice(i + 1);
    expect(() => decryptPayload(k, flipped)).toThrow();
  });

  it("reads a key only when it is exactly 32 bytes", () => {
    expect(readJobKey(Buffer.alloc(31).toString("base64"))).toBeNull();
    expect(readJobKey(undefined)).toBeNull();
    expect(readJobKey("")).toBeNull();
    expect(readJobKey(Buffer.alloc(32, 7).toString("base64"))).toEqual(Buffer.alloc(32, 7));
  });
});

describe("queueMail", () => {
  it("stores a payload with neither the address nor the text (SR: delivery jobs do not retain plaintext payload copies)", async () => {
    const t = await setup();
    const j = await t.queue();
    const stored = t.store.jobs().find((x) => x.id === j.id)!;
    expect(stored).toMatchObject({ kind: "mail", purpose: "invite", status: "queued", agreementId: t.a.id, participantId: t.p.id });
    expect(stored.payload).not.toContain(TO);
    expect(stored.payload).not.toContain("signer-1");
    expect(stored.payload).not.toContain("RAW-LINK-SECRET");
    expect(stored.payload).not.toContain("Please review");
    expect(decryptPayload(t.deps.jobKey!, stored.payload)).toEqual({ to: TO, subject: "Please sign: " + t.a.title, text: TEXT, tokenId: t.token.id });
  });

  it("queues the same dedupe once", async () => {
    const t = await setup();
    const first = await t.queue();
    const second = await t.queue();
    expect(second.id).toBe(first.id);
    expect(queued(t)).toHaveLength(1);
  });

  it("refuses with the 503 sentence when there is no job key", async () => {
    const t = await setup();
    t.deps.jobKey = null;
    await expect(t.queue()).rejects.toMatchObject({ status: 503, message: "This tool is busy right now. Please try again in a minute." });
    expect(queued(t)).toHaveLength(0);
  });
});

describe("runJobs, mail", () => {
  it("sends once, empties the payload and records the provider's acceptance", async () => {
    const t = await setup();
    const j = await t.queue();
    expect(await runJobs(t.deps, { ids: [j.id] })).toEqual({ processed: 1 });
    expect(t.resend.calls).toHaveLength(1);
    expect(await job(t, j.id)).toMatchObject({ status: "done", payload: "", manualReview: false });
    await runJobs(t.deps, { ids: [j.id] });
    await runJobs(t.deps);
    expect(t.resend.calls).toHaveLength(1);
    expect(await lastEvent(t)).toMatchObject({
      type: "Email accepted by provider",
      actor: "system",
      detail: { purpose: "invite", recipientId: t.p.id, route: "securovix" },
    });
  });

  it("suppresses an invitation for a cancelled agreement", async () => {
    const t = await setup();
    await cancelAgreement(t.deps, OWNER, t.a.id, { reason: "Changed plans" });
    t.resend.calls.length = 0;
    const j = await t.queue({ tokenId: undefined, dedupe: "invite-after-cancel" });
    await runJobs(t.deps, { ids: [j.id] });
    expect(await job(t, j.id)).toMatchObject({ status: "suppressed", payload: "" });
    expect(t.resend.calls).toHaveLength(0);
  });

  it("still sends a notice for a cancelled agreement", async () => {
    const t = await setup();
    await cancelAgreement(t.deps, OWNER, t.a.id, { reason: "Changed plans" });
    t.resend.calls.length = 0;
    const j = await t.queue({ tokenId: undefined, purpose: "notice", dedupe: "notice-after-cancel" });
    await runJobs(t.deps, { ids: [j.id] });
    expect(await job(t, j.id)).toMatchObject({ status: "done" });
    expect(t.resend.calls).toHaveLength(1);
  });

  it("suppresses a mail whose token was revoked", async () => {
    const t = await setup();
    const j = await t.queue();
    await t.store.revokeSignTokens(t.a.id);
    await runJobs(t.deps, { ids: [j.id] });
    expect(await job(t, j.id)).toMatchObject({ status: "suppressed", payload: "" });
    expect(t.resend.calls).toHaveLength(0);
  });

  it("puts a refusal before sending back in the queue a minute later", async () => {
    const t = await setup();
    minuteRefuses(t);
    const j = await t.queue();
    const before = Date.now();
    await runJobs(t.deps, { ids: [j.id] });
    const after = await job(t, j.id);
    expect(after).toMatchObject({ status: "queued", attempts: 1, manualReview: false });
    expect(after.available).toBeGreaterThanOrEqual(before + 60_000);
    expect(after.available).toBeLessThanOrEqual(Date.now() + 60_000);
    expect(t.resend.calls).toHaveLength(0);
    expect(await lastEvent(t)).toMatchObject({ type: "Background processing delayed", actor: "system", detail: { jobId: j.id, kind: "mail", attempt: 1 } });
  });

  it("fails a refused mail on its fifth attempt (SR: delivery failure reaches reviewable failed queue)", async () => {
    const t = await setup();
    minuteRefuses(t);
    const j = await t.queue();
    for (let n = 0; n < 4; n++) await t.store.claimJobs(1, -1, [j.id]);
    expect((await job(t, j.id)).attempts).toBe(4);
    await runJobs(t.deps, { ids: [j.id] });
    expect(await job(t, j.id)).toMatchObject({ status: "failed", attempts: 5, error: FAILED_JOB_MESSAGE, manualReview: false });
    expect(t.resend.calls).toHaveLength(0);
  });

  it("a job already past its fifth attempt (requeued by maintenance) fails again with a log line but no new event", async () => {
    const t = await setup();
    minuteRefuses(t);
    const j = await t.queue();
    for (let n = 0; n < 6; n++) await t.store.claimJobs(1, -1, [j.id]);
    await t.store.updateJob(j.id, { status: "queued" });
    const before = (await t.store.getAgreement(t.ws.id, t.a.id))!.events.length;
    await runJobs(t.deps, { ids: [j.id] });
    expect(await job(t, j.id)).toMatchObject({ status: "failed", attempts: 7, error: FAILED_JOB_MESSAGE });
    expect((await t.store.getAgreement(t.ws.id, t.a.id))!.events).toHaveLength(before);
    expect(logged).toHaveBeenCalledWith("[signroom] job failed", "mail", 429);
  });

  it("holds a mail whose send failed after it started, and never sends it again", async () => {
    const t = await setup();
    t.resend.status = 500;
    const j = await t.queue();
    await runJobs(t.deps, { ids: [j.id] });
    expect(t.resend.calls).toHaveLength(1);
    expect(await job(t, j.id)).toMatchObject({ status: "failed", manualReview: true, error: HELD_MESSAGE });
    expect(await lastEvent(t)).toMatchObject({ type: "Background processing delayed", detail: { jobId: j.id, kind: "mail", attempt: 1 } });
    // The sender sees "Delivery: failed" with the held sentence, which names no address or link.
    const last = (await rows(t)).at(-1)!;
    expect(last).toMatchObject({ status: "failed", error: HELD_DELIVERY_MESSAGE, jobId: j.id, purpose: "invite" });
    expect(HELD_DELIVERY_MESSAGE).toBe("Held for review: this email may already have been delivered. Check with the recipient before resending.");
    t.resend.status = 200;
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 400_000);
    await runJobs(t.deps, { ids: [j.id] });
    await runJobs(t.deps);
    expect(t.resend.calls).toHaveLength(1);
  });

  it("holds a working job whose lease expired after a live attempt, without sending", async () => {
    const t = await setup();
    const j = await t.queue();
    await t.store.claimJobs(1, -1, [j.id]);
    expect(await t.store.markLiveAttempt(j.id)).toBe(true);
    const before = (await rows(t)).length;
    await runJobs(t.deps, { ids: [j.id] });
    expect(await job(t, j.id)).toMatchObject({ status: "failed", manualReview: true, error: HELD_MESSAGE });
    expect(t.resend.calls).toHaveLength(0);
    // The run died before its delivery row was written: a failed row is recorded so the sender can resend.
    const after = await rows(t);
    expect(after).toHaveLength(before + 1);
    expect(after.at(-1)).toMatchObject({ status: "failed", error: HELD_DELIVERY_MESSAGE, jobId: j.id, purpose: "invite", recipient: TO });
  });

  it("a run that died mid-send, then suppressed, still leaves its delivery row failed", async () => {
    const t = await setup();
    const j = await t.queue();
    await t.store.claimJobs(1, -1, [j.id]);
    expect(await t.store.markLiveAttempt(j.id)).toBe(true);
    const sending = await t.store.insertDelivery({
      workspaceId: t.ws.id,
      agreementId: t.a.id,
      participantId: t.p.id,
      recipient: TO,
      subject: "Please sign: " + t.a.title,
      purpose: "invite",
      route: "securovix",
      status: "sending",
      jobId: j.id,
    });
    const row = (await t.store.getAgreement(t.ws.id, t.a.id))!;
    expect(await t.store.updateAgreement(t.ws.id, t.a.id, row.rowVersion, { status: "Declined" })).not.toBeNull();
    const before = (await rows(t)).length;
    await runJobs(t.deps, { ids: [j.id] });
    expect(await job(t, j.id)).toMatchObject({ status: "suppressed", payload: "" });
    const after = await rows(t);
    expect(after).toHaveLength(before);
    expect(after.find((d) => d.id === sending.id)).toMatchObject({ status: "failed", error: HELD_DELIVERY_MESSAGE });
    expect(t.resend.calls).toHaveLength(0);
  });

  it("a suppressed job with no live attempt leaves the delivery rows alone", async () => {
    const t = await setup();
    const j = await t.queue();
    const before = await rows(t);
    await t.store.revokeSignTokens(t.a.id);
    await runJobs(t.deps, { ids: [j.id] });
    expect(await job(t, j.id)).toMatchObject({ status: "suppressed" });
    expect(await rows(t)).toEqual(before);
  });

  it("a run that died mid-send leaves its delivery row failed, not sending", async () => {
    const t = await setup();
    const j = await t.queue();
    await t.store.claimJobs(1, -1, [j.id]);
    expect(await t.store.markLiveAttempt(j.id)).toBe(true);
    const sending = await t.store.insertDelivery({
      workspaceId: t.ws.id,
      agreementId: t.a.id,
      participantId: t.p.id,
      recipient: TO,
      subject: "Please sign: " + t.a.title,
      purpose: "invite",
      route: "securovix",
      status: "sending",
      jobId: j.id,
    });
    const before = (await rows(t)).length;
    await runJobs(t.deps, { ids: [j.id] });
    const after = await rows(t);
    expect(after).toHaveLength(before);
    expect(after.find((d) => d.id === sending.id)).toMatchObject({ status: "failed", error: HELD_DELIVERY_MESSAGE });
    expect(t.resend.calls).toHaveLength(0);
  });

  it("sends a job whose lease went stale before any live attempt, once (SR: restart reclaims a stale worker lease)", async () => {
    const t = await setup();
    const j = await t.queue();
    await t.store.claimJobs(1, -1, [j.id]);
    await runJobs(t.deps, { ids: [j.id] });
    await runJobs(t.deps, { ids: [j.id] });
    expect(await job(t, j.id)).toMatchObject({ status: "done", payload: "" });
    expect(t.resend.calls).toHaveLength(1);
  });

  it("an inline run takes only its own ids", async () => {
    const t = await setup();
    const a = await t.queue();
    const b = await t.queue({ dedupe: "second" });
    await runJobs(t.deps, { ids: [a.id] });
    expect(await job(t, a.id)).toMatchObject({ status: "done" });
    expect(await job(t, b.id)).toMatchObject({ status: "queued", attempts: 0 });
    expect(t.resend.calls).toHaveLength(1);
  });

  it("a run stops at its limit", async () => {
    const t = await setup();
    await t.queue();
    await t.queue({ dedupe: "second" });
    expect(await runJobs(t.deps, { limit: 1 })).toEqual({ processed: 1 });
    expect(t.store.jobs().filter((j) => j.status === "queued")).toHaveLength(1);
  });

  it("a payload that does not decrypt is a processing error, retried later", async () => {
    const t = await setup();
    const j = await t.queue();
    t.deps.jobKey = randomBytes(32);
    await runJobs(t.deps, { ids: [j.id] });
    expect(await job(t, j.id)).toMatchObject({ status: "queued", attempts: 1 });
    expect(t.resend.calls).toHaveLength(0);
  });

  it("a mail whose payload was emptied (its agreement deleted) is suppressed, not retried", async () => {
    const t = await setup();
    const j = await t.store.insertJob({ workspaceId: t.ws.id, agreementId: "gone", kind: "mail", purpose: "notice", dedupe: "emptied", payload: "" });
    await runJobs(t.deps, { ids: [j.id] });
    expect(await job(t, j.id)).toMatchObject({ status: "suppressed", attempts: 1 });
    expect(t.resend.calls).toHaveLength(0);
    expect(logged).not.toHaveBeenCalled();
  });

  it("never logs the address or the link", async () => {
    const t = await setup();
    minuteRefuses(t);
    await runJobs(t.deps, { ids: [(await t.queue()).id] });
    t.deps.spend = async (): Promise<SpendResult> => ({ ok: true });
    t.resend.status = 500;
    await runJobs(t.deps, { ids: [(await t.queue({ dedupe: "second" })).id] });
    const third = await t.queue({ dedupe: "third" });
    t.deps.jobKey = randomBytes(32);
    await runJobs(t.deps, { ids: [third.id] });
    expect(logged).toHaveBeenCalled();
    const text = JSON.stringify(logged.mock.calls);
    expect(text).not.toContain("signer-1");
    expect(text).not.toContain("RAW-LINK-SECRET");
    expect(text).not.toContain("access=");
  });
});
