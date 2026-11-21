/**
 * The browser's connection to the automation server (/api/automation): the
 * agents that carry a lead to a project, their runs and their approvals.
 *
 * Every call carries the person's sign-in token and the workspace they are
 * working in; the server checks both on every request.
 */
import { publicMessage } from '@/lib/publicError';
import { supabase } from '@/services/supabase/config';

const BASE = '/api/automation/';
const WORKSPACE_HEADER = 'X-Workspace-Id';

export const REQUEST_FAILED_MESSAGE = 'The request could not be completed. Please try again.';
export const SIGNED_OUT_MESSAGE = 'Please sign in again.';

/** A failed call. `status` is the HTTP status; `message` is the server's own sentence when it sent one. */
export class AutomationError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'AutomationError';
  }
}

/** The sentence to show for any failure. */
export const errorSentence = (err: unknown): string =>
  publicMessage(err instanceof AutomationError ? err : null, REQUEST_FAILED_MESSAGE);

/** The HTTP status of a failed call, or 0 when it never reached the server. */
export const errorStatus = (err: unknown): number => (err instanceof AutomationError ? err.status : 0);

async function errorOf(response: Response): Promise<string | null> {
  try {
    if (!response.headers.get('content-type')?.includes('json')) return null;
    const data = await response.json();
    return typeof data?.error === 'string' && data.error.trim() ? data.error : null;
  } catch {
    return null;
  }
}

export interface AutomationClient {
  /** GET when there is no body, otherwise POST (or the method given). Resolves to the JSON reply. */
  call<T = unknown>(path: string, body?: unknown, method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'): Promise<T>;
}

/** A client for one workspace. */
export function automationClient(workspaceId: string | null): AutomationClient {
  return {
    async call<T>(path: string, body?: unknown, method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'): Promise<T> {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new AutomationError(SIGNED_OUT_MESSAGE, 401);
      const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
      if (workspaceId) headers[WORKSPACE_HEADER] = workspaceId;
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      let response: Response;
      try {
        response = await fetch(BASE + path, {
          method: method ?? (body === undefined ? 'GET' : 'POST'),
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
          credentials: 'same-origin',
          cache: 'no-store',
        });
      } catch {
        throw new AutomationError(REQUEST_FAILED_MESSAGE, 0);
      }
      if (!response.ok) throw new AutomationError((await errorOf(response)) || REQUEST_FAILED_MESSAGE, response.status);
      if (!response.headers.get('content-type')?.includes('json')) throw new AutomationError(REQUEST_FAILED_MESSAGE, response.status);
      return (await response.json()) as T;
    },
  };
}
