import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { parsePickCallback } from "./agentActions.ts";

Deno.test("parsePickCallback maps known prefixes to id fields", () => {
  assertEquals(parsePickCallback("pickproj:abc-123"), { idField: "project_id", id: "abc-123" });
  assertEquals(parsePickCallback("pickws:ws-1"), { idField: "workspace_id", id: "ws-1" });
  assertEquals(parsePickCallback("pickclient:c-9"), { idField: "client_id", id: "c-9" });
});

Deno.test("parsePickCallback rejects unknown or malformed callbacks", () => {
  assertEquals(parsePickCallback("confirm:abc"), null);
  assertEquals(parsePickCallback("pickproj:"), null);
  assertEquals(parsePickCallback("noseparator"), null);
});
