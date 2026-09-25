import { describe, it, expect, vi, beforeEach } from "vitest";

const { startSpy, findPrev, UploadMock } = vi.hoisted(() => {
  const startSpy = vi.fn();
  const findPrev = vi.fn().mockResolvedValue([]);
  const UploadMock = vi.fn().mockImplementation((_file, opts) => ({
    options: opts,
    start: startSpy,
    findPreviousUploads: findPrev,
    resumeFromPreviousUpload: vi.fn(),
  }));
  return { startSpy, findPrev, UploadMock };
});
vi.mock("tus-js-client", () => ({ Upload: UploadMock }));
vi.mock("@/services/supabase/config", () => ({
  supabase: { auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: "tok-123" } } }) } },
}));

import { resumableUpload } from "@/services/supabase/resumableUpload";

describe("resumableUpload", () => {
  beforeEach(() => { UploadMock.mockClear(); startSpy.mockClear(); });

  it("configures the TUS upload with the Supabase resumable endpoint, bearer token, and 6MB chunks", async () => {
    const file = new File([new Uint8Array(10)], "x.pdf", { type: "application/pdf" });
    UploadMock.mockImplementationOnce((_f, opts) => {
      const start = vi.fn().mockImplementation(() => {
        startSpy();
        queueMicrotask(() => opts.onSuccess());
      });
      return { options: opts, start, findPreviousUploads: findPrev, resumeFromPreviousUpload: vi.fn() };
    });
    await resumableUpload({ bucket: "attachments", path: "org/deal/d1/x.pdf", file });
    const opts = UploadMock.mock.calls[0][1];
    expect(opts.endpoint).toContain("/storage/v1/upload/resumable");
    expect(opts.headers.authorization).toBe("Bearer tok-123");
    expect(opts.chunkSize).toBe(6 * 1024 * 1024);
    expect(opts.metadata.bucketName).toBe("attachments");
    expect(opts.metadata.objectName).toBe("org/deal/d1/x.pdf");
    expect(startSpy).toHaveBeenCalled();
  });
});
