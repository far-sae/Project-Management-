/**
 * When a sign-in through Supabase fails (Google, magic link, invite), Supabase
 * sends the browser back with the reason in the address — in the query string
 * or the hash: `?error=server_error&error_description=Unable+to+exchange…`.
 * These helpers read that reason and remove it from the address again.
 */

const KEYS = ['error', 'error_code', 'error_description'] as const;

function parse(part: string): URLSearchParams {
  return new URLSearchParams(part.replace(/^[?#]/, ''));
}

/** The human-readable reason a sign-in return failed, or null if there is none. */
export function readAuthReturnError(search: string, hash: string): string | null {
  for (const params of [parse(search), parse(hash)]) {
    const code = params.get('error')?.trim();
    const description = params.get('error_description')?.trim();
    if (description) return description;
    if (code) return code;
  }
  return null;
}

/** The same address without the sign-in error parts (other params are kept). */
export function stripAuthReturnError(pathname: string, search: string, hash: string): string {
  const query = parse(search);
  KEYS.forEach((k) => query.delete(k));
  const hashParams = parse(hash);
  const hashHadError = KEYS.some((k) => hashParams.has(k));
  const q = query.toString();
  return `${pathname}${q ? `?${q}` : ''}${hashHadError ? '' : hash}`;
}
