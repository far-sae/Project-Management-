import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { chooseBranch, validBranchAction } from "./runBranch.ts";

Deno.test("chooseBranch returns 'then' when conditions pass, 'else' otherwise", () => {
  // chooseBranch takes a precomputed boolean (condition eval is injected)
  assertEquals(chooseBranch(true), "then");
  assertEquals(chooseBranch(false), "else");
});
Deno.test("validBranchAction rejects nested branch/wait, allows others", () => {
  assertEquals(validBranchAction({ type: "send_email", config: {} }), true);
  assertEquals(validBranchAction({ type: "branch", config: {} }), false);
  assertEquals(validBranchAction({ type: "wait", config: {} }), false);
});
