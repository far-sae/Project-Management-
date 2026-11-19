import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * Keeps the mailbox connection on the public internet. The server's name is
 * resolved once; if ANY answer is not a public unicast address the name is
 * refused, otherwise the connection is pinned to one answer (transport.ts) and
 * TLS is checked against the name, so a DNS change between this check and the
 * connection cannot reach a private network or a cloud metadata endpoint.
 */
export type LookupAddress = { address: string; family: number };
export type Lookup = (host: string) => Promise<LookupAddress[]>;
export type Resolved = { ok: true; address: string } | { ok: false; reason: "not-found" | "private"; message: string };

export const NOT_FOUND_MESSAGE = "We couldn't find that email server. Check the server name.";
export const PRIVATE_MESSAGE = "That email server isn't on the public internet, so we can't connect to it.";
/**
 * How long the name may take to resolve. 3 s of DNS plus the 18 s SMTP deadline
 * (transport.ts) keeps one send or check well inside a request.
 */
export const DNS_TIMEOUT_MS = 3_000;

function ipv4Parts(ip: string): number[] | null {
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return null;
  const p = ip.split(".").map(Number);
  return p.some((n) => n > 255) ? null : p;
}

function isPublicIPv4(ip: string): boolean {
  const p = ipv4Parts(ip);
  if (!p) return false;
  const [a, b, c] = p;
  if (a === 0 || a === 10 || a === 127) return false; // this network, private, loopback
  if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT 100.64/10 (Alibaba metadata 100.100.100.200 too)
  if (a === 169 && b === 254) return false; // link-local, incl. the 169.254.169.254 metadata endpoint
  if (a === 172 && b >= 16 && b <= 31) return false; // private
  if (a === 192 && b === 168) return false; // private
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return false; // protocol assignments, TEST-NET-1
  if (a === 192 && b === 88 && c === 99) return false; // 6to4 relay anycast
  if (a === 198 && (b === 18 || b === 19)) return false; // benchmarking
  if (a === 198 && b === 51 && c === 100) return false; // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return false; // TEST-NET-3
  if (a >= 224) return false; // multicast 224/4, reserved 240/4, broadcast
  return true;
}

/**
 * The eight 16-bit groups of an IPv6 literal (a trailing dotted IPv4 part
 * included), or null. No zone stripping here: isPublicAddress removes the zone first.
 */
function ipv6Groups(ip: string): number[] | null {
  let s = ip;
  const dotted = s.match(/^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (dotted) {
    const p = dotted[2].split(".").map(Number);
    if (p.some((n) => n > 255)) return null;
    s = `${dotted[1]}${((p[0] << 8) | p[1]).toString(16)}:${((p[2] << 8) | p[3]).toString(16)}`;
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const part = (h: string) => (h === "" ? [] : h.split(":"));
  const head = part(halves[0]);
  const tail = halves.length === 2 ? part(halves[1]) : [];
  const fill = 8 - head.length - tail.length;
  if (halves.length === 2 ? fill < 1 : fill !== 0) return null;
  const all = [...head, ...Array(halves.length === 2 ? fill : 0).fill("0"), ...tail];
  if (all.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  return all.map((g) => parseInt(g, 16));
}

function isPublicIPv6(ip: string): boolean {
  const g = ipv6Groups(ip);
  if (!g) return false;
  const v4 = (hi: number, lo: number) => isPublicIPv4(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  // ::, ::1 and IPv4-compatible ::a.b.c.d, and IPv4-mapped ::ffff:a.b.c.d: judge the IPv4 address.
  if (g.slice(0, 5).every((n) => n === 0) && (g[5] === 0 || g[5] === 0xffff)) return v4(g[6], g[7]);
  if (g[0] === 0x64 && g[1] === 0xff9b) return g.slice(2, 6).every((n) => n === 0) && v4(g[6], g[7]); // NAT64; 64:ff9b:1::/48 is local
  if (g[0] === 0x2002) return v4(g[1], g[2]); // 6to4 carries its IPv4 in groups 1-2
  if ((g[0] & 0xe000) !== 0x2000) return false; // only global unicast 2000::/3: refuses fc00::/7, fe80::/10, fec0::/10, ff00::/8, 100::/64
  if (g[0] === 0x2001 && g[1] < 0x0200) return false; // 2001::/23 protocol assignments, Teredo included
  if (g[0] === 0x2001 && g[1] === 0x0db8) return false; // documentation
  if (g[0] === 0x3fff && g[1] < 0x1000) return false; // 3fff::/20 documentation
  return true;
}

/** True only for a public unicast IPv4 or IPv6 address. Anything unreadable is refused. */
export function isPublicAddress(raw: string): boolean {
  const ip = String(raw ?? "").toLowerCase().replace(/%.*$/, "");
  const family = isIP(ip);
  if (family === 4) return isPublicIPv4(ip);
  if (family === 6) return isPublicIPv6(ip);
  return false;
}

/** One public address to connect to, preferring IPv4; refuses the name if any answer is not public. */
export async function resolvePublic(host: string, lookup: Lookup): Promise<Resolved> {
  let found: LookupAddress[];
  try {
    found = await lookup(host);
  } catch {
    return { ok: false, reason: "not-found", message: NOT_FOUND_MESSAGE };
  }
  if (!Array.isArray(found) || found.length === 0) return { ok: false, reason: "not-found", message: NOT_FOUND_MESSAGE };
  if (found.some((a) => !isPublicAddress(a.address))) return { ok: false, reason: "private", message: PRIVATE_MESSAGE };
  const pick = found.find((a) => a.family === 4) ?? found[0];
  return { ok: true, address: pick.address };
}

/** The system resolver (every A and AAAA answer), given DNS_TIMEOUT_MS. */
export const systemLookup: Lookup = (host) => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("DNS lookup timed out")), DNS_TIMEOUT_MS);
  });
  return Promise.race([dnsLookup(host, { all: true }), late]).finally(() => clearTimeout(timer));
};
