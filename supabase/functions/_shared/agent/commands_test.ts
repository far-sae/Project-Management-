import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { matchUtilityCommand, isLinkCode } from "./commands.ts";

Deno.test("isLinkCode matches exactly 6 digits", () => {
  assertEquals(isLinkCode("123456"), true);
  assertEquals(isLinkCode("  654321 "), true);
  assertEquals(isLinkCode("12345"), false);
  assertEquals(isLinkCode("1234567"), false);
  assertEquals(isLinkCode("hello"), false);
});

Deno.test("matchUtilityCommand recognizes utility phrases", () => {
  assertEquals(matchUtilityCommand("help").kind, "help");
  assertEquals(matchUtilityCommand("What can you do?").kind, "help");
  assertEquals(matchUtilityCommand("my orgs").kind, "orgs");
  assertEquals(matchUtilityCommand("orgs").kind, "orgs");
  assertEquals(matchUtilityCommand("cancel").kind, "cancel");
  assertEquals(matchUtilityCommand("never mind").kind, "cancel");
  assertEquals(matchUtilityCommand("unlink").kind, "unlink");
  assertEquals(matchUtilityCommand("disconnect").kind, "unlink");
});

Deno.test("matchUtilityCommand captures the org name for switch/use", () => {
  assertEquals(matchUtilityCommand("switch to Acme Corp"), { kind: "switchorg", name: "Acme Corp" });
  assertEquals(matchUtilityCommand("switch Acme"), { kind: "switchorg", name: "Acme" });
  assertEquals(matchUtilityCommand("use Acme Corp"), { kind: "switchorg", name: "Acme Corp" });
});

Deno.test("matchUtilityCommand returns none for normal commands", () => {
  assertEquals(matchUtilityCommand("add task call John tomorrow").kind, "none");
  assertEquals(matchUtilityCommand("show my open tasks").kind, "none");
  assertEquals(matchUtilityCommand("mark Deploy v2 done").kind, "none");
});
