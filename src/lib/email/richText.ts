// Pure helpers for the rich text editor. Same contract as the rest of
// src/lib/email: no Node built-ins, no Supabase, no network, no React.
//
// The editor itself is a contentEditable surface — the browser owns the
// document and produces the HTML. What lives here is the two things that are
// decisions rather than browser behaviour: what a paste is allowed to bring in
// with it, and whether the merge placeholders are still intact afterwards.

/**
 * A `{{placeholder}}` as `substitutePlaceholders` matches it: the literal
 * braces, a name, and nothing between the braces but the name.
 */
const PLACEHOLDER = /\{\{\s*([a-z0-9_]+)\s*\}\}/gi;

/**
 * Anything that looks like a placeholder whose braces have been separated by
 * markup — `{{first` … `<b>` … `name}}`.
 *
 * This is the failure the editor exists to prevent, and it is silent: the
 * substitution in substitutePlaceholders matches on literal text, so a
 * placeholder the browser split across two elements is never substituted and
 * the recipient is greeted as `{{first_name}}`.
 */
const SPLIT_PLACEHOLDER = /\{\{[^}]*<[^>]+>[^}]*\}\}/i;

/**
 * True when every `{{...}}` in this HTML is still whole.
 *
 * Used by the editor to refuse a formatting command that would break one, and
 * by Compose to warn before a campaign goes out with a broken merge field.
 */
export function placeholdersIntact(html: string): boolean {
  return !SPLIT_PLACEHOLDER.test(html);
}

/** Every placeholder name used in this HTML, lower-cased, without repeats. */
export function placeholdersUsed(html: string): string[] {
  const names = new Set<string>();
  for (const match of html.matchAll(PLACEHOLDER)) {
    names.add(match[1].toLowerCase());
  }
  return [...names];
}

/** Tags a pasted fragment may keep. Everything else becomes its text. */
const KEPT_TAGS = new Set([
  'b', 'strong', 'i', 'em', 'u', 'a', 'br', 'p', 'ul', 'ol', 'li', 'div', 'span',
]);

/**
 * What a paste is allowed to bring with it.
 *
 * Pasting from Word carries a kilobyte of `mso-` declarations, `<o:p>`
 * elements and class names referring to a stylesheet that does not exist. Mail
 * clients render that differently from each other, some spam filters score it,
 * and none of it is anything the person meant to paste.
 *
 * So: the structural tags above survive, with `href` on a link and nothing
 * else; every other tag is unwrapped to its text; `<script>` and `<style>`
 * have their CONTENTS dropped rather than unwrapped, because unwrapping a
 * style block pastes the CSS as visible text.
 *
 * This is not a security boundary — the editor's own output is written by the
 * person editing it, and the message is escaped nowhere because it is meant to
 * be HTML. It is a cleanliness boundary, and it is applied on paste rather
 * than on save so the person sees what they actually got.
 */
export function sanitizePastedHtml(html: string): string {
  let out = html;

  // Contents dropped, not unwrapped.
  out = out.replace(/<(script|style|head|title)[\s\S]*?<\/\1>/gi, '');
  // Comments, which is where Word keeps most of its conditional markup.
  out = out.replace(/<!--[\s\S]*?-->/g, '');

  out = out.replace(/<\/?([a-z0-9:]+)([^>]*)>/gi, (tag, rawName: string, attrs: string) => {
    const name = rawName.toLowerCase();
    if (!KEPT_TAGS.has(name)) return '';

    // A closing tag keeps nothing.
    if (tag.startsWith('</')) return `</${name}>`;

    if (name === 'a') {
      const href = /href\s*=\s*"([^"]*)"|href\s*=\s*'([^']*)'/i.exec(attrs);
      const url = (href?.[1] ?? href?.[2] ?? '').trim();
      // A javascript: or data: URL in a mail body is not a link anybody meant
      // to paste, and no mail client will honour it anyway.
      const safe = /^(https?:|mailto:)/i.test(url) ? url : '';
      return safe ? `<a href="${safe}">` : '<a>';
    }

    // Every other kept tag loses its attributes, which is where the `mso-`
    // styles and the dangling class names live.
    return `<${name}>`;
  });

  // Word leaves runs of non-breaking spaces behind where it had indentation.
  out = out.replace(/(&nbsp;\s*){2,}/gi, ' ');

  return out.trim();
}

/**
 * Plain text for the clipboard's `text/plain` flavour, used when the paste
 * carries no HTML at all — newlines become line breaks so pasted paragraphs
 * do not collapse into one run.
 */
export function plainTextToHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .split(/\r?\n/)
    .join('<br>');
}
