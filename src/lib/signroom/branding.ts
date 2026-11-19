/**
 * How documents look (invoices, receipts, agreements): the plain fields a
 * person fills in, and what is sent to the documents server to save or preview them.
 */
import { DOCUMENT_FONTS, type DocumentFont } from '../../../api/_signroom/shared/documentFonts';
import { designFor } from '../../../api/_signroom/shared/letterhead';
import type { Branding, LetterheadDesign, TemplateFile, Workspace } from '../../../api/_signroom/shared/types';
import { applyDesign, recolourDesign, reflowForLogo, savedDesign } from './letterhead';

export { DOCUMENT_FONTS };
export type { DocumentFont };

/**
 * The three looks a workspace could have before it had a letterhead design.
 * They are still sent, because the server stores them, but the design decides
 * what is drawn.
 */
export type DocumentLayout = 'classic' | 'right' | 'minimal';
const OLD_LAYOUTS: readonly string[] = ['classic', 'right', 'minimal'];

export const FONT_SIZES = [10, 11, 12, 13, 14, 15, 16] as const;
export const PREVIEW_KINDS = ['invoice', 'receipt', 'agreement'] as const;
export type PreviewKind = (typeof PREVIEW_KINDS)[number];

/** The server stores a logo as a data URL and refuses one above this many bytes on disk. */
export const LOGO_MAX_BYTES = 300_000;
/** The server refuses a letterhead PDF above this many bytes. */
export const LETTERHEAD_MAX_BYTES = 4 * 1024 * 1024;
/** The colour the ready-made designs use for bands and corners until another is chosen. */
export const SECOND_COLOUR = '#172c35';

export interface BrandingForm {
  companyName: string;
  address: string;
  companyNumber: string;
  taxNumber: string;
  /** A PNG or JPEG data URL, or "" for no logo (the company name is written instead). */
  logo: string;
  color: string;
  /** The second colour of the ready-made designs: their bands, corners and footer details. */
  secondaryColor: string;
  fontFamily: DocumentFont;
  fontSize: number;
  /** The body of every document in bold, in italics, or both. */
  bodyBold: boolean;
  bodyItalic: boolean;
  footer: string;
  paymentInstructions: string;
  layout: DocumentLayout;
  /** Where everything sits at the top and bottom of each page. */
  design: LetterheadDesign;
  /** The person's own letterhead PDF, drawn behind every page; null for none. */
  backgroundTemplate: TemplateFile | null;
  /** With their own PDF: whether the logo, company details and text boxes are also drawn on top of it. */
  templateOverlay: boolean;
}

type WorkspaceLook = Pick<Workspace, 'name' | 'logo' | 'branding'>;

export const layoutOf = (branding: Pick<Branding, 'layout' | 'logoPosition'> | undefined): DocumentLayout =>
  branding?.logoPosition === 'right' ? 'right' : branding?.layout === 'minimal' ? 'minimal' : 'classic';

/** The form's fields as the server's branding, for the shared layout code that reads it. */
export function brandOf(form: Omit<BrandingForm, 'design'> & { design?: LetterheadDesign }): Branding {
  return {
    companyName: form.companyName,
    address: form.address,
    companyNumber: form.companyNumber,
    taxNumber: form.taxNumber,
    ...(form.logo ? { logo: form.logo } : {}),
    color: form.color,
    secondaryColor: form.secondaryColor,
    fontFamily: form.fontFamily,
    fontSize: form.fontSize,
    bodyBold: form.bodyBold,
    bodyItalic: form.bodyItalic,
    footer: form.footer,
    paymentInstructions: form.paymentInstructions,
    layout: form.layout === 'minimal' ? 'minimal' : 'letterhead',
    logoPosition: form.layout === 'right' ? 'right' : 'left',
    backgroundTemplate: form.backgroundTemplate,
    templateOverlay: form.templateOverlay,
    ...(form.design ? { design: form.design } : {}),
  };
}

/** The form as it starts: what is saved, over the server's own defaults for a new workspace. */
export function brandingFormOf(workspace: WorkspaceLook): BrandingForm {
  const saved = workspace.branding;
  const fields = {
    companyName: saved?.companyName ?? workspace.name,
    address: saved?.address ?? '',
    companyNumber: saved?.companyNumber ?? '',
    taxNumber: saved?.taxNumber ?? '',
    logo: workspace.logo || saved?.logo || '',
    color: saved?.color ?? '#24543b',
    secondaryColor: saved?.secondaryColor ?? SECOND_COLOUR,
    fontFamily: saved?.fontFamily ?? 'instrument',
    fontSize: saved?.fontSize ?? 12,
    bodyBold: !!saved?.bodyBold,
    bodyItalic: !!saved?.bodyItalic,
    footer: saved?.footer ?? '',
    paymentInstructions: saved?.paymentInstructions ?? '',
    layout: layoutOf(saved),
    backgroundTemplate: saved?.backgroundTemplate ?? null,
    templateOverlay: !!saved?.templateOverlay,
  };
  // A workspace with no design yet starts from the layout it had, so the designer has something to show.
  return { ...fields, design: saved?.design ?? designFor(brandOf(fields)) };
}

/** The form with a different logo ("" for none). An untouched layout makes room for it, or closes the gap. */
export function withLogo(form: BrandingForm, logo: string): BrandingForm {
  const next = { ...form, logo };
  return { ...next, design: reflowForLogo(form.design, brandOf(form), brandOf(next)) };
}

/** The form with a different brand colour. The rule, and items in the old colour, follow it. */
export function withBrandColour(form: BrandingForm, color: string): BrandingForm {
  return { ...form, color, design: recolourDesign(form.design, form.color, color) };
}

/** The form with a plain layout or ready-made design in place of the current one. */
export function withDesign(form: BrandingForm, name: string): BrandingForm {
  const layout = OLD_LAYOUTS.includes(name) ? name as DocumentLayout : form.layout;
  const next = { ...form, layout };
  return { ...next, design: applyDesign(name, brandOf(next), form.design) };
}

/**
 * What to send to `workspaces/branding` (and, with `previewKind` added, to
 * `workspaces/branding-preview`).
 *
 * The letterhead PDF is named only when it has changed: the server checks the
 * name against the files it still holds, and keeps the saved one otherwise.
 */
export function brandingBody(form: BrandingForm, saved: Branding | undefined): Record<string, unknown> {
  const body: Record<string, unknown> = {
    companyName: form.companyName,
    address: form.address,
    companyNumber: form.companyNumber,
    taxNumber: form.taxNumber,
    logo: form.logo,
    color: form.color,
    secondaryColor: form.secondaryColor,
    fontFamily: form.fontFamily,
    fontSize: form.fontSize,
    bodyBold: form.bodyBold,
    bodyItalic: form.bodyItalic,
    footer: form.footer,
    paymentInstructions: form.paymentInstructions,
    layout: form.layout === 'minimal' ? 'minimal' : 'letterhead',
    logoPosition: form.layout === 'right' ? 'right' : 'left',
    templateOverlay: form.templateOverlay,
    design: savedDesign(form.design),
  };
  const hash = form.backgroundTemplate?.hash ?? null;
  if (hash !== (saved?.backgroundTemplate?.hash ?? null)) body.backgroundTemplate = hash ? { hash } : null;
  return body;
}

/** Why a chosen logo file cannot be used, or null when it can. */
export function logoProblem(file: { type: string; size: number }): string | null {
  if (file.type !== 'image/png' && file.type !== 'image/jpeg') return 'Use a PNG or JPEG logo.';
  if (file.size > LOGO_MAX_BYTES) return 'Choose a logo smaller than 300 KB.';
  return null;
}

/** Why a chosen letterhead file cannot be used, or null when it can be sent for checking. */
export function letterheadProblem(file: { name: string; type: string; size: number }): string | null {
  if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) return 'Choose a PDF file for your letterhead.';
  if (!file.size || file.size > LETTERHEAD_MAX_BYTES) return 'Choose a single-page PDF up to 4 MB.';
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
