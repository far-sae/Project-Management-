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

/**
 * Tags a pasted fragment may keep. Everything else is unwrapped to its text.
 *
 * `span` and `div` are deliberately NOT here. Every attribute is stripped from
 * a kept tag, so an attribute-less `<span>` carries no formatting at all — its
 * only remaining effect is to split text. And splitting text is exactly how a
 * Word paste breaks a merge field: Word emits a separate `<span>` run at every
 * spell-check and language-tag boundary, so `Hi {{first_name}},` arrives as
 * `<span>Hi {{first_</span><span>name}},</span>` and the placeholder is dead.
 * Unwrapping them rejoins the text, which is the whole point of cleaning a
 * paste from Word.
 */
const KEPT_TAGS = new Set([
  'b', 'strong', 'i', 'em', 'u', 'a', 'br', 'p', 'ul', 'ol', 'li',
]);

/**
 * Escapes a value for an HTML attribute.
 *
 * Small and local rather than imported, because this module is pure and must
 * stay free of the rest of the email library's imports.
 */
function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

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
 * It is MOSTLY a cleanliness boundary, applied on paste rather than on save so
 * the person sees what they actually got. But it is not only that, and an
 * earlier version of this comment claiming otherwise was wrong in a way worth
 * recording: pasted content is not written by the person pasting it, and what
 * they paste is saved as a template that a COLLEAGUE later opens in this same
 * editor, where `innerHTML` runs it in that colleague's session. So the
 * attribute escaping and the scheme allowlist below are load-bearing, and a
 * tag or attribute added to the kept set is a decision about somebody else's
 * browser, not about tidiness.
 */
export function sanitizePastedHtml(html: string): string {
  let out = html;

  // Contents dropped, not unwrapped: unwrapping a <style> block pastes the CSS
  // in as visible text in somebody's email.
  //
  // `</style >` with a space is legal HTML and the pattern has to allow it, and
  // an UNCLOSED block has to be dropped to the end of the input rather than
  // left behind — a fragment ending mid-`<style>` is what a partial selection
  // from a web page produces, and the old pattern let both through.
  out = out.replace(/<(script|style|head|title)\b[\s\S]*?<\/\1\s*>/gi, '');
  out = out.replace(/<(script|style|head|title)\b[\s\S]*$/gi, '');
  // Comments, which is where Word keeps most of its conditional markup.
  out = out.replace(/<!--[\s\S]*?-->/g, '');

  // The attribute part allows a quoted value to contain `>`, which `[^>]*`
  // did not: `<p title="1 > 2">` was cut at the inner bracket and the rest of
  // the attribute arrived in the message as literal text.
  out = out.replace(
    /<\/?([a-z0-9:]+)((?:"[^"]*"|'[^']*'|[^>"'])*)>/gi,
    (tag, rawName: string, attrs: string) => {
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
      // ESCAPED, not interpolated raw. A single-quoted source attribute may
      // contain a double quote — `href='https://x/?a=" onmouseover="alert(1)'`
      // is ordinary-looking markup on a web page — and writing that into a
      // double-quoted attribute closed it and injected an event handler onto
      // the anchor. The pasted body is then saved as a template, and the next
      // person to open that template in the editor runs it in their own
      // session. The link toolbar has always escaped its URL; this path did
      // not.
        return safe ? `<a href="${escapeAttribute(safe)}">` : '<a>';
      }

      // Every other kept tag loses its attributes, which is where the `mso-`
      // styles and the dangling class names live.
      return `<${name}>`;
    },
  );

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
