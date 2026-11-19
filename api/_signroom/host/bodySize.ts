import type { VercelRequest, VercelResponse } from "@vercel/node";

/**
 * The request-size guard. The entry runs it before reading the body or the
 * sign-in, so an oversize request costs nothing.
 */

/**
 * Content-Length when the client sent a genuine one, else the size of the
 * parsed body. A forged header ("-1", "abc", ...) is never trusted: it must
 * parse to a finite, non-negative number or we fall back to measuring the
 * body ourselves, the same as when the header is absent.
 */
export function bodyBytes(req: VercelRequest): number {
  const declared = Number(req.headers["content-length"]);
  if (Number.isFinite(declared) && declared >= 0) return declared;
  if (Buffer.isBuffer(req.body)) return req.body.length;
  const raw = typeof req.body === "string" ? req.body : JSON.stringify(req.body ?? {});
  return Buffer.byteLength(raw ?? "", "utf8");
}

/** Answers 413 and returns true when the body is over `maxBytes`. */
export function refuseOversize(req: VercelRequest, res: VercelResponse, maxBytes: number, message: string): boolean {
  if (bodyBytes(req) > maxBytes) {
    res.status(413).json({ error: message });
    return true;
  }
  return false;
}
