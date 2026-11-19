/**
 * How documents look (invoices, receipts, agreements): the plain fields a
 * person fills in, and what is sent to the documents server to save or preview them.
 */
import { DOCUMENT_FONTS, type DocumentFont } from '../../../api/_signroom/shared/documentFonts';
import { presetDesign } from '../../../api/_signroom/shared/letterhead';
import type { Branding, Workspace } from '../../../api/_signroom/shared/types';

export { DOCUMENT_FONTS };
export type { DocumentFont };

/** Where the logo and company details sit at the top of the page. */
export type DocumentLayout = 'classic' | 'right' | 'minimal';

export const DOCUMENT_LAYOUTS: Array<{ id: DocumentLayout; label: string; hint: string }> = [
  { id: 'classic', label: 'Classic', hint: 'Logo on the left with a coloured rule' },
  { id: 'right', label: 'Logo on the right', hint: 'Company details on the left, logo on the right' },
  { id: 'minimal', label: 'Minimal', hint: 'Plain header with no coloured rule' },
];

export const FONT_SIZES = [10, 11, 12, 13, 14, 15, 16] as const;
export const PREVIEW_KINDS = ['invoice', 'receipt', 'agreement'] as const;
export type PreviewKind = (typeof PREVIEW_KINDS)[number];

/** The server stores a logo as a data URL and refuses one above this many bytes on disk. */
export const LOGO_MAX_BYTES = 300_000;

export interface BrandingForm {
  companyName: string;
  address: string;
  companyNumber: string;
  taxNumber: string;
  /** A PNG or JPEG data URL, or "" for no logo (the company name is written instead). */
  logo: string;
  color: string;
  fontFamily: DocumentFont;
  fontSize: number;
  footer: string;
  paymentInstructions: string;
  layout: DocumentLayout;
}

type WorkspaceLook = Pick<Workspace, 'name' | 'logo' | 'branding'>;

export const layoutOf = (branding: Pick<Branding, 'layout' | 'logoPosition'> | undefined): DocumentLayout =>
  branding?.logoPosition === 'right' ? 'right' : branding?.layout === 'minimal' ? 'minimal' : 'classic';

/** The form as it starts: what is saved, over the server's own defaults for a new workspace. */
export function brandingFormOf(workspace: WorkspaceLook): BrandingForm {
  const saved = workspace.branding;
  return {
    companyName: saved?.companyName ?? workspace.name,
    address: saved?.address ?? '',
    companyNumber: saved?.companyNumber ?? '',
    taxNumber: saved?.taxNumber ?? '',
    logo: workspace.logo || saved?.logo || '',
    color: saved?.color ?? '#24543b',
    fontFamily: saved?.fontFamily ?? 'instrument',
    fontSize: saved?.fontSize ?? 12,
    footer: saved?.footer ?? '',
    paymentInstructions: saved?.paymentInstructions ?? '',
    layout: layoutOf(saved),
  };
}

/**
 * What to send to `workspaces/branding` (and, with `previewKind` added, to
 * `workspaces/branding-preview`).
 *
 * A workspace may carry a custom letterhead made in an earlier product. The
 * server keeps that design when none is sent, so it is replaced only when the
 * person picks a different layout here.
 */
export function brandingBody(form: BrandingForm, saved: Branding | undefined): Record<string, unknown> {
  const fields = {
    companyName: form.companyName,
    address: form.address,
    companyNumber: form.companyNumber,
    taxNumber: form.taxNumber,
    logo: form.logo,
    color: form.color,
    fontFamily: form.fontFamily,
    fontSize: form.fontSize,
    footer: form.footer,
    paymentInstructions: form.paymentInstructions,
    layout: form.layout === 'minimal' ? 'minimal' as const : 'letterhead' as const,
    logoPosition: form.layout === 'right' ? 'right' as const : 'left' as const,
  };
  if (!saved?.design || form.layout === layoutOf(saved)) return fields;
  return { ...fields, design: presetDesign(form.layout, { ...saved, ...fields }) };
}

/** Why a chosen logo file cannot be used, or null when it can. */
export function logoProblem(file: { type: string; size: number }): string | null {
  if (file.type !== 'image/png' && file.type !== 'image/jpeg') return 'Use a PNG or JPEG logo.';
  if (file.size > LOGO_MAX_BYTES) return 'Choose a logo smaller than 300 KB.';
  return null;
}

/** `workspaces/email-settings`: the name on outgoing emails and where replies go. */
export function senderBody(
  sender: { senderName: string; replyTo: string },
  workspace: Pick<Workspace, 'senderEmail'>,
): { senderName: string; senderEmail: string; replyTo: string } {
  const replyTo = sender.replyTo.trim();
  // The server asks for a work address too. There is no separate field for it here, so replies and work address match.
  return { senderName: sender.senderName.trim(), senderEmail: workspace.senderEmail || replyTo, replyTo };
}

/** `workspaces/settings`: only the retention period changes here; the name is sent back as it is. */
export function retentionBody(workspace: Pick<Workspace, 'name'>, retentionDays: number): { name: string; retentionDays: number } {
  return { name: workspace.name, retentionDays };
}
