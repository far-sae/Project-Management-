import { AppError } from "./errors.js";
import { currentWorkspace, type SignedInUser } from "./context.js";
import type { AgreementTemplate, AgreementTemplateSummary } from "./shared/types.js";
import type { Store } from "./store.js";
import { isUuid } from "./validate.js";

/**
 * Managing the workspace's saved agreement templates: open one, rename it,
 * delete a version. A template is saved from a draft (agreements.ts, the
 * "template" action) and each save of the same name is a new version, a row of
 * its own. Templates belong to the workspace: every member sees them all.
 *
 * An agreement made from a template holds its own copy of the text, fields and
 * pages, and only remembers the template's id (no foreign key), so renaming or
 * deleting a template never changes or breaks an agreement.
 *
 * Rename and delete need migration 186: before it, the database refuses every
 * change to a template, and the router answers with the sentence naming that file.
 */
export const TEMPLATE_NOT_FOUND = "Template not found.";
export const TEMPLATE_NAME_MESSAGE = "Enter a template name of 1 to 120 characters.";
export const TEMPLATE_NAME_TAKEN = "A template with that name already exists.";
export const TEMPLATE_NAME_MAX = 120;

/** The template if the id is a uuid and it is in this workspace; anything else is the same 404. */
async function templateOf(store: Store, workspaceId: string, id: string): Promise<AgreementTemplate> {
  const t = isUuid(id) ? await store.getAgreementTemplate(workspaceId, id) : null;
  if (!t) throw new AppError(TEMPLATE_NOT_FOUND, 404);
  return t;
}

const summaryOf = ({ id, name, type, version, created }: AgreementTemplate): AgreementTemplateSummary => ({ id, name, type, version, created });

/** GET templates/:id: the whole template, for any member of the workspace. */
export async function getTemplate(store: Store, user: SignedInUser, id: string): Promise<AgreementTemplate> {
  const { workspace } = await currentWorkspace(store, user);
  return templateOf(store, workspace.id, id);
}

/**
 * POST templates/:id/rename { name }: gives every version of this template's
 * name the new one. 409 when another template in the workspace already has it.
 */
export async function renameTemplate(store: Store, user: SignedInUser, id: string, body: Record<string, unknown>): Promise<AgreementTemplateSummary> {
  const { workspace } = await currentWorkspace(store, user);
  const t = await templateOf(store, workspace.id, id);
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name || name.length > TEMPLATE_NAME_MAX) throw new AppError(TEMPLATE_NAME_MESSAGE);
  if (name === t.name) return summaryOf(t);
  const all = await store.listAgreementTemplates(workspace.id);
  if (all.some((other) => other.name === name)) throw new AppError(TEMPLATE_NAME_TAKEN, 409);
  await store.renameAgreementTemplate(workspace.id, t.name, name);
  return summaryOf({ ...t, name });
}

/** DELETE templates/:id: removes that one version. Owner (an organisation owner or admin) only. */
export async function deleteTemplate(store: Store, user: SignedInUser, id: string): Promise<{ ok: true }> {
  const { workspace } = await currentWorkspace(store, user, { owner: true });
  const t = await templateOf(store, workspace.id, id);
  await store.deleteAgreementTemplate(workspace.id, t.id);
  return { ok: true };
}
