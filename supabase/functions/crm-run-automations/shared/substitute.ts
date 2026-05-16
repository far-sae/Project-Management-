// Mustache-lite. Resolves dotted paths into the provided ctx object.
// Unknown placeholders pass through unchanged so a typo doesn't kill a run.

export interface SubstituteContext {
  deal?: { title?: string; value?: number; currency?: string; stage?: string; url?: string };
  client?: { name?: string; email?: string; industry?: string; url?: string };
  actor?: string;
  recipe?: { name?: string };
  [k: string]: unknown;
}

const PLACEHOLDER_RE = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;

const resolve = (path: string, ctx: SubstituteContext): unknown => {
  const parts = path.split(".");
  let v: any = ctx;
  for (const p of parts) {
    if (v === null || v === undefined) return undefined;
    v = v[p];
  }
  return v;
};

export const substitute = (template: string, ctx: SubstituteContext): string =>
  template.replace(PLACEHOLDER_RE, (full, path) => {
    const v = resolve(path, ctx);
    return v === undefined || v === null ? full : String(v);
  });
