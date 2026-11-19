import { randomUUID } from "node:crypto";
import { AppError } from "./errors.js";
import { sha } from "./billing.js";
import { CONSENT, type Agreement, type Participant } from "./shared/types.js";

/**
 * Port of SR guest.ts "sign" (224–288): the checks, the accepted values, the
 * drawing check and the signed participant. Pure: it changes nothing and
 * returns the participant as signed, with the "Signature accepted" detail for
 * the caller to append. The frozen fields, consent and source come from
 * `a.frozen`; the source is the sender-signed PDF once there is one.
 *
 * Shared by sender-first signing (agreementSend.ts) and 3B's guest signing,
 * so it holds nothing particular to either: the caller finds the participant,
 * checks who may sign and writes the result.
 */
export function acceptSignature(
  a: Agreement,
  participantId: string,
  body: Record<string, unknown>,
  at: string,
): { participant: Participant; detail: Record<string, unknown> } {
  const frozen = a.frozen;
  const p = a.participants.find((x) => x.id === participantId);
  if (!frozen || !p) throw Error("Missing frozen revision or participant");
  if (p.progress === "signed") throw new AppError("Your signature has already been recorded.", 409);
  const sourceHash = a.senderSignedHash || frozen.sourceHash;
  if (!body.consent || body.consentVersion !== frozen.consent.version || body.sourceHash !== sourceHash)
    throw new AppError("Review the current document and give explicit consent.");
  const signature = String(body.signature || "").trim();
  if (!signature || signature.length > 150) throw new AppError("Enter your typed signature (150 characters or fewer).");
  const values = (body.values && typeof body.values === "object" ? body.values : {}) as Record<string, string | boolean>;
  const fields = frozen.fields
    .filter((f) => f.participantId === p.id)
    .sort((x, y) => x.page - y.page || x.y - y.y || x.x - y.x);
  if (Object.keys(values).some((key) => !fields.some((f) => f.id === key)))
    throw new AppError("You can complete only your assigned fields.", 403);
  const accepted: Record<string, string | boolean> = {};
  for (const f of fields) {
    let v = f.kind === "signature" ? signature : f.kind === "date_signed" ? at.slice(0, 10) : values[f.id];
    if (f.kind === "checkbox") {
      v = !!v;
      if (f.required && !v) throw new AppError(`Complete ${f.label}.`);
    } else {
      v = String(v ?? "").trim();
      if (v.length > 500) throw new AppError(`${f.label} is too long.`);
      if (f.required && !v) throw new AppError(`Complete ${f.label}.`);
    }
    accepted[f.id] = v;
  }
  const drawing = String(body.drawing || "");
  if (drawing && (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(drawing) || drawing.length > 200000))
    throw new AppError("Use a smaller PNG signature image.");
  const participant: Participant = {
    ...p,
    signature,
    drawing: drawing || undefined,
    signedAt: at,
    values: accepted,
    submissionId: randomUUID(),
    progress: "signed",
  };
  if (!drawing) delete participant.drawing;
  const detail: Record<string, unknown> = {
    recipientId: p.id,
    submissionId: participant.submissionId,
    sourceHash,
    consent: CONSENT,
    verification: p.verification || "email access verified",
    valuesHash: sha(JSON.stringify(accepted)),
    signatureHash: sha(signature),
    // SR writes drawingHash: undefined, which JSON (and jsonb) drops; this leaves it out.
    ...(drawing ? { drawingHash: sha(drawing) } : {}),
  };
  return { participant, detail };
}
