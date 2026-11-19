/**
 * Shared set-up for the agreement tests. Server-side fixtures: run them under
 * `// @vitest-environment node`.
 */
import { generateKeyPairSync, randomBytes, randomUUID } from "node:crypto";
import { agreementAction, agreementArtifactUrl, createAgreement, withEvent } from "../../../../api/_signroom/agreements";
import type { SignedInUser as User } from "../../../../api/_signroom/context";
import { prepareAgreement } from "../../../../api/_signroom/agreementDocument";
import { releaseFirst, sendAgreement, signFirst } from "../../../../api/_signroom/agreementSend";
import { clientFromCompany } from "../../../../api/_signroom/clients";
import type { EvidenceKey } from "../../../../api/_signroom/evidence";
import { MAIL_TOOL, type MailDeps } from "../../../../api/_signroom/mail";
import { acceptSignature } from "../../../../api/_signroom/signing";
import { CONSENT, type Agreement, type Client, type Field, type Participant } from "../../../../api/_signroom/shared/types";
import type { Store, StoredAgreement } from "../../../../api/_signroom/store";
import type { SpendResult } from "../../../../api/_signroom/host/rateLimit";
import { OWNER as HELPER_OWNER, seededStore, WS, type FakeStore } from "./helpers";

/** The workspace owner (an organisation admin working in WS) every fixture acts as unless told otherwise. */
export const OWNER: User = HELPER_OWNER;

/** The address the fake mail goes from. */
export const FROM = "documents@app.example.com";

export type Resend = { calls: { url: string; init: RequestInit }[]; status: number };

let evidenceKey: EvidenceKey | null = null;

/** One Ed25519 evidence key per test file, with key id taskcalendar-ed25519-v1. */
export function testEvidenceKey(): EvidenceKey {
  if (!evidenceKey) {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    evidenceKey = { keyId: "taskcalendar-ed25519-v1", privateKey, publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString() };
  }
  return evidenceKey;
}

const given = (opts: object, key: string) => Object.prototype.hasOwnProperty.call(opts, key);

/**
 * Mail deps over a fake store (WS seeded, OWNER an organisation admin) and a
 * fake Resend. Rate limits count in memory; the workspace's own email limit
 * always passes (it has its own tests in mail.test.ts). A Resend key, a from
 * address, a job key and the evidence key are set unless `opts` gives them
 * (undefined or null for none).
 */
export function mailSetup(
  opts: {
    resendKey?: string | undefined;
    from?: string | undefined;
    jobKey?: Buffer | null;
    evidenceKey?: EvidenceKey | null;
  } = {},
) {
  const store = seededStore(OWNER);
  const resend: Resend = { calls: [], status: 200 };
  const counts = new Map<string, number>();
  const deps: MailDeps = {
    store,
    sb: {} as never,
    fetch: (async (url: string, init: RequestInit) => {
      resend.calls.push({ url, init });
      return new Response("{}", { status: resend.status });
    }) as never,
    resendKey: given(opts, "resendKey") ? opts.resendKey : "re_test",
    from: given(opts, "from") ? opts.from : FROM,
    jobKey: given(opts, "jobKey") ? opts.jobKey : randomBytes(32),
    evidenceKey: given(opts, "evidenceKey") ? opts.evidenceKey : testEvidenceKey(),
    spend: async (_sb, tool, key, limit): Promise<SpendResult> => {
      if (tool === MAIL_TOOL) return { ok: true };
      const k = tool + key;
      const n = (counts.get(k) ?? 0) + 1;
      counts.set(k, n);
      return n <= limit ? { ok: true } : { ok: false, minutesLeft: 42 };
    },
    peek: async () => ({ ok: true }),
  };
  return { store, resend, deps };
}

/** SR tests/v2.integration.ts:115: two pages of synthetic text. */
export const SR_CONTENT =
  "DEMO CONTENT — NOT A REAL CONTRACT\n\n# Synthetic agreement\nThe parties test this local application only. No legal effect is intended.\n| Service | Fee |\n| Test | GBP 0 |\n---PAGE BREAK---\n# Second page\nSynthetic second page.";

/**
 * A client with an email address in the user's workspace, made the only way
 * there is: from a CRM company (seeded here with one contact).
 */
export async function newClient(store: Store, user: User = OWNER, name = "Bloom & Co."): Promise<Client> {
  const companyId = randomUUID();
  const fake = store as FakeStore;
  fake.seedCompany({ id: companyId, workspaceId: user.workspaceId ?? WS, name, email: "hello@bloom.co" });
  fake.seedContact({ companyId, firstName: "Bea", lastName: "Bloom", email: "bea@bloom.co" });
  return clientFromCompany(store, user, { companyId });
}

const save = (store: Store, user: User, a: Agreement, patch: Partial<Agreement>) =>
  agreementAction(store, user, a.id, "save", { ...a, ...patch }) as Promise<Agreement>;

/**
 * Port of SR v2.integration.ts make(): a prepared two-page draft with
 * `recipients` signers and a field of each kind (or a signature only) per signer
 * on page 2. `user` (an addition) picks who creates it; the default is OWNER.
 */
export async function madeDraft(
  deps: Pick<MailDeps, "store">,
  clientId: string,
  opts: { recipients?: number; allFields?: boolean; type?: string; user?: User } = {},
): Promise<Agreement> {
  const { store } = deps;
  const user = opts.user ?? OWNER;
  const type = opts.type ?? "NDA";
  const recipients = opts.recipients ?? 1;
  let a = await createAgreement(store, user, { clientId, type, title: "TEST " + type });
  a = await save(store, user, a, { content: SR_CONTENT });
  a = await prepareAgreement(store, user, a.id, { revision: a.revision });
  const participants = Array.from({ length: recipients }, (_, i) => ({
    id: randomUUID(),
    name: "Signer " + (i + 1),
    email: `signer-${i + 1}@example.test`,
    role: "signer" as const,
    order: i + 1,
    progress: "waiting" as const,
    version: 0,
  }));
  a = await save(store, user, a, { participants });
  const kinds = opts.allFields
    ? (["signature", "initials", "full_name", "company", "title", "date_signed", "text", "checkbox"] as const)
    : (["signature"] as const);
  const fields: Field[] = a.participants.flatMap((p, i) =>
    kinds.map((kind, j) => ({
      id: randomUUID(),
      participantId: p.id,
      kind,
      label: kind.replaceAll("_", " "),
      page: 2,
      x: 0.1 + (i % 2) * 0.45,
      y: 0.12 + j * 0.085,
      width: kind === "checkbox" ? 0.04 : 0.32,
      height: 0.04,
      required: true,
    })),
  );
  return save(store, user, a, { fields });
}

/** The origin invitation links are built on in tests. */
export const ORIGIN = "https://app.example.com";

/**
 * Port of SR v2.integration.ts send() (159–166): optionally saved as sequential,
 * then sent with eligibility confirmed and the key "send-<id>". `user` (an
 * addition, as in madeDraft) picks who sends it; the default is OWNER.
 */
export async function sent(deps: MailDeps, a: Agreement, opts: { sequential?: boolean; user?: User } = {}): Promise<Agreement> {
  const user = opts.user ?? OWNER;
  if (opts.sequential) a = await save(deps.store, user, a, { sequential: true });
  return sendAgreement(deps, user, a.id, { revision: a.revision, eligible: true, idempotencyKey: "send-" + a.id }, ORIGIN);
}

/**
 * The bytes behind an artifact link: the fake store's signed URL ends in
 * /<workspaceId>/<hash>, which this reads back from the store.
 */
export async function artifactBytes(store: Store, user: User, id: string, kind = "source"): Promise<Uint8Array> {
  const { url } = await agreementArtifactUrl(store, user, id, kind);
  const [workspaceId, hash] = new URL(url).pathname.split("/").slice(-2);
  return store.getBlob(workspaceId, hash);
}

/**
 * A sent agreement ready to finish (SR guest.ts "sign" 289–304): `signers`
 * signers (default 1) and `copies` copy recipients (default 0); every signer
 * signed through acceptSignature, then one write to Finalising with the final
 * snapshot, and a queued finalise:<id> job (not run). With `senderFirst` the
 * owner is signer 1 and signs first through signFirst, then releases.
 */
export async function finalising(
  d: MailDeps,
  clientId: string,
  opts: { signers?: number; copies?: number; senderFirst?: boolean } = {},
): Promise<StoredAgreement> {
  const signers = opts.signers ?? 1;
  let a = await madeDraft(d, clientId, { recipients: signers });
  const copies: Participant[] = Array.from({ length: opts.copies ?? 0 }, (_, i) => ({
    id: randomUUID(),
    name: "Copy " + (i + 1),
    email: `copy-${i + 1}@example.test`,
    role: "copy",
    order: signers + i + 1,
    progress: "waiting",
    version: 0,
  }));
  const people = opts.senderFirst
    ? [{ ...a.participants[0], name: "Synthetic Owner", email: OWNER.email }, ...a.participants.slice(1)]
    : a.participants;
  a = await save(d.store, OWNER, a, { participants: [...people, ...copies], ...(opts.senderFirst ? { senderFirst: true } : {}) });
  a = await sent(d, a);
  if (opts.senderFirst) {
    a = await signFirst(d, OWNER, a.id, {
      consent: true,
      consentVersion: CONSENT.version,
      sourceHash: a.frozen!.sourceHash,
      signature: "Synthetic Owner",
      values: {},
    });
    a = await releaseFirst(d, OWNER, a.id, ORIGIN);
  }
  const row = (await d.store.getAgreement(a.workspaceId, a.id))!;
  const at = new Date().toISOString();
  let next: StoredAgreement = row;
  for (const p of row.participants.filter((p) => p.role === "signer" && p.progress !== "signed")) {
    const { participant, detail } = acceptSignature(
      next,
      p.id,
      {
        consent: true,
        consentVersion: CONSENT.version,
        sourceHash: row.senderSignedHash || row.frozen!.sourceHash,
        signature: "Synthetic " + p.name,
        values: {},
      },
      at,
    );
    next = withEvent({ ...next, participants: next.participants.map((x) => (x.id === p.id ? participant : x)) }, "Signature accepted", p.email, detail);
  }
  next = withEvent(next, "All signers finished; finalisation queued", "system");
  await d.store.revokeSignTokens(row.id);
  const out = await d.store.updateAgreement(row.workspaceId, row.id, row.rowVersion, {
    participants: next.participants,
    status: "Finalising",
    senderReleasePending: false,
    events: next.events,
    finalSnapshot: structuredClone(next.events),
  });
  if (!out) throw new Error("finalising: the row changed");
  await d.store.insertJob({
    workspaceId: row.workspaceId,
    agreementId: row.id,
    kind: "finalise",
    purpose: "finalise",
    dedupe: "finalise:" + row.id,
    payload: "",
  });
  return out;
}
