import { randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { artifactBytes, sha } from "./billing.js";
import { balance } from "./shared/invoiceMath.js";
import { AppError } from "./errors.js";
import { sendMail, type MailDeps } from "./mail.js";
import type { BillingToken, Invoice } from "./shared/types.js";

/**
 * Port of Signroom's billingGuestAction: a business's client, who is not signed
 * in, opens a private link, confirms a 6-digit code sent to the invited email,
 * and gets a 30-minute session to view one invoice or receipt PDF.
 */

const CODE_LIFE_MS = 10 * 60000;
const CODE_GAP_MS = 60000;
const SEND_WINDOW_MS = 3600000;
const MAX_SENDS = 3;
const MAX_ATTEMPTS = 5;
const SESSION_MS = 30 * 60000;
/** Counter races are retried; this many lost races in a row means heavy abuse, so refuse. */
const RETRIES = 12;

const EXPIRED = "This invoice or receipt link is expired or unavailable.";
const NO_SESSION = "Verify the invited email to open this financial document.";
const LIMIT = "Code expired or attempt limit reached.";

/** What the verified visitor is about to open, so the page can say the amount and the date without opening the PDF. */
export type GuestDocument = {
  kind: "invoice" | "receipt";
  number: string;
  currency: string;
  totalMinor: number;
  balanceMinor: number;
  dueDate: string;
};

export type GuestResult =
  | { ok: true; sender?: string; session?: { raw: string; expires: number }; document?: GuestDocument }
  | { error: string; status: number };

/** The live token for this link, its invoice, or a 410. */
async function openLink(deps: MailDeps, access: string | undefined): Promise<{ token: BillingToken; invoice: Invoice }> {
  const token = await deps.store.findToken(sha(String(access || "")));
  if (!token || token.purpose !== "billing" || token.revoked || token.expires <= Date.now() || !token.invoiceId) throw new AppError(EXPIRED, 410);
  const invoice = await deps.store.getInvoice(token.workspaceId, token.invoiceId);
  if (!invoice || invoice.status === "Voided") throw new AppError(EXPIRED, 410);
  return { token, invoice };
}

const sameDigest = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export async function billingGuestAction(
  deps: MailDeps,
  action: "intro" | "code" | "verify",
  body: { access?: string; code?: string },
): Promise<GuestResult> {
  const { store } = deps;

  if (action === "intro") {
    const { invoice } = await openLink(deps, body.access);
    return { ok: true, sender: invoice.branding?.companyName };
  }

  if (action === "code") {
    for (let n = 0; n < RETRIES; n++) {
      const { token, invoice } = await openLink(deps, body.access);
      const now = Date.now();
      if (token.codeSent && token.codeSent > now - CODE_GAP_MS) throw new AppError("Wait one minute before requesting another code.", 429);
      const fresh = !token.codeWindowStart || token.codeWindowStart + SEND_WINDOW_MS <= now;
      const sends = fresh ? 0 : token.codeSends;
      if (sends >= MAX_SENDS) throw new AppError("Too many requests. Please try again later.", 429);
      const workspace = await store.getWorkspace(token.workspaceId);
      if (!workspace) throw new AppError(EXPIRED, 410);

      const code = String(randomInt(100000, 1000000));
      // Compare-and-set on the counters, so racing requests cannot both be counted as the first.
      const won = await store.updateTokenIf(
        token.id,
        { attempts: token.attempts, codeSends: token.codeSends },
        {
          codeDigest: sha(code),
          codeSent: now,
          codeExpires: now + CODE_LIFE_MS,
          attempts: 0,
          codeSends: sends + 1,
          codeWindowStart: fresh ? now : token.codeWindowStart,
        },
      );
      if (!won) continue;
      try {
        await sendMail(deps, workspace, {
          to: token.email,
          subject: "Your invoice verification code",
          text: `Your verification code is ${code}. It expires in ten minutes.`,
          purpose: "billing-otp",
          invoiceId: invoice.id,
        });
      } catch (e) {
        // Nothing was delivered: the stored code must not stay usable, and the visitor may retry at once.
        await store.updateToken(token.id, { codeExpires: 0, codeSent: 0 });
        throw e;
      }
      return { ok: true };
    }
    throw new AppError("Too many requests. Please try again later.", 429);
  }

  for (let n = 0; n < RETRIES; n++) {
    const { token, invoice } = await openLink(deps, body.access);
    if (!token.codeDigest || !token.codeExpires || token.codeExpires < Date.now() || token.attempts >= MAX_ATTEMPTS) throw new AppError(LIMIT, 403);
    // The attempt is counted before the code is compared, and only one of several racing calls wins each count.
    const counted = await store.updateTokenIf(token.id, { attempts: token.attempts, codeSends: token.codeSends }, { attempts: token.attempts + 1 });
    if (!counted) continue;
    if (!sameDigest(token.codeDigest, sha(String(body.code || "")))) return { error: "Incorrect verification code.", status: 403 };

    await store.updateToken(token.id, { codeDigest: "", codeExpires: 0 });
    const raw = randomBytes(32).toString("base64url");
    const expires = Date.now() + SESSION_MS;
    await store.insertSession({ digest: sha(raw), kind: "billing", tokenId: token.id, workspaceId: invoice.workspaceId, invoiceId: invoice.id, expires });
    // Only after the code is accepted: the link alone never reveals an amount.
    const document: GuestDocument = {
      kind: token.paymentId ? "receipt" : "invoice",
      number: invoice.number,
      currency: invoice.currency,
      totalMinor: invoice.totalMinor,
      balanceMinor: balance(invoice),
      dueDate: invoice.dueDate,
    };
    return { ok: true, session: { raw, expires }, document };
  }
  throw new AppError(LIMIT, 403);
}

/** The PDF the verified visitor was invited to see: session, then token, then invoice. */
export async function billingGuestArtifact(
  deps: MailDeps,
  rawSession: string | undefined,
): Promise<{ bytes: Uint8Array; filename: string }> {
  const { store } = deps;
  const session = await store.findSession(sha(rawSession || ""));
  const token = session && session.kind === "billing" && session.expires > Date.now() && session.tokenId ? await store.getToken(session.tokenId) : null;
  const invoice =
    token && token.purpose === "billing" && !token.revoked && token.expires > Date.now() && token.invoiceId
      ? await store.getInvoice(token.workspaceId, token.invoiceId)
      : null;
  if (!session || !token || !invoice || invoice.status === "Voided") throw new AppError(NO_SESSION, 401);
  const named = token.paymentId ? invoice.payments.find((p) => p.id === token.paymentId)?.receiptNumber : undefined;
  return { bytes: await artifactBytes(store, invoice, token.paymentId), filename: `${named || invoice.number}.pdf` };
}
