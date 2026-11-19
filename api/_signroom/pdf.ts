import fs from "node:fs";
import path from "node:path";
import { PDFArray, PDFDocument, PDFFont, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { AppError } from "./errors.js";
import type { Branding } from "./shared/types.js";
import {
  PAPER,
  templateDecorations,
  ELEMENTS,
  elementText,
  fitLetterheadText,
} from "./shared/letterhead.js";
import {
  documentFontFile,
  type DocumentFont,
  type DocumentTextStyle,
} from "./shared/documentFonts.js";

/**
 * Where the fonts are: api/_signroom/fonts. This folder is CommonJS, so the
 * module's own folder is __dirname (the compiled pdf.js sits beside fonts/ in
 * the Vercel function, which ships them through vercel.json includeFiles). If a
 * bundler ever moves this module, the function root (cwd) still has them at
 * api/_signroom/fonts. The first folder that exists wins; with neither, the
 * module's own folder is returned so the read fails naming a real path.
 */
export function fontsDir(at: { dirname?: string; cwd?: string } = {}): string {
  const beside = path.join(at.dirname ?? __dirname, "fonts");
  if (fs.existsSync(beside)) return beside;
  const fromRoot = path.join(at.cwd ?? process.cwd(), "api", "_signroom", "fonts");
  if (fs.existsSync(fromRoot)) return fromRoot;
  return beside;
}

function fontBytes(file: string): Uint8Array {
  return fs.readFileSync(path.join(fontsDir(), file));
}
export async function font(
  pdf: PDFDocument,
  family?: DocumentFont,
  style: DocumentTextStyle = {},
): Promise<PDFFont> {
  pdf.registerFontkit(fontkit);
  return pdf.embedFont(fontBytes(documentFontFile(family, style)), {
    subset: false,
    features: { liga: false, clig: false, dlig: false, calt: false },
  });
}
/** Reads a stored blob (a letterhead template) by workspace and hash. */
export type BlobLoader = (workspaceId: string, hash: string) => Promise<Uint8Array>;
export const LETTERHEAD_UNREADABLE =
  "Your letterhead PDF could not be read. Choose it again in Settings.";

export async function drawBranding(
  pdf: PDFDocument,
  brand: Branding,
  load?: BlobLoader,
): Promise<void> {
  const f = await font(pdf, brand.fontFamily);
  const fonts = new Map<string, typeof f>([
    [`${brand.fontFamily || "instrument"}:false:false`, f],
  ]);
  const hex = brand.color.replace("#", "");
  const color = rgb(
    parseInt(hex.slice(0, 2), 16) / 255,
    parseInt(hex.slice(2, 4), 16) / 255,
    parseInt(hex.slice(4, 6), 16) / 255,
  );
  let logo;
  if (brand.logo) {
    // a plain copy: pdf-lib misreads pooled Buffers
    try {
      const bytes = new Uint8Array(Buffer.from(brand.logo.split(",")[1], "base64"));
      logo = brand.logo.startsWith("data:image/png")
        ? await pdf.embedPng(bytes)
        : await pdf.embedJpg(bytes);
    } catch {
      // A logo pdf-lib can't embed (such as an old WebP) is left off; the document still renders.
      logo = undefined;
    }
  }
  const fit = (value: string, max: number, size: number) => {
    let v = value.replace(/[\r\n]/g, " ");
    while (v && f.widthOfTextAtSize(v, size) > max) v = v.slice(0, -1);
    return v;
  };
  let background = null;
  if (brand.backgroundTemplate) {
    try {
      if (!load) throw new Error("no loader");
      const { workspaceId, hash } = brand.backgroundTemplate;
      // a plain copy: pdf-lib misreads pooled Buffers
      const bytes = new Uint8Array(await load(workspaceId, hash));
      background = (await pdf.embedPdf(bytes, [0]))[0];
      // pdf-lib embeds the page lazily; do it here so an unembeddable page fails inside this try.
      await background.embed();
    } catch {
      throw new AppError(LETTERHEAD_UNREADABLE);
    }
  }
  for (const page of pdf.getPages()) {
    if (background) {
      const key = page.node.newXObject("BrandBackground", background.ref);
      const stream = pdf.context.register(
        pdf.context.flateStream(
          `q ${page.getWidth() / background.width} 0 0 ${page.getHeight() / background.height} 0 0 cm ${key.toString()} Do Q
`,
        ),
      );
      page.node.normalizedEntries();
      const contents = page.node.Contents();
      if (contents instanceof PDFArray) contents.insert(0, stream);
      else page.node.addContentStream(stream);
      if (!brand.templateOverlay) continue;
    }
    const w = page.getWidth(),
      h = page.getHeight(),
      x = 48;
    if (brand.design) {
      const d = brand.design,
        sx = w / PAPER.width,
        sy = h / PAPER.height,
        scale = Math.min(sx, sy);
      const ink = (hex: string) =>
        rgb(
          parseInt(hex.slice(1, 3), 16) / 255,
          parseInt(hex.slice(3, 5), 16) / 255,
          parseInt(hex.slice(5, 7), 16) / 255,
        );
      for (const r of templateDecorations(
        d,
        brand.color,
        brand.secondaryColor,
      )) {
        if (r.points)
          page.drawSvgPath(
            r.points
              .map((p, i) => `${i ? "L" : "M"}${p[0] * sx} ${p[1] * sy}`)
              .join(" ") + " Z",
            { x: 0, y: h, color: ink(r.color) },
          );
        else
          page.drawRectangle({
            x: r.x * sx,
            y: h - (r.y + r.height) * sy,
            width: r.width * sx,
            height: r.height * sy,
            color: ink(r.color),
          });
      }
      if (d.accent)
        page.drawRectangle({
          x: 0,
          y: h - 6 * sy,
          width: w,
          height: 6 * sy,
          color,
        });
      for (const { id, e, text: boxText } of [
        ...ELEMENTS.map((id) => ({
          id: id as string,
          e: d.elements[id],
          text: undefined as string | undefined,
        })),
        ...(d.textBoxes || []).map((e) => ({ id: e.id, e, text: e.text })),
      ]) {
        if (!e.visible) continue;
        if (id === "logo") {
          if (!logo) continue;
          const fit = Math.min(
            (e.width * sx) / logo.width,
            (e.height * sy) / logo.height,
          );
          const lw = logo.width * fit,
            lh = logo.height * fit;
          page.drawImage(logo, {
            x:
              e.x * sx +
              (e.align === "center"
                ? (e.width * sx - lw) / 2
                : e.align === "right"
                  ? e.width * sx - lw
                  : 0),
            y: h - e.y * sy - lh,
            width: lw,
            height: lh,
          });
        } else if (id === "rule") {
          page.drawRectangle({
            x: e.x * sx,
            y: h - (e.y + e.height) * sy,
            width: e.width * sx,
            height: e.height * sy,
            color: ink(e.color),
          });
        } else {
          const value =
            id === "pageNumber"
              ? `${pdf.getPages().indexOf(page) + 1} / ${pdf.getPageCount()}`
              : (boxText ??
                elementText(id as (typeof ELEMENTS)[number], brand));
          if (!value) continue;
          const family = e.fontFamily || brand.fontFamily || "instrument";
          const fontKey = `${family}:${!!e.bold}:${!!e.italic}`;
          if (!fonts.has(fontKey))
            fonts.set(fontKey, await font(pdf, family, e));
          const itemFont = fonts.get(fontKey)!;
          const fitted = fitLetterheadText(value, e, (text, size) =>
            itemFont.widthOfTextAtSize(text, size),
          );
          if (fitted.overflow)
            throw new AppError(
              `The ${id} text does not fit. Enlarge its text box or shorten the text in the document designer.`,
            );
          fitted.lines.forEach((text, n) => {
            const size = fitted.size * scale,
              tw = itemFont.widthOfTextAtSize(text, size);
            const textX =
              e.x * sx +
              (e.align === "center"
                ? (e.width * sx - tw) / 2
                : e.align === "right"
                  ? e.width * sx - tw
                  : 0);
            const textY = h - e.y * sy - size - n * fitted.size * 1.25 * sy;
            page.drawText(text, {
              x: textX,
              y: textY,
              font: itemFont,
              size,
              color: ink(e.color),
            });
            if (e.underline && text)
              page.drawLine({
                start: { x: textX, y: textY - size * 0.13 },
                end: { x: textX + tw, y: textY - size * 0.13 },
                thickness: Math.max(0.5, size * 0.055),
                color: ink(e.color),
              });
          });
        }
      }
      continue;
    }
    if (brand.layout === "letterhead")
      page.drawRectangle({ x: 0, y: h - 8, width: w, height: 8, color });
    if (logo) {
      const scale = Math.min(125 / logo.width, 46 / logo.height);
      const lw = logo.width * scale,
        lh = logo.height * scale;
      page.drawImage(logo, {
        x: brand.logoPosition === "right" ? w - 48 - lw : x,
        y: h - 68,
        width: lw,
        height: lh,
      });
    }
    const textX = logo && brand.logoPosition === "left" ? 190 : x;
    const textW =
      w - textX - 48 - (logo && brand.logoPosition === "right" ? 140 : 0);
    page.drawText(fit(brand.companyName, textW, 15), {
      x: textX,
      y: h - 42,
      font: f,
      size: 15,
      color,
    });
    if (brand.address)
      page.drawText(fit(brand.address, textW, 9), {
        x: textX,
        y: h - 59,
        font: f,
        size: 9,
        color: rgb(0.3, 0.35, 0.3),
      });
    const identifiers = [
      brand.companyNumber && "Company " + brand.companyNumber,
      brand.taxNumber && "Tax ID " + brand.taxNumber,
    ]
      .filter(Boolean)
      .join(" · ");
    if (identifiers)
      page.drawText(fit(identifiers, w - 96, 8), {
        x,
        y: h - 81,
        font: f,
        size: 8,
        color: rgb(0.3, 0.35, 0.3),
      });
    page.drawLine({
      start: { x, y: h - 95 },
      end: { x: w - 48, y: h - 95 },
      thickness: 1,
      color,
    });
    if (brand.footer)
      page.drawText(fit(brand.footer, w - 120, 8), {
        x: 48,
        y: 43,
        font: f,
        size: 8,
        color: rgb(0.35, 0.4, 0.35),
      });
  }
}
