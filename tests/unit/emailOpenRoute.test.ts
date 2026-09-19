// Tests for api/email/open.ts — the open-tracking pixel.
//
// The spec asks for these by name, and the one bug that got furthest through
// review was in exactly the area they cover: the campaign counter was
// incremented for automatic fetches, which is the outcome the whole phase
// exists to prevent, and nothing exercised the route to notice.
//
// Two rules are being protected here and they pull in opposite directions:
//
//   * The response is ALWAYS the image. A forged token, an unknown message, a
//     database that is down, an unexpected throw — every one of them ends in
//     200 and the same 42 bytes. This URL sits inside a message in somebody's
//     customer's mailbox, and a response that is not an image is a
//     broken-image icon in that message, caused by our bookkeeping.
//   * Nothing is recorded that should not be. A bad token records nothing, and
//     an organization with tracking off records nothing — which the route
//     delegates to record_email_open(), so what is asserted here is that the
//     route calls it and passes the right arguments rather than deciding for
//     itself.

import { describe, it, expect, vi, beforeEach } from 'vitest';

import { openTokenSubject } from '@/lib/email/openTracking';
import { signUnsubscribeToken } from '@/lib/email/unsubscribe';

const SECRET = 'unsubscribe-secret';
const MESSAGE = '11111111-2222-3333-4444-555555555555';

/** Every rpc() the handler made, so a test can assert what it recorded. */
const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
/** Set by a test to make the message read fail or return nothing. */
const state = vi.hoisted(() => ({
  message: null as Record<string, unknown> | null,
  readThrows: false,
  rpcThrows: false,
  rpcError: null as { message: string } | null,
  clientThrows: false,
}));

vi.mock('../../api/_lib/context', () => ({
  env: (name: string) => {
    if (name === 'EMAIL_UNSUBSCRIBE_SECRET') return 'unsubscribe-secret';
    return 'x';
  },
  serviceClient: () => {
    if (state.clientThrows) throw new Error('no service key configured');
    return {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => {
              if (state.readThrows) throw new Error('the database went away');
              return { data: state.message, error: null };
            },
          }),
        }),
      }),
      rpc: async (name: string, args: Record<string, unknown>) => {
        rpcCalls.push({ name, args });
        if (state.rpcThrows) throw new Error('rpc exploded');
        return { data: null, error: state.rpcError };
      },
    };
  },
}));

const { default: handler } = await import('../../api/email/open');

/** A minimal VercelResponse that records what was sent. */
function makeRes() {
  const headers: Record<string, string> = {};
  const out = {
    headers,
    statusCode: 0,
    body: null as Buffer | null,
    headersSent: false,
    writableEnded: false,
    setHeader(k: string, v: string) {
      if (out.headersSent) throw new Error('ERR_HTTP_HEADERS_SENT');
      headers[k] = v;
    },
    status(code: number) {
      out.statusCode = code;
      return out;
    },
    send(body: Buffer) {
      out.headersSent = true;
      out.writableEnded = true;
      out.body = body;
      return out;
    },
  };
  return out;
}

function makeReq(over: Record<string, unknown> = {}) {
  return {
    method: 'GET',
    query: {},
    headers: {},
    ...over,
  };
}

/** Every response this route can give must be this. */
function expectPixel(res: ReturnType<typeof makeRes>) {
  expect(res.statusCode).toBe(200);
  expect(res.headers['Content-Type']).toBe('image/gif');
  expect(res.body).toBeInstanceOf(Buffer);
  expect(res.body).toHaveLength(42);
  // A cached pixel is an open that is never reported again, and Gmail's proxy
  // caches aggressively.
  expect(res.headers['Cache-Control']).toContain('no-store');
}

const run = async (req: unknown, res: unknown) =>
  (handler as unknown as (a: unknown, b: unknown) => Promise<void>)(req, res);

beforeEach(() => {
  rpcCalls.length = 0;
  state.message = { id: MESSAGE, sent_at: '2026-09-19T09:00:00Z' };
  state.readThrows = false;
  state.rpcThrows = false;
  state.rpcError = null;
  state.clientThrows = false;
});

describe('api/email/open — it always returns the image', () => {
  it('records the open and returns the pixel for a valid token', async () => {
    const token = await signUnsubscribeToken(openTokenSubject(MESSAGE), SECRET);
    const res = makeRes();

    await run(makeReq({ query: { m: MESSAGE, t: token } }), res);

    expectPixel(res);
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].name).toBe('record_email_open');
    expect(rpcCalls[0].args.p_message).toBe(MESSAGE);
  });

  it('records nothing for a forged token, and still returns the pixel', async () => {
    const res = makeRes();

    await run(makeReq({ query: { m: MESSAGE, t: 'not-a-token' } }), res);

    expectPixel(res);
    expect(rpcCalls).toHaveLength(0);
  });

  it('records nothing for a token signed for a DIFFERENT message', async () => {
    const other = await signUnsubscribeToken(openTokenSubject('some-other-id'), SECRET);
    const res = makeRes();

    await run(makeReq({ query: { m: MESSAGE, t: other } }), res);

    expectPixel(res);
    expect(rpcCalls).toHaveLength(0);
  });

  it('rejects an UNSUBSCRIBE token, which is signed over a different subject', async () => {
    // The two used to be the same string, which made a pixel URL — fetched
    // automatically, and so logged by every gateway it passes — a working
    // unsubscribe token for that recipient.
    const unsubToken = await signUnsubscribeToken(MESSAGE, SECRET);
    const res = makeRes();

    await run(makeReq({ query: { m: MESSAGE, t: unsubToken } }), res);

    expectPixel(res);
    expect(rpcCalls).toHaveLength(0);
  });

  it('returns the pixel with no parameters at all', async () => {
    const res = makeRes();
    await run(makeReq({ query: {} }), res);
    expectPixel(res);
    expect(rpcCalls).toHaveLength(0);
  });

  it('returns the pixel for an unknown message', async () => {
    state.message = null;
    const token = await signUnsubscribeToken(openTokenSubject(MESSAGE), SECRET);
    const res = makeRes();

    await run(makeReq({ query: { m: MESSAGE, t: token } }), res);

    expectPixel(res);
    expect(rpcCalls).toHaveLength(0);
  });

  it('returns the pixel when the database read throws', async () => {
    state.readThrows = true;
    const token = await signUnsubscribeToken(openTokenSubject(MESSAGE), SECRET);
    const res = makeRes();

    await run(makeReq({ query: { m: MESSAGE, t: token } }), res);

    expectPixel(res);
  });

  it('returns the pixel when recording fails', async () => {
    state.rpcError = { message: 'function does not exist' };
    const token = await signUnsubscribeToken(openTokenSubject(MESSAGE), SECRET);
    const res = makeRes();

    await run(makeReq({ query: { m: MESSAGE, t: token } }), res);

    expectPixel(res);
  });

  it('returns the pixel when recording throws', async () => {
    state.rpcThrows = true;
    const token = await signUnsubscribeToken(openTokenSubject(MESSAGE), SECRET);
    const res = makeRes();

    await run(makeReq({ query: { m: MESSAGE, t: token } }), res);

    expectPixel(res);
  });

  it('returns the pixel when the service client cannot even be built', async () => {
    // env() throws on a missing variable, and serviceClient() calls it. If
    // that throw were outside the try, a deployment missing one environment
    // variable would put a broken-image icon in every message.
    state.clientThrows = true;
    const token = await signUnsubscribeToken(openTokenSubject(MESSAGE), SECRET);
    const res = makeRes();

    await run(makeReq({ query: { m: MESSAGE, t: token } }), res);

    expectPixel(res);
  });

  it('returns the pixel for a method nobody expected, and records nothing', async () => {
    const token = await signUnsubscribeToken(openTokenSubject(MESSAGE), SECRET);
    const res = makeRes();

    await run(makeReq({ method: 'POST', query: { m: MESSAGE, t: token } }), res);

    expectPixel(res);
    expect(rpcCalls).toHaveLength(0);
  });

  it('answers HEAD without recording an open', async () => {
    // A client asking about the image is not a client rendering it.
    const token = await signUnsubscribeToken(openTokenSubject(MESSAGE), SECRET);
    const res = makeRes();

    await run(makeReq({ method: 'HEAD', query: { m: MESSAGE, t: token } }), res);

    expectPixel(res);
    expect(rpcCalls).toHaveLength(0);
  });
});

describe('api/email/open — what it says about the fetch', () => {
  it('flags a proxy user agent as automatic', async () => {
    const token = await signUnsubscribeToken(openTokenSubject(MESSAGE), SECRET);
    const res = makeRes();

    await run(
      makeReq({
        query: { m: MESSAGE, t: token },
        headers: { 'user-agent': 'Mozilla/5.0 (via ggpht.com GoogleImageProxy)' },
      }),
      res,
    );

    expect(rpcCalls[0].args.p_prefetch).toBe(true);
  });

  it('flags a fetch that arrives moments after the send as automatic', async () => {
    // Apple Mail Privacy Protection does not identify itself in the user
    // agent, so timing is the only thing that catches it — and it is the
    // largest single source of false opens there is.
    state.message = { id: MESSAGE, sent_at: new Date().toISOString() };
    const token = await signUnsubscribeToken(openTokenSubject(MESSAGE), SECRET);
    const res = makeRes();

    await run(makeReq({ query: { m: MESSAGE, t: token } }), res);

    expect(rpcCalls[0].args.p_prefetch).toBe(true);
  });

  it('does not flag an ordinary client reading the message later', async () => {
    state.message = {
      id: MESSAGE,
      sent_at: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
    };
    const token = await signUnsubscribeToken(openTokenSubject(MESSAGE), SECRET);
    const res = makeRes();

    await run(
      makeReq({
        query: { m: MESSAGE, t: token },
        headers: { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' },
      }),
      res,
    );

    expect(rpcCalls[0].args.p_prefetch).toBe(false);
  });

  it('survives a message with an unusable sent_at', async () => {
    state.message = { id: MESSAGE, sent_at: 'not a date' };
    const token = await signUnsubscribeToken(openTokenSubject(MESSAGE), SECRET);
    const res = makeRes();

    await run(makeReq({ query: { m: MESSAGE, t: token } }), res);

    expectPixel(res);
    expect(rpcCalls[0].args.p_prefetch).toBe(false);
  });
});
