/**
 * The browser's side of "Connect": ask the server which platforms can be
 * connected, and where to send the person to log in. The platforms' keys never
 * reach the browser; the server trades the log-in for them and stores them.
 */
import { supabase } from '@/services/supabase/config';
import type { ConnectKind, ConnectSetup } from '../../../api/_social/shared/connect';

export const CONNECT_FAILED_MESSAGE = 'The account could not be connected. Please try again.';
const SIGNED_OUT_MESSAGE = 'Please sign in again.';

async function call<T>(route: 'setup' | 'start' | 'sync' | 'found' | 'choose' | 'disconnect', body?: unknown): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error(SIGNED_OUT_MESSAGE);
  const response = await fetch(`/api/social/connect/${route}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const answer = (await response.json().catch(() => ({}))) as T & { error?: string };
  // The server's own sentence when it sent one ("Only an owner or admin can connect a social account.").
  if (!response.ok) throw new Error(typeof answer.error === 'string' && answer.error ? answer.error : CONNECT_FAILED_MESSAGE);
  return answer;
}

/** Which platforms can be connected on this site. */
export const socialConnectSetup = (): Promise<ConnectSetup> => call<ConnectSetup>('setup');

/** The platform's log-in address for connecting an account to this workspace. */
export const startSocialConnect = async (kind: ConnectKind, organizationId: string, workspaceId: string): Promise<string> => {
  const { url } = await call<{ url?: string }>('start', { kind, organizationId, workspaceId });
  if (!url) throw new Error(CONNECT_FAILED_MESSAGE);
  return url;
};

/**
 * After a log-in through the posting service: brings the workspace's accounts
 * into our list. Answers how many accounts the workspace has there.
 */
export const syncSocialAccounts = async (organizationId: string, workspaceId: string, accountIds: string[] = []): Promise<number> => {
  const { connected } = await call<{ connected?: number }>('sync', { organizationId, workspaceId, ...(accountIds.length ? { accountIds } : {}) });
  return typeof connected === 'number' ? connected : 0;
};

/** An account a log-in brought, and whether it is in the list already. */
export type FoundSocialAccount = { serviceId: string; provider: string; name: string; added: boolean };

/** What the posting service holds for this workspace after a log-in. Nothing is added by asking. */
export const foundSocialAccounts = async (organizationId: string, workspaceId: string, accountIds: string[] = []): Promise<FoundSocialAccount[]> => {
  const { accounts } = await call<{ accounts?: FoundSocialAccount[] }>('found', { organizationId, workspaceId, ...(accountIds.length ? { accountIds } : {}) });
  return Array.isArray(accounts) ? accounts : [];
};

/** Adds the chosen accounts; the others are let go at the service. Answers how many were added. */
export const chooseSocialAccounts = async (organizationId: string, workspaceId: string, add: string[], drop: string[]): Promise<number> => {
  const { connected } = await call<{ connected?: number }>('choose', { organizationId, workspaceId, add, drop });
  return typeof connected === 'number' ? connected : 0;
};

/** Takes one account out of the list, and tells the platform's side to let it go. */
export const disconnectSocialAccount = async (organizationId: string, workspaceId: string, accountId: string): Promise<void> => {
  await call<{ ok?: boolean }>('disconnect', { organizationId, workspaceId, accountId });
};
