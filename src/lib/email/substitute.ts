// {{placeholder}} substitution. Values are HTML-escaped: a contact's name is
// untrusted input and must never inject markup into the email body.

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const TOKEN = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;

export function substitutePlaceholders(
  template: string,
  ctx: Record<string, unknown>,
): string {
  return template.replace(TOKEN, (_match, key: string) => {
    const raw = ctx[key];
    if (raw === null || raw === undefined) return '';
    return escapeHtml(String(raw));
  });
}
