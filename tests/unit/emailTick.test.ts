// Tests for api/email/tick.ts — the code that actually puts mail on the wire.
//
// Everything below the handler is stubbed: `serviceClient` from
// api/_lib/context (so no Supabase client is ever constructed) and
// `nodemailer.createTransport` (so no socket is ever opened). `env` and
// `secretEquals` stay real, because the point of the first test is that the
// handler refuses to claim anything when an env var is missing.
//
// The encryption is real too: the fake `email_account_secrets` row holds a
// genuine ciphertext produced by api/_lib/crypto, so the decrypt path in the
// worker is exercised rather than mocked away.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { encryptSecret } from '../../api/_lib/crypto';

const { createTransportMock, sendMailMock, closeMock, serviceClientMock } = vi.hoisted(() => ({
  createTransportMock: vi.fn(),
  sendMailMock: vi.fn(),
  closeMock: vi.fn(),
  serviceClientMock: vi.fn(),
}));

vi.mock('nodemailer', () => ({
  default: { createTransport: createTransportMock },
  createTransport: createTransportMock,
}));

vi.mock('../../api/_lib/context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/_lib/context')>();
  return { ...actual, serviceClient: serviceClientMock };
});

import handler from '../../api/email/tick';

// A real 32-byte base64url key, so encryptSecret/decryptSecret both work.
const KEY = 'Zm9vYmFyZm9vYmFyZm9vYmFyZm9vYmFyMDEyMzQ1Njc';
const WORKER_SECRET = 'worker-secret-value';

const ACCOUNT = {
  id: 'acct-1',
  organization_id: 'org-1',
  from_name: 'Ada Lovelace',
  from_email: 'ada@example.com',
  reply_to: null,
  smtp_host: 'smtp.example.com',
  smtp_port: 587,
  smtp_secure: false,
  smtp_username: 'ada',
};

const CAMPAIGN = {
  id: 'camp-1',
  organization_id: 'org-1',
  account_id: 'acct-1',
  kind: 'bulk',
  subject: 'Hello {{first_name}}',
  body_html: '<p>Hi {{first_name}}</p>',
};

function claimedRow(n: number, overrides: Record<string, unknown> = {}) {
  return {
    message_id: `msg-${n}`,
    campaign_id: 'camp-1',
    organization_id: 'org-1',
    to_email: `r${n}@example.com`,
    to_name: `Recipient ${n}`,
    merge_data: { first_name: `R${n}` },
    attempts: 1,
    ...overrides,
  };
}

interface Recorded {
  table: string;
  id: string;
  patch: Record<string, unknown>;
}

interface DbOptions {
  claimed?: Record<string, unknown>[];
  claimError?: { message: string } | null;
  account?: Record<string, unknown> | null;
  secretEncrypted?: string | null;
  /** Returns an error for a message update, or null to let it succeed. */
  messageUpdateError?: (
    id: string,
    patch: Record<string, unknown>,
    call: number,
  ) => { message: string } | null;
}

/** Minimal stand-in for the PostgREST builder shapes tick.ts actually uses. */
function makeDb(opts: DbOptions) {
  const updates: Recorded[] = [];
  const rpcCalls: string[] = [];
  let messageUpdateCall = 0;

  const db = {
    updates,
    rpcCalls,
    rpc: vi.fn(async (fn: string) => {
      rpcCalls.push(fn);
      if (fn === 'claim_email_batch') {
        if (opts.claimError) return { data: null, error: opts.claimError };
        return { data: opts.claimed ?? [], error: null };
      }
      return { data: null, error: null };
    }),
    from: (table: string) => {
      if (table === 'email_campaigns') {
        return { select: () => ({ in: async () => ({ data: [CAMPAIGN], error: null }) }) };
      }
      if (table === 'email_accounts') {
        return {
          select: () => ({
            eq: () => ({
              single: async () =>
                opts.account === null
                  ? { data: null, error: { message: 'Sending account not found' } }
                  : { data: opts.account ?? ACCOUNT, error: null },
            }),
          }),
          update: (patch: Record<string, unknown>) => ({
            eq: async (_column: string, id: string) => {
              updates.push({ table, id, patch });
              return { error: null };
            },
          }),
        };
      }
      if (table === 'email_account_secrets') {
        return {
          select: () => ({
            eq: () => ({
              single: async () =>
                opts.secretEncrypted
                  ? { data: { secret_encrypted: opts.secretEncrypted }, error: null }
                  : { data: null, error: { message: 'Sending account has no stored password' } },
            }),
          }),
        };
      }
      if (table === 'email_messages') {
        return {
          update: (patch: Record<string, unknown>) => ({
            eq: async (_column: string, id: string) => {
              updates.push({ table, id, patch });
              messageUpdateCall++;
              const error = opts.messageUpdateError?.(id, patch, messageUpdateCall) ?? null;
              return { error };
            },
          }),
        };
      }
      throw new Error(`Unexpected table in test: ${table}`);
    },
  };
  return db;
}

function makeReq(headers: Record<string, string> = { 'x-worker-secret': WORKER_SECRET }) {
  return { method: 'POST', headers, query: {}, body: {} } as any;
}

function makeRes() {
  const res: any = { statusCode: 0, body: undefined, headers: {} as Record<string, string> };
  res.status = (code: number) => {
    res.statusCode = code;
    return res;
  };
  res.json = (body: unknown) => {
    res.body = body;
    return res;
  };
  res.send = (body: unknown) => {
    res.body = body;
    return res;
  };
  res.setHeader = (k: string, v: string) => {
    res.headers[k] = v;
    return res;
  };
  return res;
}

/** Message-row updates only, in the order the worker wrote them. */
const messagePatches = (db: ReturnType<typeof makeDb>) =>
  db.updates.filter((u) => u.table === 'email_messages');

let secretEncrypted = '';

beforeEach(async () => {
  vi.clearAllMocks();
  process.env.EMAIL_WORKER_SECRET = WORKER_SECRET;
  process.env.INTEGRATION_TOKEN_KEY = KEY;
  process.env.EMAIL_UNSUBSCRIBE_SECRET = 'unsub-secret';
  process.env.PUBLIC_SITE_URL = 'https://app.example.com/';
  if (!secretEncrypted) secretEncrypted = await encryptSecret('hunter2', KEY);
  sendMailMock.mockResolvedValue({ messageId: '<abc@smtp>' });
  createTransportMock.mockReturnValue({ sendMail: sendMailMock, close: closeMock });
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('api/email/tick — configuration', () => {
  it('returns 500 and claims nothing when a required env var is missing', async () => {
    delete process.env.INTEGRATION_TOKEN_KEY;
    const db = makeDb({ claimed: [claimedRow(1)], secretEncrypted });
    serviceClientMock.mockReturnValue(db);

    const res = makeRes();
    await handler(makeReq(), res);

    expect(res.statusCode).toBe(500);
    expect(String(res.body.error)).toContain('INTEGRATION_TOKEN_KEY');
    // Nothing claimed, nothing sent, nothing written back.
    expect(db.rpcCalls).toEqual([]);
    expect(sendMailMock).not.toHaveBeenCalled();
    expect(db.updates).toEqual([]);
  });

  it('never echoes the value of a configured secret in the error', async () => {
    delete process.env.EMAIL_UNSUBSCRIBE_SECRET;
    const db = makeDb({ claimed: [claimedRow(1)], secretEncrypted });
    serviceClientMock.mockReturnValue(db);

    const res = makeRes();
    await handler(makeReq(), res);

    expect(res.statusCode).toBe(500);
    expect(String(res.body.error)).not.toContain(WORKER_SECRET);
    expect(String(res.body.error)).not.toContain(KEY);
  });

  it('rejects a wrong worker secret before claiming', async () => {
    const db = makeDb({ claimed: [claimedRow(1)], secretEncrypted });
    serviceClientMock.mockReturnValue(db);

    const res = makeRes();
    await handler(makeReq({ 'x-worker-secret': 'not-the-secret' }), res);

    expect(res.statusCode).toBe(401);
    expect(db.rpcCalls).toEqual([]);
  });
});

describe('api/email/tick — a successful send', () => {
  it('marks the row sent and records the provider message id', async () => {
    const db = makeDb({ claimed: [claimedRow(1)], secretEncrypted });
    serviceClientMock.mockReturnValue(db);

    const res = makeRes();
    await handler(makeReq(), res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ sent: 1, failed: 0, requeued: 0, unconfirmed: 0 });

    const patches = messagePatches(db);
    expect(patches).toHaveLength(1);
    expect(patches[0]).toMatchObject({
      id: 'msg-1',
      patch: { status: 'sent', provider_message_id: '<abc@smtp>', last_error: null },
    });
    expect(closeMock).toHaveBeenCalled();
  });

  it('hands nodemailer address objects, not interpolated "name" <email> strings', async () => {
    const db = makeDb({
      // A display name carrying a quote is the injection this guards against.
      claimed: [claimedRow(1, { to_name: 'Eve", evil@attacker.test, "' })],
      secretEncrypted,
    });
    serviceClientMock.mockReturnValue(db);

    await handler(makeReq(), makeRes());

    const mail = sendMailMock.mock.calls[0][0];
    expect(mail.to).toEqual({ name: 'Eve", evil@attacker.test, "', address: 'r1@example.com' });
    expect(mail.from).toEqual({ name: 'Ada Lovelace', address: 'ada@example.com' });
  });

  it('rolls the campaign counters up through finalize_email_campaigns', async () => {
    const db = makeDb({ claimed: [claimedRow(1)], secretEncrypted });
    serviceClientMock.mockReturnValue(db);

    await handler(makeReq(), makeRes());

    expect(db.rpcCalls).toEqual(['claim_email_batch', 'finalize_email_campaigns']);
  });

  it('still finalizes on the tick that claimed nothing', async () => {
    const db = makeDb({ claimed: [], secretEncrypted });
    serviceClientMock.mockReturnValue(db);

    const res = makeRes();
    await handler(makeReq(), res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ claimed: 0, sent: 0 });
    expect(db.rpcCalls).toEqual(['claim_email_batch', 'finalize_email_campaigns']);
  });
});

describe('api/email/tick — SMTP failures', () => {
  it('a 5xx flags the account and returns its rows to queued rather than failing them', async () => {
    const db = makeDb({ claimed: [claimedRow(1), claimedRow(2)], secretEncrypted });
    serviceClientMock.mockReturnValue(db);
    sendMailMock.mockRejectedValue(
      Object.assign(new Error('550 Relay access denied'), { responseCode: 550 }),
    );

    const res = makeRes();
    await handler(makeReq(), res);

    // The credential is dead, so the account is flagged...
    const accountPatches = db.updates.filter((u) => u.table === 'email_accounts');
    expect(accountPatches).toHaveLength(1);
    expect(accountPatches[0]).toMatchObject({ id: 'acct-1', patch: { status: 'error' } });
    expect(String(accountPatches[0].patch.last_error)).toContain('Relay access denied');

    // ...and the outbox is not burned to 'failed'.
    const patches = messagePatches(db);
    expect(patches).toHaveLength(2);
    for (const p of patches) {
      expect(p.patch.status).toBe('queued');
      // The claim's attempts increment is undone: the recipients did not
      // spend a retry on the account's broken password.
      expect(p.patch.attempts).toBe(0);
    }
    expect(patches.map((p) => p.id)).toEqual(['msg-1', 'msg-2']);
    expect(res.body).toMatchObject({ failed: 0, requeued: 2, accountsDisabled: 1 });

    // The account's remaining rows are skipped for this tick.
    expect(sendMailMock).toHaveBeenCalledTimes(1);
  });

  it('a 4xx leaves the row queued for retry and does not flag the account', async () => {
    const db = makeDb({ claimed: [claimedRow(1)], secretEncrypted });
    serviceClientMock.mockReturnValue(db);
    sendMailMock.mockRejectedValue(
      Object.assign(new Error('451 Try again later'), { responseCode: 451 }),
    );

    const res = makeRes();
    await handler(makeReq(), res);

    const patches = messagePatches(db);
    expect(patches).toHaveLength(1);
    expect(patches[0].patch).toMatchObject({ status: 'queued', claimed_at: null });
    // A transient failure does spend one of the three attempts, so it is not
    // handed back the way an account-level failure is.
    expect(patches[0].patch.attempts).toBeUndefined();
    expect(db.updates.filter((u) => u.table === 'email_accounts')).toEqual([]);
    expect(res.body).toMatchObject({ sent: 0, failed: 0, requeued: 1, accountsDisabled: 0 });
  });

  it('gives up on a row that has already spent its three attempts', async () => {
    const db = makeDb({ claimed: [claimedRow(1, { attempts: 3 })], secretEncrypted });
    serviceClientMock.mockReturnValue(db);
    sendMailMock.mockRejectedValue(
      Object.assign(new Error('451 Try again later'), { responseCode: 451 }),
    );

    const res = makeRes();
    await handler(makeReq(), res);

    expect(messagePatches(db)[0].patch).toMatchObject({ status: 'failed' });
    expect(res.body).toMatchObject({ failed: 1, requeued: 0 });
  });
});

describe('api/email/tick — a broken sending account', () => {
  it('flags the account and requeues when there is no stored secret', async () => {
    const db = makeDb({ claimed: [claimedRow(1)], secretEncrypted: null });
    serviceClientMock.mockReturnValue(db);

    const res = makeRes();
    await handler(makeReq(), res);

    expect(sendMailMock).not.toHaveBeenCalled();
    expect(db.updates.filter((u) => u.table === 'email_accounts')[0]).toMatchObject({
      patch: { status: 'error' },
    });
    expect(messagePatches(db)[0].patch).toMatchObject({ status: 'queued', attempts: 0 });
    expect(res.body).toMatchObject({ failed: 0, requeued: 1, accountsDisabled: 1 });
  });

  it('flags the account and requeues when the account row is gone', async () => {
    const db = makeDb({ claimed: [claimedRow(1)], account: null, secretEncrypted });
    serviceClientMock.mockReturnValue(db);

    const res = makeRes();
    await handler(makeReq(), res);

    expect(sendMailMock).not.toHaveBeenCalled();
    expect(messagePatches(db)[0].patch).toMatchObject({ status: 'queued' });
    expect(res.body).toMatchObject({ failed: 0, requeued: 1, accountsDisabled: 1 });
  });

  it('flags the account and requeues when the stored secret will not decrypt', async () => {
    const db = makeDb({ claimed: [claimedRow(1)], secretEncrypted: 'not-a-valid-ciphertext' });
    serviceClientMock.mockReturnValue(db);

    const res = makeRes();
    await handler(makeReq(), res);

    expect(sendMailMock).not.toHaveBeenCalled();
    expect(messagePatches(db)[0].patch).toMatchObject({ status: 'queued' });
    expect(res.body).toMatchObject({ failed: 0, requeued: 1, accountsDisabled: 1 });
  });
});

describe('api/email/tick — a delivered message whose write-back fails', () => {
  it('never returns the row to queued, and reports it as unconfirmed', async () => {
    const db = makeDb({
      claimed: [claimedRow(1)],
      secretEncrypted,
      // Both the write and its one retry fail; only the final "record the
      // provider id" patch is allowed through.
      messageUpdateError: (_id, patch) =>
        patch.status === 'sent' ? { message: 'connection reset' } : null,
    });
    serviceClientMock.mockReturnValue(db);

    const res = makeRes();
    await handler(makeReq(), res);

    expect(sendMailMock).toHaveBeenCalledTimes(1);

    const patches = messagePatches(db);
    // Attempted twice, then the provider id is recorded on its own.
    expect(patches).toHaveLength(3);
    expect(patches[0].patch.status).toBe('sent');
    expect(patches[1].patch.status).toBe('sent');
    expect(patches[2].patch).toMatchObject({ provider_message_id: '<abc@smtp>' });
    expect(patches[2].patch.status).toBeUndefined();

    // The whole point: a delivered message is never handed back to the queue.
    for (const p of patches) expect(p.patch.status).not.toBe('queued');

    expect(res.body).toMatchObject({ sent: 0, failed: 0, requeued: 0, unconfirmed: 1 });
    expect(res.body.updateErrors).toBeGreaterThan(0);
  });

  it('retries the write-back once and counts the row as sent when the retry works', async () => {
    const db = makeDb({
      claimed: [claimedRow(1)],
      secretEncrypted,
      messageUpdateError: (_id, _patch, call) => (call === 1 ? { message: 'transient' } : null),
    });
    serviceClientMock.mockReturnValue(db);

    const res = makeRes();
    await handler(makeReq(), res);

    expect(messagePatches(db)).toHaveLength(2);
    expect(res.body).toMatchObject({ sent: 1, unconfirmed: 0 });
  });
});
