/**
 * The words of an email that came from outside the app (written by Claude).
 *
 * The body is saved as a campaign or a template, and a person later opens it
 * in the Email page, where it is shown as HTML in their own session. So only
 * what the page's own editor can make is kept: bold, italic, underline, links,
 * paragraphs, line breaks and lists. Every tag is written again from nothing
 * (a kept tag never keeps its own attributes), and every "<" that is not one
 * of those tags becomes plain text. Nothing a browser would run can pass.
 */

/** Far more than an email needs, and small enough that the passes below stay quick on a body made to be slow. */
export const BODY_MAX = 50_000;
export const SUBJECT_MAX = 300;

const KEPT = new Set(["b", "strong", "i", "em", "u", "a", "br", "p", "ul", "ol", "li"]);
/** Gone together with what is inside them: unwrapping these would put code or styles into the email as text. */
const WITH_CONTENT = "script|style|head|title|iframe|object|embed|svg|math|noscript|template|textarea|select";
const BLOCK_PAIR = new RegExp(`<(${WITH_CONTENT})\\b[\\s\\S]*?<\\/\\1\\s*>`, "gi");
const BLOCK_OPEN = new RegExp(`<(${WITH_CONTENT})\\b[\\s\\S]*$`, "gi");
const TAG = /<(\/?)([a-zA-Z][a-zA-Z0-9:-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;

const escapeText = (t: string): string => t.replace(/</g, "&lt;").replace(/>/g, "&gt;");
// An "&" that already starts "&amp;" is left as it is, so a link is not changed by being saved twice.
const escapeAttribute = (v: string): string => v.replace(/&(?!amp;|quot;|lt;|gt;|#39;)/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Plain text (no tags at all) as paragraphs: an empty line starts a new one. */
function fromPlainText(text: string): string {
  const safe = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return safe
    .split(/\r?\n\s*\r?\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${p.split(/\r?\n/).join("<br>")}</p>`)
    .join("");
}

export function cleanEmailHtml(input: unknown): string {
  // Characters that are not text (the database refuses some of them) are taken out first.
  // eslint-disable-next-line no-control-regex
  let src = typeof input === "string" ? input.slice(0, BODY_MAX).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "") : "";
  if (!/<\/?[a-zA-Z][^>]*>/.test(src)) return fromPlainText(src);

  // Until nothing changes: taking one block out can leave the two halves of another one touching.
  for (let before = ""; before !== src; ) {
    before = src;
    src = src.replace(BLOCK_PAIR, "").replace(BLOCK_OPEN, "").replace(/<!--[\s\S]*?-->/g, "").replace(/<!--[\s\S]*$/g, "");
  }

  let out = "";
  let last = 0;
  for (const m of src.matchAll(TAG)) {
    out += escapeText(src.slice(last, m.index));
    last = (m.index ?? 0) + m[0].length;
    const closing = m[1] === "/";
    const name = m[2].toLowerCase();
    if (KEPT.has(name)) {
      if (closing) out += name === "br" ? "" : `</${name}>`;
      else if (name === "a") {
        const href = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i.exec(m[3]);
        const url = (href?.[1] ?? href?.[2] ?? href?.[3] ?? "").trim();
        out += /^(https?:\/\/|mailto:)/i.test(url) ? `<a href="${escapeAttribute(url)}">` : "<a>";
      } else out += `<${name}>`;
    } else if (/^h[1-6]$/.test(name)) out += closing ? "</strong></p>" : "<p><strong>";
    else if ((name === "div" || name === "tr" || name === "blockquote") && closing) out += "<br>";
    // Every other tag is left out; its words stay.
  }
  out += escapeText(src.slice(last));
  return out.replace(/(<br>\s*){3,}/g, "<br><br>").trim();
}

/** The words of a body without any tags, for showing a sample. */
export function textOf(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|li|ul|ol)>/gi, "\n")
    .replace(/<li>/gi, "- ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** One line, no line breaks: a subject or a name. */
export function oneLine(input: unknown, max: number): string {
  // eslint-disable-next-line no-control-regex
  const line = (typeof input === "string" ? input : "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]+/g, "").replace(/\s+/g, " ").trim();
  // Cut by whole characters: half an emoji is not text.
  return [...line].slice(0, max).join("").trim();
}
