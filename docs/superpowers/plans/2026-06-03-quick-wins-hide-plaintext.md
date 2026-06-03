# Quick Wins Implementation Plan — Hide WhatsApp/Gmail + Plain-text Bot

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hide WhatsApp + Gmail from the landing pages and the in-app Integrations tab (behind a default-off flag), and make the Telegram/WhatsApp bot fully usable with plain text (no slash commands required).

**Architecture:** Part A is frontend-only — a `FEATURES` flag module + a pure `visibleProviders` helper gate the in-app cards; landing copy is edited at source. Part B adds a shared, unit-tested `matchUtilityCommand`/`isLinkCode` matcher in `_shared/agent/` and restructures each webhook's message routing to: link-by-bare-code → utility-phrase → slash alias → natural language. Slash commands remain as silent aliases.

**Tech Stack:** React + TypeScript + Vite (web, vitest); Deno edge functions (bot, `deno test`/`deno check`). Deno binary (not on PATH): `C:\Users\faraz\AppData\Local\Microsoft\WinGet\Packages\DenoLand.Deno_Microsoft.Winget.Source_8wekyb3d8bbwe\deno.exe`.

**Reference spec:** [docs/superpowers/specs/2026-06-03-quick-wins-hide-integrations-plaintext-bot-design.md](../specs/2026-06-03-quick-wins-hide-integrations-plaintext-bot-design.md).

**Branch:** `quick-wins-hide-plaintext` (already created, off `bot-power-expansion`).

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `src/config/featureFlags.ts` | `FEATURES` build-time flags | Create |
| `src/services/integrations/providers.ts` | `visibleProviders` pure helper | Modify |
| `tests/unit/providers.visibility.test.ts` | test the helper | Create |
| `src/components/integrations/IntegrationsTab.tsx` | gate Gmail provider + WhatsApp card | Modify |
| `src/components/integrations/IntegrationsHealthCard.tsx` | hide Gmail health row | Modify |
| `src/components/landing/FeaturesSection.tsx` | drop WhatsApp + Gmail copy/chips | Modify |
| `src/components/landing/HeroSection.tsx` | drop WhatsApp from badge | Modify |
| `supabase/functions/_shared/agent/commands.ts` | `matchUtilityCommand` + `isLinkCode` | Create |
| `supabase/functions/_shared/agent/commands_test.ts` | test the matcher | Create |
| `supabase/functions/telegram-webhook/index.ts` | plain-text routing | Modify |
| `supabase/functions/whatsapp-webhook/index.ts` | plain-text routing | Modify |
| `supabase/functions/telegram-webhook/handlers.ts` | help/link copy (no slashes) | Modify |
| `supabase/functions/whatsapp-webhook/handlers.ts` | help/link copy (no slashes) | Modify |

---

# PART A — Hide WhatsApp + Gmail (frontend)

## Task A1: Feature flags + `visibleProviders` helper

**Files:**
- Create: `src/config/featureFlags.ts`
- Modify: `src/services/integrations/providers.ts`
- Test: `tests/unit/providers.visibility.test.ts`

- [ ] **Step 1: Create the flag module**

`src/config/featureFlags.ts`:
```typescript
// Build-time feature flags. Default OFF — enable by setting the env var and
// rebuilding, e.g. VITE_ENABLE_WHATSAPP=true.
export const FEATURES = {
  whatsapp: import.meta.env.VITE_ENABLE_WHATSAPP === "true",
  gmail: import.meta.env.VITE_ENABLE_GMAIL === "true",
} as const;
```

- [ ] **Step 2: Write the failing test for `visibleProviders`**

Create `tests/unit/providers.visibility.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { visibleProviders } from "@/services/integrations/providers";

describe("visibleProviders", () => {
  it("hides gmail when the gmail flag is off", () => {
    const out = visibleProviders(["google", "gmail", "slack"], { gmail: false });
    expect(out).toEqual(["google", "slack"]);
  });
  it("keeps gmail when the gmail flag is on", () => {
    const out = visibleProviders(["google", "gmail", "slack"], { gmail: true });
    expect(out).toEqual(["google", "gmail", "slack"]);
  });
  it("never touches non-gmail providers", () => {
    const out = visibleProviders(["google", "slack"], { gmail: false });
    expect(out).toEqual(["google", "slack"]);
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npm run test -- providers.visibility`
Expected: FAIL — `visibleProviders` not exported.

- [ ] **Step 4: Implement the helper**

In `src/services/integrations/providers.ts`, append:
```typescript
/** Filter the provider list by feature flags. Gmail is hidden unless enabled. */
export const visibleProviders = (
  order: ProviderId[],
  features: { gmail: boolean },
): ProviderId[] => order.filter((id) => id !== "gmail" || features.gmail);
```
(`ProviderId` is already imported at the top of this file.)

- [ ] **Step 5: Run it to verify it passes**

Run: `npm run test -- providers.visibility`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add src/config/featureFlags.ts src/services/integrations/providers.ts tests/unit/providers.visibility.test.ts
git commit -m "feat(web): feature flags + visibleProviders helper"
```

## Task A2: Gate the in-app Integrations cards

**Files:**
- Modify: `src/components/integrations/IntegrationsTab.tsx`
- Modify: `src/components/integrations/IntegrationsHealthCard.tsx`

- [ ] **Step 1: Gate Gmail provider + WhatsApp card in `IntegrationsTab`**

Add imports near the top:
```tsx
import { FEATURES } from '@/config/featureFlags';
import { providerOrder, providerDisplay, visibleProviders } from '@/services/integrations/providers';
```
(Replace the existing `providerOrder, providerDisplay` import line with the one above.)

Change the map source from `providerOrder.map(...)` to `visibleProviders(providerOrder, FEATURES).map(...)` — i.e.:
```tsx
        {visibleProviders(providerOrder, FEATURES).map((id) => {
```

Gate the WhatsApp card — replace `<WhatsAppConnectCard />` with:
```tsx
        {FEATURES.whatsapp && <WhatsAppConnectCard />}
```
Leave `<TelegramConnectCard />`, `<TwilioSmsConfigCard />`, and the `google` provider untouched.

- [ ] **Step 2: Hide the Gmail health row in `IntegrationsHealthCard`**

Add the import:
```tsx
import { FEATURES } from '@/config/featureFlags';
```
In `load()`, change the initial `next` array so the Gmail row is only included when enabled:
```tsx
    const next: Row[] = [
      ...(FEATURES.gmail ? [{ id: 'gmail' as const, label: 'Gmail', status: 'unknown' as Status, hint: '', icon: Mail }] : []),
      { id: 'google',      label: 'Google Meet',  status: 'unknown', hint: '', icon: Video },
      { id: 'automations', label: 'Automations',  status: 'unknown', hint: '', icon: Workflow },
    ];
```
The downstream `.in('provider', ['gmail','google'])` query and the `r.id === 'gmail'` branches are harmless when no gmail row exists (the `find`/filter simply match nothing), so no other change is needed here.

- [ ] **Step 3: Build to verify types**

Run: `npm run build`
Expected: success. (If it fails, the errors must be in the two files above — fix them; pre-existing errors elsewhere are out of scope, report them.)

- [ ] **Step 4: Commit**

```bash
git add src/components/integrations/IntegrationsTab.tsx src/components/integrations/IntegrationsHealthCard.tsx
git commit -m "feat(web): gate Gmail + WhatsApp integration cards behind flags"
```

## Task A3: Remove WhatsApp + Gmail from the landing pages

**Files:**
- Modify: `src/components/landing/FeaturesSection.tsx`
- Modify: `src/components/landing/HeroSection.tsx`

- [ ] **Step 1: `FeaturesSection` — the bot feature card (Telegram-only now)**

Replace this feature object:
```tsx
  {
    icon: MessageCircle,
    title: "Telegram and WhatsApp bots",
    description: "Text either bot in plain English: 'add task call John tomorrow 3pm in Q1 launch'. It confirms, you tap Yes.",
    accentClass: "bg-sky-500/15 text-sky-500",
    visual: <TelegramVisual />,
  },
```
with:
```tsx
  {
    icon: MessageCircle,
    title: "Telegram bot",
    description: "Text the bot in plain English: 'add task call John tomorrow 3pm in Q1 launch'. It confirms, you tap Yes.",
    accentClass: "bg-sky-500/15 text-sky-500",
    visual: <TelegramVisual />,
  },
```

- [ ] **Step 2: `FeaturesSection` — the integrations card copy (drop Gmail)**

Replace:
```tsx
    description: "Google Calendar / Meet / Gmail, Slack triggers and posts, Cloudflare Turnstile on lead forms. OAuth tokens encrypted at rest.",
```
with:
```tsx
    description: "Google Calendar / Meet, Slack triggers and posts, Cloudflare Turnstile on lead forms. OAuth tokens encrypted at rest.",
```

- [ ] **Step 3: `FeaturesSection` — the integrations visual chips (drop Gmail)**

In `IntegrationsVisual()`, replace:
```tsx
      {['Google', 'Slack', 'Gmail', 'Meet', 'Telegram', 'Stripe'].map((n) => (
```
with:
```tsx
      {['Google', 'Slack', 'Meet', 'Telegram', 'Stripe'].map((n) => (
```

- [ ] **Step 4: `HeroSection` — the badge (drop WhatsApp)**

Replace:
```tsx
              <span>New: Telegram &amp; WhatsApp bots, CRM dashboards &amp; Google Meet</span>
```
with:
```tsx
              <span>New: Telegram bot, CRM dashboards &amp; Google Meet</span>
```

- [ ] **Step 5: Verify no remaining public mentions**

Run: `npx vite build` (or `npm run build`) and grep the landing dir:
Run: search `src/components/landing` for `WhatsApp` / `Gmail` (case-insensitive) → expect **zero** matches.

- [ ] **Step 6: Commit**

```bash
git add src/components/landing/FeaturesSection.tsx src/components/landing/HeroSection.tsx
git commit -m "feat(web): remove WhatsApp + Gmail from landing pages"
```

---

# PART B — Plain-text bot (no slash commands)

## Task B1: Shared command matcher (TDD)

**Files:**
- Create: `supabase/functions/_shared/agent/commands.ts`
- Test: `supabase/functions/_shared/agent/commands_test.ts`

- [ ] **Step 1: Write the failing test**

Create `supabase/functions/_shared/agent/commands_test.ts`:
```typescript
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `"$DENO" test supabase/functions/_shared/agent/commands_test.ts`
Expected: FAIL — `commands.ts` does not exist.

- [ ] **Step 3: Implement the matcher**

Create `supabase/functions/_shared/agent/commands.ts`:
```typescript
// supabase/functions/_shared/agent/commands.ts
// Plain-text equivalents of the old slash commands, matched cheaply (no LLM)
// before the natural-language pipeline. Keeps the bot usable with no "/".

export type UtilityCommand =
  | { kind: "help" }
  | { kind: "orgs" }
  | { kind: "cancel" }
  | { kind: "unlink" }
  | { kind: "switchorg"; name: string }
  | { kind: "none" };

/** True when the text is exactly a 6-digit link code (used to link a chat
 *  without "/start"). Whitespace is trimmed. */
export const isLinkCode = (text: string): boolean => /^\d{6}$/.test(text.trim());

/** Map a plain-text message to a utility command, or { kind: "none" } so the
 *  caller falls through to the natural-language parser. Org name keeps its
 *  original casing. */
export const matchUtilityCommand = (raw: string): UtilityCommand => {
  const t = raw.trim();
  const low = t.toLowerCase();
  if (/^(help|what can you do\??|commands)$/.test(low)) return { kind: "help" };
  if (/^(my )?orgs$/.test(low) || low === "list orgs") return { kind: "orgs" };
  if (/^(cancel|never ?mind|stop)$/.test(low)) return { kind: "cancel" };
  if (/^(unlink|disconnect)$/.test(low)) return { kind: "unlink" };
  const m = t.match(/^(?:switch|use)(?: to)?\s+(.+)$/i);
  if (m) return { kind: "switchorg", name: m[1].trim() };
  return { kind: "none" };
};
```

- [ ] **Step 4: Run it to verify it passes**

Run: `"$DENO" test supabase/functions/_shared/agent/commands_test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/agent/commands.ts supabase/functions/_shared/agent/commands_test.ts
git commit -m "feat(bot): shared plain-text command matcher"
```

## Task B2: Telegram — plain-text routing

**Files:**
- Modify: `supabase/functions/telegram-webhook/index.ts`
- Modify: `supabase/functions/telegram-webhook/handlers.ts`

- [ ] **Step 1: Import the matcher in `index.ts`**

Add:
```typescript
import { matchUtilityCommand, isLinkCode } from "../_shared/agent/commands.ts";
```

- [ ] **Step 2: Add plain-text linking for unlinked chats**

In `index.ts`, find the linked-account guard:
```typescript
    const account = await findLinkedAccount(admin, tgUserId);
    if (!account) {
      await sendMessage(chatId, "🔗 This chat isn't linked. In TaskCalendar: Settings → Integrations → Telegram → Connect, then send `/start <code>`.");
      return new Response("ok");
    }
```
Replace it with:
```typescript
    const account = await findLinkedAccount(admin, tgUserId);
    if (!account) {
      if (msg.text && isLinkCode(msg.text)) {
        await handleStart(admin, chatId, tgUserId, username, msg.text.trim());
        return new Response("ok");
      }
      await sendMessage(chatId, "🔗 This chat isn't linked. Send me the 6-digit code from TaskCalendar → Settings → Integrations → Telegram to connect.");
      return new Response("ok");
    }
```

- [ ] **Step 3: Add plain-text utility routing before the NL fallback**

In `index.ts`, the text-command region currently ends with:
```typescript
    if (text.startsWith("/switchorg")) {
      await handleSwitchOrg(admin, chatId, account, text.slice("/switchorg".length).trim());
      return new Response("ok");
    }

    await handleNaturalLanguage(admin, chatId, account, text);
    return new Response("ok");
```
Insert the plain-text utility matcher just before `handleNaturalLanguage`:
```typescript
    if (text.startsWith("/switchorg")) {
      await handleSwitchOrg(admin, chatId, account, text.slice("/switchorg".length).trim());
      return new Response("ok");
    }

    const util = matchUtilityCommand(text);
    if (util.kind === "help") { await handleHelp(chatId); return new Response("ok"); }
    if (util.kind === "orgs") { await handleListOrgs(admin, chatId, account); return new Response("ok"); }
    if (util.kind === "cancel") { await handleCancel(admin, chatId); return new Response("ok"); }
    if (util.kind === "unlink") { await handleUnlink(admin, chatId, tgUserId); return new Response("ok"); }
    if (util.kind === "switchorg") { await handleSwitchOrg(admin, chatId, account, util.name); return new Response("ok"); }

    await handleNaturalLanguage(admin, chatId, account, text);
    return new Response("ok");
```
(`handleHelp`, `handleListOrgs`, `handleCancel`, `handleUnlink`, `handleSwitchOrg` are already imported in this file.)

- [ ] **Step 4: Update the link-success + help copy (no slashes) in `handlers.ts`**

In `telegram-webhook/handlers.ts`, in `handleStart`, replace the success message:
```typescript
  await sendMessage(chatId, `✅ Linked in *${orgName}*. Try \`add workspace Sales\` or \`task: call John tomorrow 3pm in Q1 launch\`. Send /help for more.`);
```
with:
```typescript
  await sendMessage(chatId, `✅ Linked in *${orgName}*. Try \`add workspace Sales\` or \`task: call John tomorrow 3pm in Q1 launch\`. Say *help* for more.`);
```
And replace the whole `HELP_TEXT` constant with:
```typescript
const HELP_TEXT = `*TaskCalendar bot — just type in plain English*

Examples:
• \`add workspace Acme Onboarding\`
• \`new project Q1 launch in Acme Onboarding\`
• \`task: call John tomorrow 3pm in Q1 launch\`
• \`new client Acme Corp\`
• \`show my open tasks\`
• \`mark Deploy v2 done\`

Handy words:
• \`my orgs\` — list your orgs
• \`switch to <name>\` — change current org
• \`cancel\` — drop the current question
• \`unlink\` — disconnect this chat
• \`help\` — show this message`;
```

- [ ] **Step 5: Type-check**

Run: `"$DENO" check supabase/functions/telegram-webhook/index.ts`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/telegram-webhook/index.ts supabase/functions/telegram-webhook/handlers.ts
git commit -m "feat(bot): telegram plain-text linking + utility commands"
```

## Task B3: WhatsApp — plain-text routing

**Files:**
- Modify: `supabase/functions/whatsapp-webhook/index.ts`
- Modify: `supabase/functions/whatsapp-webhook/handlers.ts`

- [ ] **Step 1: Import the matcher in `index.ts`**

Add:
```typescript
import { matchUtilityCommand, isLinkCode } from "../_shared/agent/commands.ts";
```

- [ ] **Step 2: Plain-text linking for unlinked chats**

In `whatsapp-webhook/index.ts` `handleOne`, find the not-linked guard:
```typescript
  const account = await findLinkedAccount(admin, phoneNumber);
  if (!account) {
    await sendMessage(
      phoneNumber,
      "🔗 This number isn't linked. In TaskCalendar: Settings → Integrations → WhatsApp → Connect, then reply: /start <code>",
    );
    return;
  }
```
Replace with:
```typescript
  const account = await findLinkedAccount(admin, phoneNumber);
  if (!account) {
    if (isLinkCode(text)) {
      await handleStart(admin, phoneNumber, text.trim());
      return;
    }
    await sendMessage(
      phoneNumber,
      "🔗 This number isn't linked. Send me the 6-digit code from TaskCalendar → Settings → Integrations → WhatsApp to connect.",
    );
    return;
  }
```
(`text` is the trimmed message body already computed above this block in `handleOne`; `handleStart` is imported.)

- [ ] **Step 3: Plain-text utility routing before the NL fallback**

In `handleOne`, the tail currently is:
```typescript
  if (text.toLowerCase().startsWith("/switchorg")) {
    await handleSwitchOrg(admin, account, text.slice("/switchorg".length).trim());
    return;
  }
  if (text.toLowerCase() === "/cancel") {
    await handleCancel(admin, phoneNumber);
    return;
  }

  await handleNaturalLanguage(admin, account, text);
```
Insert the matcher just before `handleNaturalLanguage`:
```typescript
  if (text.toLowerCase().startsWith("/switchorg")) {
    await handleSwitchOrg(admin, account, text.slice("/switchorg".length).trim());
    return;
  }
  if (text.toLowerCase() === "/cancel") {
    await handleCancel(admin, phoneNumber);
    return;
  }

  const util = matchUtilityCommand(text);
  if (util.kind === "help") { await handleHelp(phoneNumber); return; }
  if (util.kind === "orgs") { await handleListOrgs(admin, account); return; }
  if (util.kind === "cancel") { await handleCancel(admin, phoneNumber); return; }
  if (util.kind === "unlink") { await handleUnlink(admin, phoneNumber); return; }
  if (util.kind === "switchorg") { await handleSwitchOrg(admin, account, util.name); return; }

  await handleNaturalLanguage(admin, account, text);
```
(`handleHelp`, `handleListOrgs`, `handleCancel`, `handleUnlink`, `handleSwitchOrg` are already imported.)

- [ ] **Step 4: Update copy in `whatsapp-webhook/handlers.ts`**

In `handleStart`, replace the success message:
```typescript
  await sendMessage(
    phoneNumber,
    `✅ Linked in ${orgName}. Try: add workspace Sales, or: task: call John tomorrow 3pm in Q1 launch. Send /help for more.`,
  );
```
with:
```typescript
  await sendMessage(
    phoneNumber,
    `✅ Linked in ${orgName}. Try: add workspace Sales, or: task: call John tomorrow 3pm in Q1 launch. Say help for more.`,
  );
```
And in the "already linked" branch of `handleStart`, replace:
```typescript
      await sendMessage(phoneNumber, "✅ Already linked. Try: add task call John tomorrow 3pm in My Project. Send /help for more.");
```
with:
```typescript
      await sendMessage(phoneNumber, "✅ Already linked. Try: add task call John tomorrow 3pm in My Project. Say help for more.");
```
And replace the body of `handleHelp` with the no-slash version:
```typescript
export const handleHelp = async (phoneNumber: string): Promise<void> => {
  await sendMessage(
    phoneNumber,
    "TaskCalendar bot — just type in plain English\n\n" +
      "Examples:\n" +
      "• add workspace Acme Onboarding\n" +
      "• new project Q1 launch in Acme Onboarding\n" +
      "• task: call John tomorrow 3pm in Q1 launch\n" +
      "• new client Acme Corp\n" +
      "• show my open tasks\n" +
      "• mark Deploy v2 done\n\n" +
      "Handy words:\n" +
      "my orgs — list your orgs\n" +
      "switch to <name> — change current org\n" +
      "cancel — drop the current question\n" +
      "unlink — disconnect this chat\n" +
      "help — show this message",
  );
};
```

- [ ] **Step 5: Type-check**

Run: `"$DENO" check supabase/functions/whatsapp-webhook/index.ts`
Expected: clean (the old TS2345 was fixed earlier; expect zero errors).

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/whatsapp-webhook/index.ts supabase/functions/whatsapp-webhook/handlers.ts
git commit -m "feat(bot): whatsapp plain-text linking + utility commands"
```

## Task B4: Full verification

- [ ] **Step 1: Run the bot test suite + checks**

Run:
```bash
"$DENO" test supabase/functions/_shared/agent/
"$DENO" check supabase/functions/telegram-webhook/index.ts supabase/functions/whatsapp-webhook/index.ts
```
Expected: all tests pass (previous suite + the new commands tests); both checks clean.

- [ ] **Step 2: Run the web suite + build**

Run:
```bash
npm run test
npm run build
```
Expected: all vitest pass (incl. `providers.visibility`); build succeeds.

---

## Manual verification (post-deploy / post-build)

**Part A:**
- [ ] Load the landing page → no "WhatsApp" or "Gmail" text anywhere.
- [ ] Default build (flags unset): Settings → Integrations shows **no** Gmail card, **no** WhatsApp card, **no** Gmail health row. Telegram + Google Meet still present.
- [ ] Build with `VITE_ENABLE_WHATSAPP=true VITE_ENABLE_GMAIL=true` → both cards + the Gmail health row reappear.

**Part B (after deploying both functions):**
- [ ] From a fresh (unlinked) chat, send `123456` (a real code) → links, no `/start` needed.
- [ ] Send `help`, `my orgs`, `switch to <an org name>`, `cancel`, `unlink` → each works with no slash.
- [ ] Send `add task call John tomorrow 3pm in <project>` → normal create/confirm flow still works.
- [ ] `/start <code>` and `/help` still work (silent aliases).

---

## Self-Review

**Spec coverage:** Part A flag module (A1) ✓, in-app gating (A2) ✓, landing removal (A3) ✓, flip-on via env ✓; Part B shared matcher (B1) ✓, plain-text linking (B2/B3) ✓, utility phrases → existing handlers (B2/B3) ✓, slash aliases preserved (untouched in both index files) ✓, copy cleanup (B2/B3) ✓, slot-filling left intact ✓.

**Placeholder scan:** All code complete; no TBD/TODO. Build-failure handling in A2 Step 3 is scoped to the two changed files, not a vague "handle errors".

**Type consistency:** `FEATURES` shape `{ whatsapp, gmail }` consumed by `visibleProviders(order, { gmail })` and the WhatsApp card guard. `UtilityCommand` discriminated union from `matchUtilityCommand` is switched on identically in both webhooks (`help|orgs|cancel|unlink|switchorg|none`). `isLinkCode` returns boolean, used in both link guards. All handler names referenced (`handleHelp`, `handleListOrgs`, `handleCancel`, `handleUnlink`, `handleSwitchOrg`, `handleStart`) already exist and are imported in the respective files.
