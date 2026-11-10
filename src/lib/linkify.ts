/**
 * Split plain text into text and link pieces so links typed into tasks,
 * comments and subtasks can be clicked.
 *
 * Recognises http(s):// URLs, www. addresses (opened as https://) and email
 * addresses (mailto:). Only those three schemes are ever produced, so text
 * like "javascript:..." can never become a clickable link.
 */
export type LinkSegment =
  | { type: 'text'; value: string }
  | { type: 'link'; value: string; href: string };

// URL: http(s)://… or www.… up to whitespace / angle brackets / quotes.
// Email: simple local@domain.tld.
const PATTERN =
  /\b(?:https?:\/\/|www\.)[^\s<>"'`]+|\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/gi;

const TRAILING = /[.,!?;:'"]+$/;

/** Drop trailing punctuation and closing brackets that aren't part of the URL. */
function trimUrl(raw: string): string {
  let url = raw;
  for (;;) {
    const before = url;
    url = url.replace(TRAILING, '');
    for (const [open, close] of [['(', ')'], ['[', ']'], ['{', '}']] as const) {
      while (url.endsWith(close)) {
        const opens = url.split(open).length - 1;
        const closes = url.split(close).length - 1;
        if (closes > opens) url = url.slice(0, -1);
        else break;
      }
    }
    if (url === before) return url;
  }
}

export function splitLinks(text: string): LinkSegment[] {
  if (!text) return [];
  const out: LinkSegment[] = [];
  let last = 0;
  const pushText = (value: string) => {
    if (!value) return;
    const prev = out[out.length - 1];
    if (prev && prev.type === 'text') prev.value += value;
    else out.push({ type: 'text', value });
  };

  for (const m of text.matchAll(PATTERN)) {
    const start = m.index ?? 0;
    const raw = m[0];
    const isEmail = !/^(?:https?:\/\/|www\.)/i.test(raw);
    const value = isEmail ? raw : trimUrl(raw);
    if (!value || (!isEmail && /^(?:https?:\/\/|www\.)$/i.test(value))) continue;

    pushText(text.slice(last, start));
    const href = isEmail
      ? `mailto:${value}`
      : /^www\./i.test(value)
        ? `https://${value}`
        : value;
    out.push({ type: 'link', value, href });
    last = start + value.length;
  }
  pushText(text.slice(last));
  return out;
}
