import { PDFDocument } from "pdf-lib";
import { AppError } from "./errors.js";
import type {
  Branding,
  Workspace,
  LetterheadDesign,
  LetterheadElement,
} from "./shared/types.js";
import { ELEMENTS, PAPER, BRAND_TEMPLATES } from "./shared/letterhead.js";
import { validDocumentFont } from "./shared/documentFonts.js";
export function parseDesign(value: unknown): LetterheadDesign {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new AppError("Invalid letterhead design.");
  const d = value as Record<string, unknown>;
  const number = (value: unknown, min: number, max: number) => {
    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      value < min ||
      value > max
    )
      throw new AppError(
        "Design positions and sizes must stay inside the letterhead or footer area.",
      );
    return Math.round(value * 100) / 100;
  };
  if (d.version !== 1 || typeof d.accent !== "boolean")
    throw new AppError("Invalid letterhead design version.");
  const headerHeight = number(d.headerHeight, 110, 240),
    footerHeight = number(d.footerHeight, 48, 100);
  if (
    !d.elements ||
    typeof d.elements !== "object" ||
    Array.isArray(d.elements)
  )
    throw new AppError("Missing design elements.");
  const elements = {} as LetterheadDesign["elements"];
  for (const id of ELEMENTS) {
    const element = (d.elements as Record<string, unknown>)[id];
    if (!element || typeof element !== "object" || Array.isArray(element))
      throw new AppError("Missing letterhead element: " + id);
    const e = element as Record<string, unknown>;
    const x = number(e.x, 16, PAPER.width - 36),
      y = number(
        e.y,
        ["footer", "pageNumber"].includes(id)
          ? PAPER.height - footerHeight + 5
          : 12,
        ["footer", "pageNumber"].includes(id)
          ? PAPER.height - 18
          : headerHeight,
      ),
      width = number(e.width, 20, PAPER.width - 32),
      height = number(e.height, id === "rule" ? 1 : 12, 240);
    if (
      x + width > PAPER.width - 16 + 0.02 ||
      y + height >
        (["footer", "pageNumber"].includes(id)
          ? PAPER.height - 18
          : headerHeight) +
          0.02
    )
      throw new AppError(
        "Keep each design element inside its header or footer safe area.",
      );
    if (
      !["left", "center", "right"].includes(String(e.align)) ||
      typeof e.visible !== "boolean" ||
      !/^#[a-fA-F0-9]{6}$/.test(String(e.color))
    )
      throw new AppError("Invalid element styling.");
    if (["companyName", "logo"].includes(id) && !e.visible)
      throw new AppError("Company name and logo must remain enabled.");
    if (e.fontFamily !== undefined && !validDocumentFont(e.fontFamily))
      throw new AppError("Choose a supported document font.");
    elements[id] = {
      ...Object.fromEntries(
        ["bold", "italic", "underline"]
          .filter((key) => e[key] !== undefined)
          .map((key) => {
            if (typeof e[key] !== "boolean")
              throw new AppError("Text style choices must be on or off.");
            return [key, e[key]];
          }),
      ),
      ...(e.fontFamily
        ? { fontFamily: e.fontFamily as NonNullable<Branding["fontFamily"]> }
        : {}),
      x,
      y,
      width,
      height,
      fontSize: number(e.fontSize, 8, 48),
      color: String(e.color),
      align: e.align as LetterheadElement["align"],
      visible: e.visible,
    };
  }
  if (
    d.template !== undefined &&
    !BRAND_TEMPLATES.some((t) => t.id === d.template)
  )
    throw new AppError("Choose a supported branding template.");
  let textBoxes: LetterheadDesign["textBoxes"];
  if (d.textBoxes !== undefined) {
    if (!Array.isArray(d.textBoxes) || d.textBoxes.length > 12)
      throw new AppError("Use up to 12 text boxes.");
    const ids = new Set();
    textBoxes = d.textBoxes.map((v) => {
      if (!v || typeof v !== "object") throw new AppError("Invalid text box.");
      const t = v as Record<string, unknown>;
      if (
        typeof t.id !== "string" ||
        !/^[a-zA-Z0-9_-]{1,60}$/.test(t.id) ||
        ids.has(t.id) ||
        ELEMENTS.includes(t.id as (typeof ELEMENTS)[number])
      )
        throw new AppError("Invalid text box identity.");
      ids.add(t.id);
      if (typeof t.text !== "string" || t.text.length > 1000)
        throw new AppError("Text boxes support up to 1000 characters.");
      if (
        !/^#[a-f0-9]{6}$/i.test(String(t.color)) ||
        !["left", "center", "right"].includes(String(t.align)) ||
        (t.fontFamily !== undefined && !validDocumentFont(t.fontFamily))
      )
        throw new AppError("Invalid text box styling.");
      for (const key of ["bold", "italic", "underline", "visible"])
        if (t[key] !== undefined && typeof t[key] !== "boolean")
          throw new AppError("Invalid text box style.");
      const x = number(t.x, 16, PAPER.width - 36),
        y = number(t.y, 16, PAPER.height - 30),
        width = number(t.width, 20, PAPER.width - 32),
        height = number(t.height, 12, 240);
      if (
        x + width > PAPER.width - 16 + 0.02 ||
        y + height > PAPER.height - 16 + 0.02
      )
        throw new AppError("Keep text boxes inside the page.");
      return {
        id: t.id,
        text: t.text,
        x,
        y,
        width,
        height,
        fontSize: number(t.fontSize, 8, 48),
        color: String(t.color),
        align: t.align as "left" | "center" | "right",
        visible: t.visible !== false,
        bold: !!t.bold,
        italic: !!t.italic,
        underline: !!t.underline,
        ...(t.fontFamily
          ? { fontFamily: t.fontFamily as NonNullable<Branding["fontFamily"]> }
          : {}),
      };
    });
  }
  return {
    version: 1,
    ...(textBoxes ? { textBoxes } : {}),
    headerHeight,
    footerHeight,
    accent: d.accent,
    elements,
    ...(d.template ? { template: String(d.template) } : {}),
  };
}
export function brandingOf(w: Workspace): Branding {
  return {
    companyName: w.name,
    address: "",
    companyNumber: "",
    taxNumber: "",
    color: "#24543b",
    fontSize: 12,
    fontFamily: "instrument",
    footer: "",
    layout: "letterhead",
    logoPosition: "left",
    paymentInstructions: "",
    ...w.branding,
    logo: w.logo || w.branding?.logo,
  };
}
export function parseBranding(
  b: Record<string, unknown>,
  w: Workspace,
): Branding {
  const old = brandingOf(w),
    result = { ...old };
  for (const key of [
    "companyName",
    "address",
    "companyNumber",
    "taxNumber",
    "footer",
    "paymentInstructions",
  ] as const)
    result[key] = String(b[key] ?? old[key])
      .trim()
      .slice(0, key === "paymentInstructions" ? 3000 : 1000);
  if (!result.companyName)
    throw new AppError("Enter the company name for the letterhead.");
  result.color = String(b.color || old.color);
  if (!/^#[a-fA-F0-9]{6}$/.test(result.color))
    throw new AppError("Choose a valid brand colour.");
  if (b.secondaryColor !== undefined) {
    result.secondaryColor = String(b.secondaryColor);
    if (!/^#[a-f0-9]{6}$/i.test(result.secondaryColor))
      throw new AppError("Choose a valid secondary colour.");
  }
  if (b.backgroundTemplate !== undefined) {
    if (b.backgroundTemplate === null) result.backgroundTemplate = null;
    else {
      const candidate = b.backgroundTemplate as { hash?: string };
      const asset = w.templateFiles?.find((f) => f.hash === candidate?.hash);
      if (!asset)
        throw new AppError("Upload a template to this workspace first.");
      result.backgroundTemplate = asset;
    }
  }
  if (b.templateOverlay !== undefined) {
    if (typeof b.templateOverlay !== "boolean")
      throw new AppError("Invalid template overlay choice.");
    result.templateOverlay = b.templateOverlay;
  }
  result.fontSize = Number(b.fontSize ?? old.fontSize);
  for (const key of ["bodyBold", "bodyItalic"] as const) {
    if (b[key] !== undefined) {
      if (typeof b[key] !== "boolean")
        throw new AppError("Body text style must be on or off.");
      result[key] = b[key];
    }
  }
  if (b.fontFamily !== undefined) {
    if (!validDocumentFont(b.fontFamily))
      throw new AppError("Choose a supported document font.");
    result.fontFamily = b.fontFamily;
  }
  if (
    !Number.isInteger(result.fontSize) ||
    result.fontSize < 10 ||
    result.fontSize > 16
  )
    throw new AppError("Document body size must be 10–16 pt.");
  result.layout = b.layout === "minimal" ? "minimal" : "letterhead";
  result.logoPosition = b.logoPosition === "right" ? "right" : "left";
  if (b.logo !== undefined) result.logo = String(b.logo);
  if (b.design !== undefined) result.design = parseDesign(b.design);
  return result;
}
export async function validateLogo(logo: unknown): Promise<string> {
  if (!logo) return "";
  const value = String(logo);
  const m = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(value);
  if (!m) throw new AppError("Use a PNG or JPEG logo.");
  if (value.length > 400000)
    throw new AppError("Logo must be smaller than 300 KB.");
  // A corrupt image would crash invoice PDFs later, so prove it embeds now.
  try {
    const doc = await PDFDocument.create();
    const bytes = new Uint8Array(Buffer.from(m[2], "base64")); // a plain copy: pdf-lib misreads pooled Buffers
    if (m[1] === "png") await doc.embedPng(bytes);
    else await doc.embedJpg(bytes);
  } catch {
    throw new AppError("Use a PNG or JPEG logo.");
  }
  return value;
}
