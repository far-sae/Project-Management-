export const DOCUMENT_FONTS = [
  {
    id: "instrument",
    label: "Instrument Sans",
    css: "DocumentInstrument",
    file: "DocumentInstrumentSans.ttf",
  },
  { id: "inter", label: "Inter", css: "DocumentInter", file: "Inter.ttf" },
  { id: "lora", label: "Lora", css: "DocumentLora", file: "Lora.ttf" },
  {
    id: "source-serif",
    label: "Source Serif 4",
    css: "DocumentSourceSerif",
    file: "SourceSerif4.ttf",
  },
  {
    id: "mono",
    label: "Roboto Mono",
    css: "DocumentMono",
    file: "RobotoMono.ttf",
  },
] as const;
export type DocumentFont = (typeof DOCUMENT_FONTS)[number]["id"];
export type DocumentTextStyle = {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
};
export function documentFont(id?: string) {
  return DOCUMENT_FONTS.find((f) => f.id === id) || DOCUMENT_FONTS[0];
}
export function validDocumentFont(value: unknown): value is DocumentFont {
  return DOCUMENT_FONTS.some((f) => f.id === value);
}
export function documentFontFile(
  id?: DocumentFont,
  style: DocumentTextStyle = {},
) {
  const file = documentFont(id).file;
  const variant = style.bold
    ? style.italic
      ? "BoldItalic"
      : "Bold"
    : style.italic
      ? "Italic"
      : "";
  return variant ? file.replace(/\.ttf$/, `-${variant}.ttf`) : file;
}
