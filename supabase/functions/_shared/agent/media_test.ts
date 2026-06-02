import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { transcribeAudio, storagePath, ATTACH_ENTITY_TYPES } from "./media.ts";

Deno.test("storagePath follows <org>/<type>/<id>/<attId>-<file> convention", () => {
  const p = storagePath("org1", "deal", "d-1", "att-9", "spec sheet.pdf");
  assertEquals(p, "org1/deal/d-1/att-9-spec sheet.pdf");
});

Deno.test("ATTACH_ENTITY_TYPES matches the attachments CHECK constraint", () => {
  for (const t of ["lead", "contact", "client", "deal", "task", "meeting", "call"]) {
    assert(ATTACH_ENTITY_TYPES.has(t), `${t} should be allowed`);
  }
  assert(!ATTACH_ENTITY_TYPES.has("client_task"), "client_task is not an attachable type");
});

Deno.test("transcribeAudio posts the bytes and returns the text", async () => {
  const orig = globalThis.fetch;
  let sawAuth = false;
  // deno-lint-ignore no-explicit-any
  globalThis.fetch = ((url: string, init: any) => {
    sawAuth = (init.headers.authorization ?? "").startsWith("Bearer ");
    assert(String(url).includes("/audio/transcriptions"));
    return Promise.resolve(new Response(JSON.stringify({ text: "create task call John" }), { status: 200 }));
    // deno-lint-ignore no-explicit-any
  }) as any;
  try {
    const text = await transcribeAudio(new Uint8Array([1, 2, 3]), "audio/ogg", "sk-test");
    assertEquals(text, "create task call John");
    assert(sawAuth, "should send a bearer token");
  } finally {
    globalThis.fetch = orig;
  }
});
