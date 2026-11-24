import { AppError, StoreError } from "./errors.js";
import type { SignedInUser } from "./context.js";
import { agreementAction, agreementArtifactUrl, createAgreement, getAgreement, listAgreements, listTemplates } from "./agreements.js";
import { finishUpload, prepareAgreement, uploadUrl } from "./agreementDocument.js";
import { deleteTemplate, getTemplate, renameTemplate } from "./agreementTemplates.js";
import { draftAgreement, type DraftDeps } from "./aiDraft.js";
import { cancelAgreement, releaseFirst, resendInvitations, sendAgreement, signFirst } from "./agreementSend.js";
import { billingAction, billingArtifact, billingDelivery, billingPreview, billingSend, deleteInvoice } from "./billing.js";
import { clientAction, clientFromCompany } from "./clients.js";
import { clientAccount } from "./clientAccounts.js";
import { agreementDeliveries, invoiceDeliveries } from "./deliveries.js";
import { emailConnectionAction } from "./emailConnection.js";
import { finishAuthorization } from "./oauthConnection.js";
import { accountsOverview, projectAction } from "./projects.js";
import { billingGuestAction, billingGuestArtifact } from "./guest.js";
import { deleteAgreementNow, exportEvidence, scheduleDeletion } from "./retention.js";
import type { MailDeps } from "./mail.js";
import { agreementGuestAction, agreementGuestArtifactUrl, agreementGuestExport, type SignGuestAction } from "./signGuest.js";
import type { Invoice } from "./shared/types.js";
import { templateBytes, uploadTemplate, TEMPLATE_SIZE_MESSAGE } from "./templates.js";
import { brandingPreview, sessionView, workspaceAction } from "./workspace.js";
import { runOps } from "./worker.js";
import { SIGN_IN_MESSAGE } from "./host/auth.js";
import { setupSentence, TABLES_MISSING_MESSAGE } from "./setupMessages.js";

/**
 * Everything a request needs from outside: the mail deps (which carry the
 * store) and Draft with AI's Claude (none when omitted).
 */
export type RouteDeps = { mail: MailDeps; draft?: DraftDeps };

export type RouteRequest = {
  method: string;
  path: string[];
  query: Record<string, string>;
  body: Record<string, unknown>;
  /** The signed-in account; workspaceId is the X-Signroom-Workspace header (a TaskCalendar workspace id), checked by currentWorkspace on every request. */
  user: SignedInUser | null;
  /** The sr_billing cookie: an invoice guest's session (billing-guest/* paths only). */
  guestSession?: string;
  /** The sr_sign cookie: an agreement guest's session (guest/* paths only). */
  signSession?: string;
  origin: string;
  /** The raw upload body (letterhead PDF) and its file name, for routes that take bytes. */
  raw?: { bytes: Uint8Array; name: string };
  /** Set only by the entry, after the cron secret check: the scheduled run. */
  cron?: boolean;
  /** The sr_mail_oauth cookie: the browser that started an email sign-in (callback only). */
  oauthBrowser?: string;
};

export type RouteResult = {
  status: number;
  json?: unknown;
  pdf?: { bytes: Uint8Array; filename: string; inline: boolean };
  setGuestSession?: { raw: string; expires: number };
  setSignSession?: { raw: string; expires: number };
  /** A relative Location for a 303. */
  redirect?: string;
  /** The sign-in browser secret, for the Set-Cookie header only. */
  setOAuthBrowser?: string;
  clearOAuthBrowser?: true;
};

export const NOT_FOUND_MESSAGE = "Not found.";
export const FAILED_MESSAGE = "Something went wrong. Please try again.";

const notFound = (): RouteResult => ({ status: 404, json: { error: NOT_FOUND_MESSAGE } });
const ok = (json: unknown): RouteResult => ({ status: 200, json });

const BILLING_ACTIONS = ["save", "issue", "payment", "void"];
const WORKSPACE_ACTIONS = ["settings", "email-settings", "branding"] as const;
const EMAIL_ACTIONS = ["save", "test", "disconnect", "verify", "authorize", "confirm"] as const;
const GUEST_ACTIONS = ["intro", "code", "verify"] as const;
const SIGN_GUEST_ACTIONS: readonly SignGuestAction[] = ["intro", "code", "verify", "recover", "document", "sign", "decline"];
const AGREEMENT_ACTIONS = ["save", "archive", "unarchive", "trash", "restore", "duplicate", "template", "hold"] as const;

/** ?companyId and ?dealId, when given. */
const listQuery = (q: Record<string, string>) => ({ ...(q.companyId ? { companyId: q.companyId } : {}), ...(q.dealId ? { dealId: q.dealId } : {}) });

async function guestRoute(deps: RouteDeps, r: RouteRequest): Promise<RouteResult> {
  const [, action] = r.path;
  if (r.path.length !== 2) return notFound();
  if (r.method === "GET" && action === "artifact") {
    const { bytes, filename } = await billingGuestArtifact(deps.mail, r.guestSession);
    return { status: 200, pdf: { bytes, filename, inline: false } };
  }
  const guestAction = GUEST_ACTIONS.find((a) => a === action);
  if (r.method !== "POST" || !guestAction) return notFound();
  const out = await billingGuestAction(deps.mail, guestAction, {
    access: typeof r.body.access === "string" ? r.body.access : undefined,
    code: typeof r.body.code === "string" ? r.body.code : undefined,
  });
  if ("error" in out) return { status: out.status, json: { error: out.error } };
  const { session, ...rest } = out;
  return { status: 200, json: rest, ...(session ? { setGuestSession: session } : {}) };
}

/** An invited agreement recipient: no sign-in; the sr_sign cookie is the session. */
async function signGuestRoute(deps: RouteDeps, r: RouteRequest): Promise<RouteResult> {
  const [, action] = r.path;
  if (r.path.length !== 2) return notFound();
  if (r.method === "GET" && action === "artifact-url") return ok(await agreementGuestArtifactUrl(deps.mail, r.signSession, r.query.kind || "source"));
  if (r.method === "GET" && action === "export") return ok(await agreementGuestExport(deps.mail, r.signSession));
  const guestAction = SIGN_GUEST_ACTIONS.find((a) => a === action);
  if (r.method !== "POST" || !guestAction) return notFound();
  const { json, session } = await agreementGuestAction(deps.mail, guestAction, r.body, r.signSession, r.origin);
  return { status: 200, json, ...(session ? { setSignSession: session } : {}) };
}

async function userRoute(deps: RouteDeps, r: RouteRequest, user: NonNullable<RouteRequest["user"]>): Promise<RouteResult> {
  const { store } = deps.mail;
  const [head, second, third] = r.path;
  const n = r.path.length;
  const { method, body } = r;

  if (head === "session" && n === 1 && method === "GET") return ok(await sessionView(store, user));

  if (head === "clients") {
    if (n === 1 && method === "GET") {
      const includeDeleted = r.query.includeDeleted === "1" || r.query.includeDeleted === "true";
      return ok(await clientAction(store, user, "GET", { includeDeleted }));
    }
    // Clients are made from CRM companies; they are never typed in or edited here.
    if (n === 2 && second === "from-company") {
      if (method !== "POST") return notFound();
      return ok(await clientFromCompany(store, user, body));
    }
    if (n === 2 && (method === "PATCH" || method === "DELETE")) return ok(await clientAction(store, user, method, body, second));
    return notFound();
  }

  // Billing plans (the source's client "projects": the paths and JSON fields keep that name).
  if (head === "client-projects" && (n === 2 || n === 3)) return ok(await projectAction(store, user, second, third, method, body, r.query.year ?? ""));

  if (head === "accounts-overview" && n === 1) {
    if (method !== "GET") throw new AppError("Method not allowed.", 405);
    return ok(await accountsOverview(store, user, r.query.year ?? ""));
  }

  if (head === "client-accounts" && n === 2) return ok(await clientAccount(store, user, second, method, body, r.query.from ?? "", r.query.to ?? ""));

  if (head === "workspaces" && second === "branding-template" && n === 2) {
    if (method === "POST") {
      if (!r.raw) throw new AppError(TEMPLATE_SIZE_MESSAGE);
      return ok(await uploadTemplate(deps.mail, user, r.raw));
    }
    if (method === "GET") {
      const bytes = await templateBytes(deps.mail, user, r.query.hash ?? "");
      return { status: 200, pdf: { bytes, filename: "letterhead.pdf", inline: true } };
    }
    return notFound();
  }

  if (head === "workspaces" && second === "branding-preview" && n === 2) {
    if (method !== "POST") return notFound();
    const bytes = await brandingPreview(store, user, body);
    return { status: 200, pdf: { bytes, filename: "branding-preview.pdf", inline: true } };
  }

  if (head === "workspaces" && n === 2 && method === "POST") {
    const action = WORKSPACE_ACTIONS.find((a) => a === second);
    if (!action) return notFound();
    return ok(await workspaceAction(store, user, action, body, deps.mail));
  }

  // The workspace's own mailbox (SMTP, Google or Microsoft): owners and admins only.
  if (head === "email-connection") {
    if (n === 1 && method === "GET") return ok(await emailConnectionAction(deps.mail, user, "view", {}, r.origin));
    const action = EMAIL_ACTIONS.find((a) => a === second);
    if (n === 2 && method === "POST" && action) {
      const out = await emailConnectionAction(deps.mail, user, action, body, r.origin);
      // The browser secret goes to the Set-Cookie header only; the page gets the provider's address.
      if (action === "authorize") {
        const { url, browser } = out as { url: string; browser: string };
        return { status: 200, json: { url }, setOAuthBrowser: browser };
      }
      return ok(out);
    }
    return notFound();
  }

  if (head === "templates" && n === 1 && method === "GET") return ok(await listTemplates(store, user));
  if (head === "templates" && n === 2 && method === "GET") return ok(await getTemplate(store, user, second));
  if (head === "templates" && n === 2 && method === "DELETE") return ok(await deleteTemplate(store, user, second));
  if (head === "templates" && n === 3 && method === "POST" && third === "rename") return ok(await renameTemplate(store, user, second, body));

  if (head === "agreements") {
    if (n === 1 && method === "GET") return ok(await listAgreements(store, user, listQuery(r.query)));
    if (n === 1 && method === "POST") return ok(await createAgreement(store, user, body));
    if (n === 2 && method === "GET") return ok(await getAgreement(store, user, second));
    if (n === 3 && method === "GET" && third === "artifact-url") {
      return ok(await agreementArtifactUrl(store, user, second, r.query.kind || "source", r.query.download === "1"));
    }
    if (n === 3 && method === "GET" && third === "deliveries") return ok(await agreementDeliveries(store, user, second));
    if (n === 3 && method === "POST" && third === "prepare") return ok(await prepareAgreement(store, user, second, body));
    if (n === 3 && method === "POST" && third === "upload-url") return ok(await uploadUrl(deps.mail, user, second, body));
    if (n === 3 && method === "POST" && third === "upload") return ok(await finishUpload(deps.mail, user, second, body));
    if (n === 3 && method === "POST" && third === "send") return ok(await sendAgreement(deps.mail, user, second, body, r.origin));
    if (n === 3 && method === "POST" && third === "cancel") return ok(await cancelAgreement(deps.mail, user, second, body));
    if (n === 3 && method === "POST" && third === "resend") return ok(await resendInvitations(deps.mail, user, second, r.origin));
    if (n === 3 && method === "POST" && third === "sign-first") return ok(await signFirst(deps.mail, user, second, body));
    if (n === 3 && method === "POST" && third === "release-first") return ok(await releaseFirst(deps.mail, user, second, r.origin));
    if (n === 3 && method === "POST" && third === "export") return ok(await exportEvidence(store, user, second));
    if (n === 3 && method === "POST" && third === "delete") return ok(await scheduleDeletion(store, user, second));
    if (n === 3 && method === "POST" && third === "delete-now") return ok(await deleteAgreementNow(store, user, second));
    if (n === 3 && method === "POST" && third === "ai-draft") return ok(await draftAgreement(deps.mail, deps.draft ?? { claude: null }, user, second, body));
    const action = AGREEMENT_ACTIONS.find((a) => a === third);
    if (n === 3 && method === "POST" && action) return ok(await agreementAction(store, user, second, action, body));
    return notFound();
  }

  if (head === "billing") {
    if (n === 1) {
      if (method !== "GET" && method !== "POST") return notFound();
      return ok(await billingAction(store, user, method, undefined, undefined, body, listQuery(r.query)));
    }
    if (n === 2 && second === "delivery" && method === "GET") return ok(await billingDelivery(deps.mail, user));
    if (n === 2 && method === "GET") return ok(await billingAction(store, user, "GET", second, undefined, body));
    if (n === 3 && method === "GET" && third === "deliveries") return ok(await invoiceDeliveries(store, user, second));
    if (n === 3 && method === "GET" && third === "preview") {
      return { status: 200, pdf: { bytes: await billingPreview(store, user, second), filename: "invoice-preview.pdf", inline: true } };
    }
    if (n === 3 && method === "GET" && third === "artifact") {
      const bytes = await billingArtifact(store, user, second, r.query.payment || undefined);
      const invoice = (await billingAction(store, user, "GET", second, undefined, {})) as Invoice;
      const receipt = r.query.payment ? invoice.payments.find((p) => p.id === r.query.payment) : undefined;
      return { status: 200, pdf: { bytes, filename: `${receipt?.receiptNumber || invoice.number}.pdf`, inline: false } };
    }
    if (n === 3 && method === "POST" && (third === "send" || third === "send-receipt")) {
      return ok(await billingSend(deps.mail, user, second, third, body, r.origin));
    }
    if (n === 3 && method === "POST" && third === "delete") return ok(await deleteInvoice(store, user, second));
    if (n === 3 && method === "POST" && BILLING_ACTIONS.includes(third)) {
      return ok(await billingAction(store, user, "POST", second, third, body));
    }
  }
  return notFound();
}

/** Where the browser lands after the provider's redirect: the document settings page, told how it went. */
export const OAUTH_CONNECTED_PATH = "/crm/document-settings?emailConnection=connected";
export const OAUTH_FAILED_PATH = "/crm/document-settings?emailConnection=error";

/**
 * The provider's redirect (GET email-connection/callback): no sign-in, the
 * cookie is the proof. It always answers a 303 and never says why it failed;
 * a failure logs only the error's name or status.
 */
async function oauthCallback(deps: RouteDeps, r: RouteRequest): Promise<RouteResult> {
  try {
    await finishAuthorization(deps.mail, { state: r.query.state, code: r.query.code, browser: r.oauthBrowser, error: r.query.error });
    return { status: 303, redirect: OAUTH_CONNECTED_PATH, clearOAuthBrowser: true };
  } catch (e) {
    console.error("[signroom] email sign-in failed", e instanceof AppError ? e.status : e instanceof Error ? e.name : "unknown");
    return { status: 303, redirect: OAUTH_FAILED_PATH, clearOAuthBrowser: true };
  }
}

export { TABLES_MISSING_MESSAGE };

/**
 * One request to a result. Never throws: AppError keeps its status and
 * sentence; a database error that means a migration has not been run is a 503
 * naming the file to run (setupMessages.ts); anything else is a plain 500.
 */
export async function route(deps: RouteDeps, r: RouteRequest): Promise<RouteResult> {
  try {
    if (r.path[0] === "billing-guest") return await guestRoute(deps, r);
    if (r.path[0] === "guest") return await signGuestRoute(deps, r);
    // The scheduled run: only the entry's checked cron call reaches it.
    if (r.path[0] === "ops") {
      if (r.cron === true && r.method === "POST" && r.path.length === 2 && r.path[1] === "run") return ok(await runOps(deps.mail));
      return notFound();
    }
    if (r.method === "GET" && r.path.length === 2 && r.path[0] === "email-connection" && r.path[1] === "callback") return await oauthCallback(deps, r);
    if (!r.user) return { status: 401, json: { error: SIGN_IN_MESSAGE } };
    return await userRoute(deps, r, r.user);
  } catch (e) {
    if (e instanceof AppError) return { status: e.status, json: { error: e.message } };
    const setup = e instanceof StoreError ? setupSentence(e.message) : null;
    if (setup) return { status: 503, json: { error: setup } };
    // The error name only: its text can carry addresses, codes or visitor input.
    console.error("[signroom] failed", e instanceof Error ? e.name : "unknown");
    return { status: 500, json: { error: FAILED_MESSAGE } };
  }
}
