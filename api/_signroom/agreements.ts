import { randomUUID } from "node:crypto";
import { AppError } from "./errors.js";
import { currentWorkspace, type SignedInUser } from "./context.js";
import { dealOf, listFilter } from "./crmLinks.js";
import type { AgreementPatch, Store, StoredAgreement } from "./store.js";
import {
  FIELD_TYPES,
  TYPES,
  type Agreement,
  type AgreementSummary,
  type AgreementTemplate,
  type AgreementTemplateSummary,
  type Delivery,
  type EvidenceEvent,
  type Field,
  type Participant,
  type Workspace,
} from "./shared/types.js";
import { isUuid, text } from "./validate.js";

export type Ctx = { workspace: Workspace; role: "Owner" | "Member"; user: SignedInUser };
type Body = Record<string, unknown>;

export const NOT_FOUND = "Agreement not found.";
export const TRASHED = "Restore this document from Trash before changing it.";
const CONFLICT = "This agreement changed in another tab. Reload it and try again.";
/** At most this many drafts outside the Trash per workspace (SR createAgreement). */
const DRAFT_LIMIT = 100;

const now = () => new Date().toISOString();
const arr = (value: unknown): Record<string, unknown>[] => (Array.isArray(value) ? value : []);

/**
 * SR security.ts evidence(), without mutating: a copy with the next event appended.
 * Takes anything with events, so a row not yet inserted can carry its first one.
 */
export function withEvent<T extends Pick<Agreement, "events">>(a: T, type: string, actor: string, detail: Record<string, unknown> = {}): T {
  const event: EvidenceEvent = { seq: (a.events.at(-1)?.seq || 0) + 1, type, actor, at: now(), detail };
  return { ...a, events: [...a.events, event] };
}

/** One compare-and-set write. A lost race is a 409 with `conflict`. */
export async function writeAgreement(
  store: Store,
  a: StoredAgreement,
  patch: AgreementPatch,
  conflict = CONFLICT,
): Promise<StoredAgreement> {
  const out = await store.updateAgreement(a.workspaceId, a.id, a.rowVersion, patch);
  if (!out) throw new AppError(conflict, 409);
  return out;
}

/** SR security.ts expired(): an agreement past its deadline becomes Expired, and its links stop working. */
export async function expireIfDue(store: Store, a: StoredAgreement): Promise<StoredAgreement> {
  if (a.status !== "Awaiting signatures" || !a.deadline || Date.now() <= new Date(a.deadline + "T23:59:59.999Z").getTime()) return a;
  const out = await store.updateAgreement(a.workspaceId, a.id, a.rowVersion, {
    status: "Expired",
    events: withEvent(a, "Agreement expired", "system").events,
  });
  // Another request moved the row first (perhaps expiring it too): show what it left.
  if (!out) return (await store.getAgreement(a.workspaceId, a.id)) ?? a;
  await store.revokeSignTokens(a.id);
  return out;
}

/**
 * SR security.ts agreement() plus the route's Trash guard: the agreement if the
 * user sent it or owns the workspace (otherwise 404), expired if its deadline has
 * passed. Every action but get, artifact, restore, trash and delete is refused
 * on a trashed agreement (SR route.ts 483–493).
 */
export async function openAgreement(store: Store, user: SignedInUser, id: string, action: string): Promise<{ ctx: Ctx; a: StoredAgreement }> {
  const ctx = await currentWorkspace(store, user);
  const found = isUuid(id) ? await store.getAgreement(ctx.workspace.id, id) : null;
  if (!found || (found.senderId !== user.id && ctx.role !== "Owner")) throw new AppError(NOT_FOUND, 404);
  const a = await expireIfDue(store, found);
  if (!["get", "artifact", "restore", "trash", "delete"].includes(action) && a.trashedAt) throw new AppError(TRASHED, 409);
  return { ctx, a };
}

/**
 * The emails whose outcome is a participant's "Delivery:" line: the link
 * emails. The code email (otp) and notices are left out, so a failed code
 * email never prompts a Resend that would kill the live link, and a sent one
 * never masks a held invitation.
 */
const LINK_PURPOSES = ["invite", "reminder", "completion"];

/**
 * The agreement as the browser sees it: no row version and, when deliveries are
 * given (oldest first), each participant's latest link email (LINK_PURPOSES). A
 * retried or held email writes several rows; the screen shows the last state
 * only. On equal times the later row in the given order wins.
 */
export function publicAgreement(a: StoredAgreement, deliveries?: Delivery[]): Agreement {
  const { rowVersion: _rv, ...rest } = a;
  if (!deliveries) return rest;
  const latest = new Map<string, Delivery>();
  const ordered = deliveries
    .filter((d) => d.agreementId === a.id && LINK_PURPOSES.includes(d.purpose))
    .sort((x, y) => Date.parse(x.created) - Date.parse(y.created));
  for (const d of ordered) {
    const key = d.participantId ?? "row:" + d.id;
    latest.delete(key);
    latest.set(key, d);
  }
  return {
    ...rest,
    deliveries: [...latest.values()].map((d) => ({
      id: d.id,
      ...(d.participantId ? { participantId: d.participantId } : {}),
      state: d.status,
      at: d.created,
    })),
  };
}

/** SR service.ts parseParticipants: known ids are kept, order follows the list, progress starts again. */
export function parseParticipants(value: unknown, a: Pick<Agreement, "participants">): Participant[] {
  const incoming = arr(value);
  if (incoming.length > 12) throw new AppError("Use at most 12 recipients.");
  return incoming.map((p, i) => ({
    id: a.participants.find((x) => x.id === p.id)?.id || randomUUID(),
    name: text(p.name, 150),
    email: text(p.email, 254).toLowerCase(),
    role: p.role === "copy" ? "copy" : "signer",
    order: i + 1,
    progress: "waiting",
    version: 0,
  }));
}

/** SR service.ts parseFields: each field on a real page, inside it, and belonging to a signer. */
export function parseFields(value: unknown, participants: Participant[], pages: Agreement["pages"]): Field[] {
  const fields = arr(value);
  if (fields.length > 250) throw new AppError("Use at most 250 fields.");
  return fields.map((f) => {
    const x = Number(f.x),
      y = Number(f.y),
      width = Number(f.width),
      height = Number(f.height),
      page = Number(f.page);
    if (
      !FIELD_TYPES.includes(f.kind as Field["kind"]) ||
      !participants.some((p) => p.id === f.participantId && p.role === "signer") ||
      !Number.isInteger(page) ||
      !pages[page - 1] ||
      ![x, y, width, height].every(Number.isFinite) ||
      x < 0 ||
      y < 0 ||
      width < 0.015 ||
      height < 0.01 ||
      x + width > 1.00001 ||
      y + height > 1.00001
    )
      throw new AppError("A field has invalid placement or recipient.");
    return {
      id: typeof f.id === "string" && f.id.length < 100 ? f.id : randomUUID(),
      participantId: String(f.participantId),
      kind: f.kind as Field["kind"],
      label: text(f.label, 100) || String(f.kind).replace(/_/g, " "),
      page,
      x,
      y,
      width,
      height,
      required: f.required !== false,
    };
  });
}

/**
 * Summaries (Ruling A7): Members see only their own; no signatures, drawings
 * or values. `query` narrows the list to a CRM company's and/or a deal's.
 */
export async function listAgreements(store: Store, user: SignedInUser, query: { companyId?: string; dealId?: string } = {}): Promise<AgreementSummary[]> {
  const ctx = await currentWorkspace(store, user);
  const filter = await listFilter(store, ctx.workspace.id, query);
  if (!filter) return [];
  const rows = await store.listAgreements(ctx.workspace.id, ctx.role === "Owner" ? null : user.id, filter);
  return rows.map((a) => ({
    ...a,
    participants: a.participants.map(({ signature: _s, drawing: _d, values: _v, ...p }) => p),
  }));
}

/**
 * Port of SR service.ts createAgreement: a draft for one client, optionally
 * from a template. It may name the CRM deal it is for (`dealId`, a deal of this
 * workspace), which then never changes.
 */
export async function createAgreement(store: Store, user: SignedInUser, b: Body): Promise<Agreement> {
  const ctx = await currentWorkspace(store, user);
  const c = isUuid(b.clientId) ? await store.getClient(ctx.workspace.id, b.clientId) : null;
  if (!c || c.archived) throw new AppError("Create or choose a client first.");
  if ((await store.countDrafts(ctx.workspace.id)) >= DRAFT_LIMIT) throw new AppError("Workspace draft limit reached.");
  const dealId = await dealOf(store, ctx.workspace.id, b.dealId);
  const type = TYPES.includes(b.type as (typeof TYPES)[number]) ? String(b.type) : "Other agreement";
  let a: Omit<Agreement, "id" | "created" | "updated" | "deliveries"> = {
    workspaceId: ctx.workspace.id,
    senderId: user.id,
    clientId: c.id,
    dealId,
    type,
    title: text(b.title, 150) || `${type} — ${c.name}`,
    status: "Draft",
    revision: 1,
    content: "",
    sourceKind: "authored",
    pages: [],
    participants: c.email
      ? [{ id: randomUUID(), name: c.contactName || c.name, email: c.email, role: "signer", order: 1, progress: "waiting", version: 0 }]
      : [],
    fields: [],
    sequential: false,
    deadline: "",
    reminderDays: 3,
    subject: "",
    message: "",
    events: [],
    legalHold: false,
  };
  if (b.templateId) {
    const t = isUuid(b.templateId) ? await store.getAgreementTemplate(ctx.workspace.id, b.templateId) : null;
    if (!t) throw new AppError("Template not found.", 404);
    const participants: Participant[] = t.roles.map((_role, i) => ({
      id: randomUUID(),
      name: i === 0 ? c.contactName || c.name : "",
      email: i === 0 ? c.email : "",
      role: "signer",
      order: i + 1,
      progress: "waiting",
      version: 0,
    }));
    a = {
      ...a,
      templateVersionId: t.id,
      ...(t.branding ? { branding: t.branding } : {}),
      ...(t.documentHash ? { documentHash: t.documentHash } : {}),
      pages: t.pages || [],
      sourceKind: t.sourceKind || "authored",
      content: t.content.split("{{client_name}}").join(c.name),
      participants,
      fields: t.fields.map(({ roleIndex, ...f }) => ({
        ...f,
        id: randomUUID(),
        participantId: participants[roleIndex]?.id || participants[0].id,
      })),
    };
  }
  return publicAgreement(await store.insertAgreement(withEvent(a, "Draft created", user.email, { clientId: c.id, type })));
}

/** One agreement with its deliveries (Ruling A7: the editor opens this, not the list item). */
export async function getAgreement(store: Store, user: SignedInUser, id: string): Promise<Agreement> {
  const { a } = await openAgreement(store, user, id, "get");
  return publicAgreement(a, await store.listAgreementDeliveries(a.id));
}

export type AgreementAction = "save" | "archive" | "unarchive" | "trash" | "restore" | "duplicate" | "template" | "hold";

/** Port of SR service.ts agreementAction for drafts and housekeeping. */
export async function agreementAction(
  store: Store,
  user: SignedInUser,
  id: string,
  action: AgreementAction,
  b: Body,
): Promise<Agreement | AgreementTemplate> {
  const { a } = await openAgreement(store, user, id, action);
  const actor = user.email;

  if (action === "archive" || action === "unarchive" || action === "trash" || action === "restore") {
    if (action === "trash") {
      if (a.legalHold) throw new AppError("This document is on legal hold and cannot be moved to Trash.", 409);
      if (["Awaiting signatures", "Finalising"].includes(a.status))
        throw new AppError("Cancel or complete the signing process before moving this document to Trash.", 409);
      if (a.trashedAt) return publicAgreement(a);
      return publicAgreement(
        await writeAgreement(store, a, { trashedAt: now(), events: withEvent(a, "Document moved to recoverable Trash", actor).events }),
      );
    }
    if (action === "restore") {
      if (!a.trashedAt) return publicAgreement(a);
      return publicAgreement(await writeAgreement(store, a, { trashedAt: "", events: withEvent(a, "Document restored from Trash", actor).events }));
    }
    const archived = action === "archive";
    if (!!a.archivedAt === archived) return publicAgreement(a);
    return publicAgreement(
      await writeAgreement(store, a, {
        archivedAt: archived ? now() : "",
        events: withEvent(a, archived ? "Document archived" : "Document unarchived", actor).events,
      }),
    );
  }

  if (action === "save") {
    const stale = "This draft changed in another tab. Reload it before saving.";
    if (a.status !== "Draft") throw new AppError("This agreement is frozen. Duplicate it to change terms.", 409);
    if (Number(b.revision) !== a.revision) throw new AppError(stale, 409);
    const title = text(b.title, 150) || a.title,
      content = String(b.content ?? a.content);
    if (content.length > 200000) throw new AppError("The document is too long.");
    const participants = b.participants ? parseParticipants(b.participants, a) : a.participants;
    const fields = b.fields
      ? parseFields(b.fields, participants, a.pages)
      : a.fields.filter((f) => participants.some((p) => p.id === f.participantId));
    const deadline = text(b.deadline, 10);
    if (deadline && !/^\d{4}-\d{2}-\d{2}$/.test(deadline)) throw new AppError("Choose a valid deadline.");
    if (content !== a.content && a.fields.length && !b.clearFields)
      throw new AppError("Changing document text clears field placements. Confirm this before saving.", 409);
    const documentChanged = content !== a.content;
    const patch: AgreementPatch = {
      title,
      content,
      participants,
      fields: documentChanged ? [] : fields,
      senderFirst: !!b.senderFirst,
      sequential: !!b.senderFirst || !!b.sequential,
      deadline,
      reminderDays: Math.min(30, Math.max(0, Number(b.reminderDays) || 0)),
      subject: text(b.subject, 150),
      message: text(b.message, 2000),
      revision: a.revision + 1,
      ...(documentChanged ? { documentHash: "", pages: [] } : {}),
    };
    return publicAgreement(await writeAgreement(store, a, patch, stale));
  }

  if (action === "duplicate") {
    const mapping = new Map<string, string>();
    const participants: Participant[] = a.participants.map((p) => {
      const pid = randomUUID();
      mapping.set(p.id, pid);
      return { id: pid, name: p.name, email: p.email, role: p.role, order: p.order, progress: "waiting", version: 0 };
    });
    const {
      id: _id,
      rowVersion: _rv,
      created: _c,
      updated: _u,
      deliveries: _dl,
      sentAt: _sa,
      completedAt: _ca,
      sendKey: _sk,
      senderSignedHash: _ssh,
      archivedAt: _aa,
      trashedAt: _ta,
      frozen: _fr,
      artifacts: _ar,
      finalSnapshot: _fs,
      deletionAt: _da,
      exportedAt: _ea,
      ...kept
    } = structuredClone(a);
    const copy = withEvent(
      {
        ...kept,
        title: a.title + " (copy)",
        senderId: user.id,
        status: "Draft" as const,
        revision: 1,
        senderFirst: false,
        senderReleasePending: false,
        events: [],
        legalHold: false,
        participants,
        fields: a.fields.map((f) => ({ ...f, id: randomUUID(), participantId: mapping.get(f.participantId)! })),
      },
      "Duplicated to a new draft",
      actor,
      { originalId: a.id },
    );
    return publicAgreement(await store.insertAgreement(copy));
  }

  if (action === "template") {
    if (a.status !== "Draft") throw new AppError("Save templates from a draft.");
    const name = text(b.name, 100) || a.title;
    const signers = a.participants.filter((p) => p.role === "signer");
    const fields = a.fields.map(({ participantId, ...f }) => ({
      ...f,
      roleIndex: signers.findIndex((p) => p.id === participantId),
    }));
    if (fields.some((f) => f.roleIndex < 0)) throw new AppError("Template fields must belong to signer roles.");
    return store.insertAgreementTemplate({
      ...(a.branding ? { branding: a.branding } : {}),
      ...(a.documentHash ? { documentHash: a.documentHash } : {}),
      pages: a.pages,
      sourceKind: a.sourceKind,
      workspaceId: a.workspaceId,
      name,
      type: a.type,
      content: a.content,
      roles: signers.map((_, i) => (i === 0 ? "Client" : i === 1 ? "Company representative" : `Signer ${i + 1}`)),
      fields,
    });
  }

  if (action === "hold") {
    await currentWorkspace(store, user, { owner: true });
    const legalHold = !!b.hold;
    return publicAgreement(
      await writeAgreement(store, a, {
        legalHold,
        events: withEvent(a, legalHold ? "Legal hold applied" : "Legal hold released", actor, { reason: text(b.reason, 500) }).events,
      }),
    );
  }

  throw new AppError("Unknown agreement action.");
}

/** The workspace's agreement templates: id, name, type, version and created only (Ruling A7). */
export async function listTemplates(store: Store, user: SignedInUser): Promise<AgreementTemplateSummary[]> {
  const ctx = await currentWorkspace(store, user);
  return (await store.listAgreementTemplates(ctx.workspace.id)).map(({ id, name, type, version, created }) => ({ id, name, type, version, created }));
}

/** Download names. `export` is only for the guest evidence export (signGuest.ts); artifact links serve the three PDFs. */
export const ARTIFACT_NAMES: Record<string, string> = {
  source: "source.pdf",
  final: "final.pdf",
  completion: "completion-record.pdf",
  export: "signroom-evidence.zip",
};
const LINK_KINDS = ["source", "final", "completion"];
/** A signed download link lasts this long; the browser fetches it straight away. */
export const ARTIFACT_URL_SECONDS = 60;

/**
 * The link rules shared by the sender's and the guest's artifact links: the
 * source is the sender-signed PDF once there is one; final and completion
 * exist only once Completed. With `download`, Storage names the file.
 */
export async function artifactLink(store: Store, a: StoredAgreement, kind: string, download: boolean): Promise<{ url: string; filename: string }> {
  if (!LINK_KINDS.includes(kind)) throw new AppError("Unknown artifact.", 404);
  const hash = kind === "source" ? a.senderSignedHash || a.frozen?.sourceHash || a.documentHash : a.artifacts?.[kind];
  if (!hash) throw new AppError("This file is not ready.", 409);
  if (kind !== "source" && a.status !== "Completed") throw new AppError("Completion files are not ready.", 409);
  const filename = ARTIFACT_NAMES[kind];
  const url = await store.signedBlobUrl(a.workspaceId, hash, ARTIFACT_URL_SECONDS, download ? filename : undefined);
  return { url, filename };
}

/**
 * Port of SR route.ts artifact(), as a link: a short-lived signed Storage URL for
 * the stored PDF, so a file of any size reaches the browser without passing
 * through the function (whose responses stop at 4.5 MB). With `download`, Storage
 * sends it as an attachment named after the artifact.
 */
export async function agreementArtifactUrl(
  store: Store,
  user: SignedInUser,
  id: string,
  kind: string,
  download = false,
): Promise<{ url: string; filename: string }> {
  const { a } = await openAgreement(store, user, id, "artifact");
  return artifactLink(store, a, kind, download);
}
