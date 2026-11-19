/**
 * Recipients and signing fields of an agreement draft. Pure: no React, no
 * network. Positions and sizes are fractions of the page (0 to 1), as the
 * documents server stores them.
 */
import type { Agreement, Field, FieldKind, Participant } from '../../../api/_signroom/shared/types';

export const FIELD_LABELS: Record<FieldKind, string> = {
  signature: 'Signature',
  initials: 'Initials',
  full_name: 'Full name',
  company: 'Company',
  title: 'Job title',
  date_signed: 'Date signed',
  text: 'Short text',
  checkbox: 'Checkbox',
};

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

export const fieldSize = (kind: FieldKind): { width: number; height: number } => ({
  width: kind === 'checkbox' ? 0.045 : kind === 'signature' ? 0.3 : 0.25,
  height: kind === 'checkbox' ? 0.033 : kind === 'signature' ? 0.055 : 0.035,
});

/** A new required field of the kind's usual size, kept inside the page. */
export function placeField(input: {
  id: string; kind: FieldKind; participantId: string; page: number; x?: number; y?: number;
}): Field {
  const { width, height } = fieldSize(input.kind);
  return {
    id: input.id,
    participantId: input.participantId,
    kind: input.kind,
    label: FIELD_LABELS[input.kind],
    page: input.page,
    x: clamp(input.x ?? 0.12, 0, 1 - width),
    y: clamp(input.y ?? 0.72, 0, 1 - height),
    width,
    height,
    required: true,
  };
}

/** One signature field for each signer on the last page, two to a row. */
export function signatureForEachSigner(participants: Participant[], lastPage: number, makeId: () => string): Field[] {
  return participants.filter((p) => p.role === 'signer').map((p, i) => ({
    id: makeId(),
    participantId: p.id,
    kind: 'signature' as const,
    label: 'Signature',
    page: lastPage,
    x: 0.1 + (i % 2) * 0.45,
    y: Math.min(0.9, 0.72 + Math.floor(i / 2) * 0.08),
    width: 0.35,
    height: 0.055,
    required: true,
  }));
}

type Box = Pick<Field, 'x' | 'y' | 'width' | 'height'>;

/** Dragging a field by a fraction of the page: it stops at the page edges. */
export const moveField = (f: Box, dx: number, dy: number): Pick<Field, 'x' | 'y'> => ({
  x: clamp(f.x + dx, 0, 1 - f.width),
  y: clamp(f.y + dy, 0, 1 - f.height),
});

/** Dragging a field's corner: it keeps a usable size and stays on the page. */
export const resizeField = (f: Box, dx: number, dy: number): Pick<Field, 'width' | 'height'> => ({
  width: clamp(f.width + dx, 0.025, 1 - f.x),
  height: clamp(f.height + dy, 0.015, 1 - f.y),
});

/** Whether typing this value into the inspector leaves the field on the page and big enough to save. */
export function geometryAllows(f: Box, key: keyof Box, value: number): boolean {
  const next = { ...f, [key]: value };
  return Number.isFinite(value) && next.x >= 0 && next.y >= 0
    && next.x + next.width <= 1 && next.y + next.height <= 1
    && next.width >= 0.015 && next.height >= 0.01;
}

/** Signers by id, for the field pickers. Completion copies cannot hold fields. */
export const signerNames = (participants: Participant[]): Record<string, string> =>
  Object.fromEntries(participants.filter((p) => p.role === 'signer').map((p) => [p.id, p.name || 'Unnamed signer']));

export const hasRequiredSignature = (fields: Field[], participantId: string): boolean =>
  fields.some((f) => f.participantId === participantId && f.kind === 'signature' && f.required);

const cleanEmail = (value: string): string => value.trim().toLowerCase();

/** The documents server's rule for one plain email address. */
const validEmail = (value: string): boolean => {
  const e = cleanEmail(value);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && !/[<>(),;:"\\]/.test(e) && e.length <= 254;
};

/**
 * What still stops this draft from being sent, in the server's own sentences
 * and order. Empty means the server's checks on the draft itself will pass (it
 * still checks things the browser cannot see, such as whether email can be sent).
 */
export function sendBlockers(draft: Agreement, me: { email: string }, now: number = Date.now()): string[] {
  const out: string[] = [];
  const signers = draft.participants.filter((p) => p.role === 'signer');
  if (!draft.documentHash || !draft.pages.length) out.push('Prepare and review the PDF first.');
  if (!signers.length || draft.participants.length > 12) out.push('Add at least one signer.');
  if (draft.participants.some((p) => !p.name.trim())) out.push('Every recipient needs a name.');
  if (draft.participants.some((p) => !validEmail(p.email))) out.push('Enter a valid email address.');
  const emails = draft.participants.map((p) => cleanEmail(p.email));
  if (new Set(emails).size !== emails.length) out.push('Use unique email addresses for recipients.');
  for (const p of signers) {
    if (p.name.trim() && !hasRequiredSignature(draft.fields, p.id)) out.push(`Add a required signature field for ${p.name.trim()}.`);
  }
  if (draft.deadline && new Date(`${draft.deadline}T23:59:59Z`).getTime() < now) out.push('Choose a future deadline.');
  if (/\{\{[^}]+\}\}/.test(draft.content)) out.push('Resolve all template placeholders.');
  if (draft.senderFirst && (signers.length < 2 || cleanEmail(signers[0].email) !== cleanEmail(me.email))) {
    out.push('Sign-first requires you as the first signer and at least one other signer.');
  }
  return out;
}

/** "I sign first": the sender becomes the first signer and everyone is renumbered. */
export function meFirst(participants: Participant[], me: { name: string; email: string }, makeId: () => string): Participant[] {
  const mine = cleanEmail(me.email);
  const existing = participants.find((p) => cleanEmail(p.email) === mine);
  const first: Participant = existing
    ? { ...existing, role: 'signer' }
    : { id: makeId(), name: me.name, email: me.email, role: 'signer', order: 1, progress: 'waiting', version: 0 };
  return [first, ...participants.filter((p) => cleanEmail(p.email) !== mine)].map((p, i) => ({ ...p, order: i + 1 }));
}

/** The body of a draft save: only what the server stores, plus the revision it must match. */
export const savePayload = (draft: Agreement, clearFields: boolean) => ({
  revision: draft.revision,
  title: draft.title,
  content: draft.content,
  participants: draft.participants,
  fields: draft.fields,
  senderFirst: Boolean(draft.senderFirst),
  sequential: draft.sequential,
  deadline: draft.deadline,
  reminderDays: draft.reminderDays,
  subject: draft.subject,
  message: draft.message,
  clearFields,
});

/** A signer's required fields that are still empty. The signing date is filled in by the server. */
export function missingGuestFields(fields: Field[], signature: string, values: Record<string, string | boolean>): Field[] {
  return fields.filter((f) => f.required && !(
    f.kind === 'signature' ? signature.trim() : f.kind === 'date_signed' ? true : values[f.id]
  ));
}
