import { AppError } from "./errors.js";

export const SCAN_OFF_MESSAGE =
  "Letterhead uploads are not switched on yet: the virus check is not set up.";
export const SCAN_DOWN_MESSAGE =
  "The virus check is not available right now, so the file was not accepted. Please try again later.";
export const SCAN_DIRTY_MESSAGE =
  "This PDF did not pass the virus check, so it was not accepted.";

export type ScanDeps = {
  fetch: typeof fetch;
  apiKey: string | undefined;
  timeoutMs?: number;
};

const ENDPOINT = "https://api.cloudmersive.com/virus/scan/file/advanced";

/**
 * Fail closed: only a 200 JSON reply with CleanResult === true passes.
 * `opts.fileName` names the file to Cloudmersive and `opts.offMessage` is the
 * 503 sentence with no key; the defaults are the letterhead's.
 */
export async function scanPdf(
  bytes: Uint8Array,
  d: ScanDeps,
  opts: { fileName?: string; offMessage?: string } = {},
): Promise<{ engine: "Cloudmersive"; verdict: "clean"; scannedAt: string }> {
  const fileName = opts.fileName ?? "letterhead.pdf";
  if (!d.apiKey) throw new AppError(opts.offMessage ?? SCAN_OFF_MESSAGE, 503);
  const down = (why: number | string) => {
    console.error("[signroom] scan failed", why);
    return new AppError(SCAN_DOWN_MESSAGE, 503);
  };
  const form = new FormData();
  form.append("inputFile", new Blob([new Uint8Array(bytes)]), fileName);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), d.timeoutMs ?? 30000);
  let res: Response;
  try {
    res = await d.fetch(ENDPOINT, {
      method: "POST",
      headers: {
        Apikey: d.apiKey,
        restrictFileTypes: ".pdf",
        fileName,
      },
      body: form,
      signal: ctl.signal,
    });
    if (res.status !== 200) throw down(res.status);
    let body: { CleanResult?: unknown };
    try {
      body = await res.json();
    } catch {
      throw down("json");
    }
    if (body?.CleanResult !== true) throw new AppError(SCAN_DIRTY_MESSAGE, 422);
    return {
      engine: "Cloudmersive",
      verdict: "clean",
      scannedAt: new Date().toISOString(),
    };
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw down(ctl.signal.aborted ? "timeout" : "network");
  } finally {
    clearTimeout(timer);
  }
}
