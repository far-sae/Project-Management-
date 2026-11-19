// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { DNS_TIMEOUT_MS, isPublicAddress, NOT_FOUND_MESSAGE, PRIVATE_MESSAGE, resolvePublic, systemLookup } from "../../../../api/_signroom/mailbox/ssrf";

const dns = vi.hoisted(() => ({ lookup: vi.fn() }));
vi.mock("node:dns/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:dns/promises")>();
  return { ...actual, default: { ...actual, lookup: dns.lookup }, lookup: dns.lookup };
});

describe("isPublicAddress", () => {
  it.each([
    "8.8.8.8", "142.250.27.108", "52.97.0.1",
    // just outside the private and CGNAT ranges
    "172.15.255.255", "172.32.0.1", "100.63.255.255", "100.128.0.1", "192.169.0.1",
    "2a00:1450:4009:81f::200e", "2606:4700::6810:84e5", "::ffff:8.8.8.8", "::ffff:808:808", "2002:808:808::1",
  ])("allows the public address %s", (ip) => {
    expect(isPublicAddress(ip)).toBe(true);
  });

  it.each([
    // IPv4: this network, private, loopback, CGNAT (incl. Alibaba metadata), link-local (incl. cloud metadata)
    "0.0.0.0", "10.0.0.1", "10.255.255.255", "127.0.0.1", "172.16.0.1", "172.31.255.255", "192.168.1.1",
    "100.64.0.1", "100.100.100.200", "100.127.255.255", "169.254.169.254", "169.254.0.1",
    // IPv4: documentation, benchmarking, protocol assignments, 6to4 relay, multicast, reserved, broadcast
    "192.0.0.8", "192.0.2.1", "198.51.100.7", "203.0.113.9", "198.18.0.1", "198.19.255.255", "192.88.99.1",
    "224.0.0.1", "239.255.255.250", "240.0.0.1", "255.255.255.255",
    // IPv6: unspecified, loopback, IPv4-mapped/compatible private (dotted and hex), NAT64, 6to4 of private
    "::", "::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:169.254.169.254", "::ffff:10.0.0.1", "::10.0.0.1",
    "64:ff9b::a00:1", "64:ff9b:1::1", "2002:a00:1::1",
    // IPv6: unique-local (incl. AWS metadata fd00:ec2::254), link-local (with a zone), site-local, multicast,
    // discard, documentation, Teredo / protocol assignments, and anything outside 2000::/3
    "fc00::1", "fd00:ec2::254", "fe80::1", "fe80::1%eth0", "fec0::1", "ff02::1", "100::1", "2001:db8::1", "3fff::1",
    "2001::1", "2001:0:4136:e378::1", "4000::1",
    // not an address at all
    "not-an-ip", "", "1.2.3", "1.2.3.256", "[::1]",
    // odd textual forms of private addresses: octal, short, integer, hex and zero-padded IPv4 (never read as
    // public); IPv4-mapped with an octal part, IPv4-translated, IPv4-compatible in hex; upper-case IPv6; and
    // the mapped form written out in full
    "010.0.0.1", "0177.0.0.1", "127.1", "2130706433", "0x7f000001", "127.000.000.001",
    "::ffff:010.0.0.1", "::ffff:0:7f00:1", "::a00:1", "FE80::1", "::FFFF:7F00:1", "0:0:0:0:0:ffff:7f00:1",
  ])("refuses %s", (ip) => {
    expect(isPublicAddress(ip)).toBe(false);
  });
});

describe("resolvePublic", () => {
  it("picks the first IPv4 address when every answer is public", async () => {
    const lookup = vi.fn(async () => [{ address: "2a00:1450:4009:81f::200e", family: 6 }, { address: "142.250.27.108", family: 4 }]);
    expect(await resolvePublic("smtp.gmail.com", lookup)).toEqual({ ok: true, address: "142.250.27.108" });
    expect(lookup).toHaveBeenCalledWith("smtp.gmail.com");
  });

  it("uses an IPv6-only server over IPv6", async () => {
    expect(await resolvePublic("smtp.v6.example-mail.net", async () => [{ address: "2a00:1450:4009:81f::200e", family: 6 }])).toEqual({
      ok: true, address: "2a00:1450:4009:81f::200e",
    });
  });

  it("refuses the whole name when any answer is private (a rebinding name with one public and one private address)", async () => {
    const lookup = async () => [{ address: "8.8.8.8", family: 4 }, { address: "10.0.0.5", family: 4 }];
    expect(await resolvePublic("mixed.example-mail.net", lookup)).toEqual({ ok: false, reason: "private", message: PRIVATE_MESSAGE });
    expect(await resolvePublic("meta.example-mail.net", async () => [{ address: "169.254.169.254", family: 4 }])).toMatchObject({ reason: "private" });
  });

  it("a name with no answers, or a failed lookup, is not found", async () => {
    expect(await resolvePublic("nothing.example-mail.net", async () => [])).toEqual({ ok: false, reason: "not-found", message: NOT_FOUND_MESSAGE });
    expect(await resolvePublic("broken.example-mail.net", async () => { throw new Error("ENOTFOUND"); })).toMatchObject({ reason: "not-found" });
  });
});

describe("systemLookup", () => {
  afterEach(() => {
    vi.useRealTimers();
    dns.lookup.mockReset();
  });

  it("asks the system resolver for every A and AAAA answer", async () => {
    dns.lookup.mockResolvedValue([{ address: "142.250.27.108", family: 4 }]);
    expect(await systemLookup("smtp.gmail.com")).toEqual([{ address: "142.250.27.108", family: 4 }]);
    expect(dns.lookup).toHaveBeenCalledWith("smtp.gmail.com", { all: true });
  });

  it("gives up after 3 seconds, so DNS and SMTP together fit the function's 30", async () => {
    expect(DNS_TIMEOUT_MS).toBe(3_000);
    vi.useFakeTimers();
    dns.lookup.mockReturnValue(new Promise(() => {}));
    const settled = vi.fn();
    const pending = systemLookup("slow.example-mail.net").then(settled, settled);
    await vi.advanceTimersByTimeAsync(2_999);
    expect(settled).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(settled).toHaveBeenCalledWith(expect.objectContaining({ message: "DNS lookup timed out" }));
  });

  it("a timed-out lookup reads as 'not found'", async () => {
    vi.useFakeTimers();
    dns.lookup.mockReturnValue(new Promise(() => {}));
    const result = resolvePublic("slow.example-mail.net", systemLookup);
    await vi.advanceTimersByTimeAsync(DNS_TIMEOUT_MS);
    expect(await result).toEqual({ ok: false, reason: "not-found", message: NOT_FOUND_MESSAGE });
  });
});
