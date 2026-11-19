/** Minimal stand-ins for Vercel's req/res: enough for the api/signroom handler under test. */
export type FakeRes = {
  statusCode: number;
  body: unknown;
  headers: Record<string, string>;
  sent: Uint8Array | undefined;
  status(code: number): FakeRes;
  json(body: unknown): FakeRes;
  setHeader(key: string, value: string): FakeRes;
  send(body: unknown): FakeRes;
};

export function fakeRes(): FakeRes {
  const res: FakeRes = {
    statusCode: 200,
    body: undefined,
    headers: {},
    sent: undefined,
    status(code) {
      res.statusCode = code;
      return res;
    },
    json(body) {
      res.body = body;
      return res;
    },
    setHeader(key, value) {
      res.headers[key.toLowerCase()] = value;
      return res;
    },
    send(body) {
      res.sent = body as Uint8Array;
      return res;
    },
  };
  return res;
}

/** The site the tests run as (PUBLIC_SITE_URL in the entry tests). */
export const SITE = "https://app.example.com";

export function fakeReq(over: Record<string, unknown> = {}) {
  return { method: "GET", headers: { origin: SITE }, query: {}, body: {}, ...over } as never;
}
