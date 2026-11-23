// What the Social page says about connecting accounts: what each "Connect"
// brings, and how a log-in at a platform ended when the person comes back.
import {
  CONNECT_NAME, CONNECT_OUTCOMES, isConnectKind,
  type ConnectKind, type ConnectOutcome,
} from '../../api/_social/shared/connect';

/** One line under each platform's name: what pressing Connect brings. */
export const CONNECT_BRINGS: Record<ConnectKind, string> = {
  youtube: 'Your channel, for videos and Shorts.',
  meta: 'Your Facebook Pages, and the Instagram business accounts linked to them.',
  facebook: 'Your Facebook Pages.',
  instagram: 'Your Instagram business or creator account.',
  x: 'Your X account.',
  tiktok: 'Your TikTok account, for videos.',
  linkedin: 'Your LinkedIn profile.',
};

export type ConnectReturn = { outcome: ConnectOutcome; kind: ConnectKind | null; count: number };

/** Reads how a log-in ended from the page address (?connect=done&p=youtube&n=1). Null when the address says nothing. */
export function readConnectReturn(search: string): ConnectReturn | null {
  const params = new URLSearchParams(search);
  const outcome = params.get('connect');
  if (!outcome || !(CONNECT_OUTCOMES as readonly string[]).includes(outcome)) return null;
  const kind = params.get('p');
  const count = Number(params.get('n'));
  return {
    outcome: outcome as ConnectOutcome,
    kind: isConnectKind(kind) ? kind : null,
    count: Number.isInteger(count) && count > 0 && count < 1000 ? count : 0,
  };
}

export const CONNECT_FAILED = 'The account could not be connected. Please try again.';

/**
 * Back from a log-in through the posting service. It adds its own note to the
 * page address (?provider=facebook&isSuccess=true&accountIds=...). Only whether
 * it worked is read here: the accounts themselves are asked of the server.
 */
export function readServiceReturn(search: string): { ok: boolean; accountIds: string[] } | null {
  const params = new URLSearchParams(search);
  const answer = params.get('isSuccess');
  if (answer === null) return null;
  // The accounts the log-in named, as ids only. Whose they are is checked by the server.
  const accountIds = params.getAll('accountIds').flatMap((part) => part.split(',')).map((id) => id.trim())
    .filter((id) => /^[A-Za-z0-9_-]{3,80}$/.test(id)).slice(0, 20);
  return { ok: answer.toLowerCase() === 'true', accountIds };
}

export const SERVICE_CONNECTED = 'The account is connected.';
export const SERVICE_NOT_CONNECTED = 'Nothing was connected. Press Connect to try again.';

/** The sentence for the person, and whether it is good news. */
export function connectReturnMessage(back: ConnectReturn): { ok: boolean; text: string } {
  const name = back.kind ? CONNECT_NAME[back.kind] : '';
  switch (back.outcome) {
    case 'done':
      if (back.kind === 'meta') {
        return { ok: true, text: back.count > 1 ? `${back.count} Facebook and Instagram accounts are connected.` : 'Your Facebook Page is connected.' };
      }
      return { ok: true, text: name ? `${name} is connected.` : 'The account is connected.' };
    case 'cancelled':
      return { ok: false, text: 'Nothing was connected: the log-in was cancelled.' };
    case 'expired':
      return { ok: false, text: 'That took too long. Press Connect again.' };
    case 'none':
      if (back.kind === 'meta') return { ok: false, text: 'No Facebook Page was found on that log-in. When Facebook asks, choose the Pages to use, then try again.' };
      if (back.kind === 'youtube') return { ok: false, text: 'That Google account has no YouTube channel.' };
      return { ok: false, text: CONNECT_FAILED };
    default:
      return { ok: false, text: CONNECT_FAILED };
  }
}
