import { AppError } from "./errors.js";
import { currentWorkspace, type SignedInUser } from "./context.js";
import { parseBranding, validateLogo } from "./branding.js";
import type { Store } from "./store.js";
import { sampleFinancial } from "./financialPdf.js";
import { AGREEMENT_SAMPLE, authoredPdf } from "./agreementPdf.js";
import { LETTERHEAD_UNREADABLE } from "./pdf.js";
import type { Branding, Workspace, WorkspaceChoice } from "./shared/types.js";
import { canSend, type MailDeps } from "./mail.js";
import { email, text } from "./validate.js";

type Body = Record<string, unknown>;

/** The workspace as the screens see it: the logo once, at the top level, not again inside branding. */
export function publicWorkspace(w: Workspace): Workspace {
  if (!w.branding || w.branding.logo === undefined) return w;
  const { logo: _logo, ...branding } = w.branding;
  return { ...w, logo: w.logo || w.branding.logo, branding };
}

/**
 * What the Signroom screens read as their session: the workspace named by the
 * X-Signroom-Workspace header and the caller's role in it. There is no fallback:
 * a workspace the caller may not use is a 403 like every other request. The
 * workspace switcher is TaskCalendar's own, so `workspaces` holds just this one.
 */
export async function sessionView(store: Store, user: SignedInUser) {
  const { workspace, role } = await currentWorkspace(store, user);
  const workspaces: WorkspaceChoice[] = [{ id: workspace.id, name: workspace.name ?? "", role }];
  return {
    user: { id: user.id, email: user.email },
    workspaces,
    workspace: publicWorkspace(workspace),
    role,
  };
}

/** The branding fields in a request, parsed against this workspace's listed letterheads, with a checked logo. */
async function brandingFromBody(store: Store, workspace: Workspace, body: Body): Promise<Branding> {
  const templateFiles = await store.listTemplateFiles(workspace.id);
  const brand = parseBranding(body, { ...workspace, templateFiles });
  if (brand.logo !== undefined) brand.logo = await validateLogo(brand.logo);
  return brand;
}

/** The design preview: a sample invoice or receipt in the branding being edited, owner only. Nothing is saved. */
export async function brandingPreview(store: Store, user: SignedInUser, body: Body): Promise<Uint8Array> {
  const { workspace } = await currentWorkspace(store, user, { owner: true });
  const brand = await brandingFromBody(store, workspace, body);
  try {
    const load = (w: string, h: string) => store.getBlob(w, h);
    if (body.previewKind === "invoice" || body.previewKind === "receipt")
      return await sampleFinancial(brand, body.previewKind === "receipt", load);
    return (await authoredPdf(AGREEMENT_SAMPLE.title, AGREEMENT_SAMPLE.content, brand, load)).bytes;
  } catch (e) {
    if (e instanceof AppError && e.message === LETTERHEAD_UNREADABLE) throw e;
    throw new AppError("This letterhead design could not be drawn. Please change it and try again.");
  }
}

/** Owner-only workspace changes. `mail` says how email goes out (for the email-settings answer). */
export async function workspaceAction(
  store: Store,
  user: SignedInUser,
  action: "settings" | "email-settings" | "branding",
  body: Body,
  mail?: Pick<MailDeps, "resendKey" | "from">,
): Promise<unknown> {
  const { workspace } = await currentWorkspace(store, user, { owner: true });
  if (action === "email-settings") {
    const senderName = text(body.senderName, 100);
    if (!senderName || /[<>"\r\n]/.test(senderName))
      throw new AppError("Enter a sender name without quotes, brackets or line breaks.");
    const senderEmail = email(body.senderEmail);
    const replyTo = email(body.replyTo);
    await store.updateWorkspace(workspace.id, { senderName, senderEmail, replyTo });
    // One route: the platform's own address. senderEmail is kept for the screens; mail never goes from it.
    return { ok: true, mode: "securovix", ready: !!mail && canSend(mail), senderName, senderEmail, replyTo };
  }
  if (action === "branding") {
    const brand = await brandingFromBody(store, workspace, body);
    if (brand.design !== undefined) {
      // Draw a sample before saving, so a design that cannot be drawn is never stored.
      try {
        await authoredPdf("Design validation", "This space is reserved for the document body.", brand, (w, h) =>
          store.getBlob(w, h),
        );
      } catch (e) {
        if (e instanceof AppError && e.message === LETTERHEAD_UNREADABLE) throw e;
        throw new AppError("This letterhead design could not be drawn. Please change it and try again.");
      }
    }
    return publicWorkspace(await store.updateWorkspace(workspace.id, { branding: brand, logo: brand.logo }));
  }
  if (action === "settings") {
    const name = text(body.name, 100);
    const days = body.retentionDays === undefined ? workspace.retentionDays : Number(body.retentionDays);
    if (!name || !Number.isInteger(days) || days < 1 || days > 3650)
      throw new AppError("Enter a workspace name and retention between 1 and 3650 days.");
    const patch: Partial<Workspace> = {
      name,
      replyTo: body.replyTo ? email(body.replyTo) : workspace.replyTo,
      retentionDays: days,
    };
    if (body.logo !== undefined) patch.logo = await validateLogo(body.logo);
    return publicWorkspace(await store.updateWorkspace(workspace.id, patch));
  }
  throw new AppError("Unknown workspace action.", 404);
}
