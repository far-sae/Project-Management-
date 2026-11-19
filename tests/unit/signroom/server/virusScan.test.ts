// @vitest-environment node
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  scanPdf,
  SCAN_OFF_MESSAGE,
  SCAN_DOWN_MESSAGE,
  SCAN_DIRTY_MESSAGE,
} from "../../../../api/_signroom/virusScan";

const bytes = new Uint8Array([37, 80, 68, 70, 45, 49, 46, 55]);
const json = (body: string, status = 200) =>
  new Response(body, { status, headers: { "content-type": "application/json" } });

afterEach(() => vi.restoreAllMocks());

describe("scanPdf", () => {
  it("refuses with 503 when the key is unset, without calling fetch", async () => {
    const fetch = vi.fn();
    for (const apiKey of [undefined, ""]) {
      await expect(scanPdf(bytes, { fetch: fetch as never, apiKey })).rejects.toMatchObject({
        message: SCAN_OFF_MESSAGE,
        status: 503,
      });
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it("accepts a clean result and sends the Cloudmersive request", async () => {
    const fetch = vi.fn().mockResolvedValue(json('{"CleanResult":true}'));
    const r = await scanPdf(bytes, { fetch: fetch as never, apiKey: "k1" });
    expect(r).toMatchObject({ engine: "Cloudmersive", verdict: "clean" });
    expect(typeof r.scannedAt).toBe("string");
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("https://api.cloudmersive.com/virus/scan/file/advanced");
    expect(init.method).toBe("POST");
    expect(init.headers.Apikey).toBe("k1");
    expect(init.headers.restrictFileTypes).toBe(".pdf");
    expect(init.headers.fileName).toBe("letterhead.pdf");
    expect(init.body).toBeInstanceOf(FormData);
    const file = init.body.get("inputFile") as Blob;
    expect(file.size).toBe(bytes.length);
  });

  it("rejects an infected file with 422", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        json('{"CleanResult":false,"FoundViruses":[{"FileName":"x","VirusName":"EICAR"}]}'),
      );
    await expect(scanPdf(bytes, { fetch: fetch as never, apiKey: "k" })).rejects.toMatchObject({
      message: SCAN_DIRTY_MESSAGE,
      status: 422,
    });
  });

  it("fails closed on a 500, a network error and bad JSON", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const cases = [
      vi.fn().mockResolvedValue(json("oops", 500)),
      vi.fn().mockRejectedValue(new Error("boom")),
      vi.fn().mockResolvedValue(json("not json")),
    ];
    for (const fetch of cases) {
      await expect(scanPdf(bytes, { fetch: fetch as never, apiKey: "k" })).rejects.toMatchObject({
        message: SCAN_DOWN_MESSAGE,
        status: 503,
      });
    }
  });

  it("fails closed when CleanResult is missing", async () => {
    const fetch = vi.fn().mockResolvedValue(json("{}"));
    await expect(scanPdf(bytes, { fetch: fetch as never, apiKey: "k" })).rejects.toMatchObject({
      status: 422,
    });
  });

  it("times out", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fetch = vi.fn(
      (_u: string, init: RequestInit) =>
        new Promise((_res, rej) =>
          init.signal?.addEventListener("abort", () => rej(new Error("aborted"))),
        ),
    );
    await expect(
      scanPdf(bytes, { fetch: fetch as never, apiKey: "k", timeoutMs: 20 }),
    ).rejects.toMatchObject({ message: SCAN_DOWN_MESSAGE, status: 503 });
  });
});

describe("scanPdf options", () => {
  it("names the file in the form part and the header; the default is still letterhead.pdf", async () => {
    const fetch = vi.fn().mockImplementation(async () => json('{"CleanResult":true}'));
    await scanPdf(bytes, { fetch: fetch as never, apiKey: "k" }, { fileName: "agreement.pdf" });
    let [, init] = fetch.mock.calls[0];
    expect(init.headers.fileName).toBe("agreement.pdf");
    expect((init.body.get("inputFile") as File).name).toBe("agreement.pdf");
    await scanPdf(bytes, { fetch: fetch as never, apiKey: "k" });
    [, init] = fetch.mock.calls[1];
    expect(init.headers.fileName).toBe("letterhead.pdf");
    expect((init.body.get("inputFile") as File).name).toBe("letterhead.pdf");
  });

  it("refuses an unset key with the caller's sentence", async () => {
    const fetch = vi.fn();
    await expect(scanPdf(bytes, { fetch: fetch as never, apiKey: undefined }, { offMessage: "Off." })).rejects.toMatchObject({
      message: "Off.",
      status: 503,
    });
    expect(fetch).not.toHaveBeenCalled();
  });
});
