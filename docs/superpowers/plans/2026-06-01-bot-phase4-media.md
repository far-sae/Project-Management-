# Bot Phase 4 — Media (Voice Transcription + Attachments) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop dropping media. Voice notes are transcribed (OpenAI) and run as commands; images/documents are uploaded to the `attachments` bucket against the chat's last-touched record.

**Architecture:** A shared `_shared/agent/media.ts` does the provider-agnostic work — `transcribeAudio(bytes, mime)` and `attachToEntity(...)`. Each webhook detects media in its payload and uses its own `downloadMedia()` (Telegram `getFile`; WhatsApp media-id→URL) to fetch bytes, then calls the shared module. `executePending` records the last created/edited record in `integrations.metadata.last_entity`, which is the default attach target.

**Tech Stack:** Deno edge functions, Supabase JS (Storage + DB), OpenAI audio transcriptions, Meta WhatsApp Cloud API, Telegram Bot API. Tests via `deno test` (mocked `fetch`).

**Reference spec:** [docs/superpowers/specs/2026-06-01-bot-power-expansion-design.md](../specs/2026-06-01-bot-power-expansion-design.md) §6 (Media).

**Depends on:** Phase 0–3 (uses `handleNaturalLanguage`, `executePending`, the `attachments` table from migration 116). Voice transcript flows in **silently as typed** (locked decision).

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `supabase/functions/_shared/agent/media.ts` | `transcribeAudio`, `attachToEntity`, `setLastEntity`, `loadLastEntity` | Create |
| `supabase/functions/_shared/agent/media_test.ts` | Tests (mocked fetch / storage) | Create |
| `supabase/functions/_shared/agent/agentActions.ts` | Record `last_entity` after create/update | Modify |
| `supabase/functions/telegram-webhook/telegram.ts` | `downloadMedia()` via getFile | Modify |
| `supabase/functions/whatsapp-webhook/whatsapp.ts` | `downloadMedia()` via media-id | Modify |
| `supabase/functions/telegram-webhook/index.ts` | Detect voice/photo/document | Modify |
| `supabase/functions/whatsapp-webhook/index.ts` | Detect audio/image/document | Modify |
| `supabase/functions/telegram-webhook/handlers.ts` | `handleMedia` | Modify |
| `supabase/functions/whatsapp-webhook/handlers.ts` | `handleMedia` | Modify |

---

## Task 1: Shared `media.ts`

**Files:**
- Create: `supabase/functions/_shared/agent/media.ts`
- Test: `supabase/functions/_shared/agent/media_test.ts`

- [ ] **Step 1: Write the failing tests**

Create `supabase/functions/_shared/agent/media_test.ts`:

```typescript
import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { transcribeAudio, storagePath, ATTACH_ENTITY_TYPES } from "./media.ts";

Deno.test("storagePath follows <org>/<type>/<id>/<attId>-<file> convention", () => {
  const p = storagePath("org1", "deal", "d-1", "att-9", "spec sheet.pdf");
  assertEquals(p, "org1/deal/d-1/att-9-spec sheet.pdf");
});

Deno.test("ATTACH_ENTITY_TYPES matches the attachments CHECK constraint", () => {
  // From migration 116: lead|contact|client|deal|task|meeting|call
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `deno test --allow-net supabase/functions/_shared/agent/media_test.ts`
Expected: FAIL — `media.ts` does not exist.

- [ ] **Step 3: Implement `media.ts`**

Create `supabase/functions/_shared/agent/media.ts`:

```typescript
// supabase/functions/_shared/agent/media.ts
// Provider-agnostic media handling: transcribe audio to text (OpenAI), and
// upload a file as an attachment on a CRM/PM record (Supabase Storage + the
// attachments table from migration 116). Downloading the bytes is the
// provider's job; this module takes the bytes.

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { AgentProvider } from "./types.ts";

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";
const TRANSCRIBE_MODEL = Deno.env.get("OPENAI_TRANSCRIBE_MODEL") ?? "whisper-1";

// entity_type values permitted by the attachments CHECK constraint (migration 116).
export const ATTACH_ENTITY_TYPES = new Set([
  "lead", "contact", "client", "deal", "task", "meeting", "call",
]);

export interface LastEntity { type: string; id: string; label: string; }

/** Storage object path: <org_id>/<entity_type>/<entity_id>/<attachment_id>-<file>. */
export const storagePath = (
  orgId: string, entityType: string, entityId: string, attachmentId: string, fileName: string,
): string => `${orgId}/${entityType}/${entityId}/${attachmentId}-${fileName}`;

/** Transcribe audio bytes to text via OpenAI. apiKey defaults to the env key
 *  (passed explicitly in tests). Throws on a non-2xx response. */
export const transcribeAudio = async (
  bytes: Uint8Array,
  mimeType: string,
  apiKey: string = OPENAI_API_KEY,
): Promise<string> => {
  const form = new FormData();
  const ext = mimeType.includes("ogg") ? "ogg" : mimeType.includes("mp4") || mimeType.includes("m4a") ? "m4a" : mimeType.includes("wav") ? "wav" : mimeType.includes("mpeg") ? "mp3" : "ogg";
  form.append("file", new Blob([bytes], { type: mimeType }), `audio.${ext}`);
  form.append("model", TRANSCRIBE_MODEL);
  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!res.ok) throw new Error(`transcription failed: ${res.status} ${await res.text()}`);
  const json = await res.json();
  return (json.text ?? "").trim();
};

/** Upload bytes to the attachments bucket and insert the metadata row.
 *  Returns the attachment id. Caller must pass an attachable entityType. */
export const attachToEntity = async (
  admin: SupabaseClient,
  orgId: string,
  uploadedBy: string,
  entityType: string,
  entityId: string,
  bytes: Uint8Array,
  mimeType: string,
  fileName: string,
): Promise<string> => {
  const attachmentId = crypto.randomUUID();
  const path = storagePath(orgId, entityType, entityId, attachmentId, fileName);
  const { error: upErr } = await admin.storage.from("attachments").upload(path, bytes, {
    contentType: mimeType, upsert: false,
  });
  if (upErr) throw new Error(`upload failed: ${upErr.message}`);
  const { error: rowErr } = await admin.from("attachments").insert({
    attachment_id: attachmentId,
    organization_id: orgId,
    entity_type: entityType,
    entity_id: entityId,
    file_name: fileName,
    mime_type: mimeType,
    size_bytes: bytes.byteLength,
    storage_path: path,
    uploaded_by: uploadedBy,
  });
  if (rowErr) {
    // Best-effort cleanup so we don't leave an orphan blob.
    await admin.storage.from("attachments").remove([path]);
    throw new Error(`attachment row failed: ${rowErr.message}`);
  }
  return attachmentId;
};

/** Persist the chat's most-recent record into integrations.metadata.last_entity. */
export const setLastEntity = async (
  admin: SupabaseClient,
  provider: AgentProvider,
  userId: string,
  entity: LastEntity,
): Promise<void> => {
  const { data } = await admin.from("integrations").select("metadata")
    .eq("provider", provider).eq("user_id", userId).maybeSingle();
  const meta = ((data?.metadata ?? {}) as Record<string, unknown>);
  await admin.from("integrations")
    .update({ metadata: { ...meta, last_entity: entity } })
    .eq("provider", provider).eq("user_id", userId);
};

/** Read back the last-touched record for a chat (for the default attach target). */
export const loadLastEntity = async (
  admin: SupabaseClient,
  provider: AgentProvider,
  userId: string,
): Promise<LastEntity | null> => {
  const { data } = await admin.from("integrations").select("metadata")
    .eq("provider", provider).eq("user_id", userId).maybeSingle();
  const le = (data?.metadata as { last_entity?: LastEntity } | null)?.last_entity;
  return le && le.type && le.id ? le : null;
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `deno test --allow-net supabase/functions/_shared/agent/media_test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/agent/media.ts supabase/functions/_shared/agent/media_test.ts
git commit -m "feat(bot): shared media module (transcribe, attach, last_entity)"
```

---

## Task 2: Record `last_entity` after create/update

The default attach target is whatever the user last created or edited. Record it centrally in `executePending`.

**Files:**
- Modify: `supabase/functions/_shared/agent/agentActions.ts`

- [ ] **Step 1: Import the helper + type**

At the top of `agentActions.ts`:

```typescript
import { setLastEntity, type LastEntity } from "./media.ts";
```

- [ ] **Step 2: Capture the entity in `executePending`**

In `executePending`, declare a holder at the top of the `try` block (before the `switch`):

```typescript
  let lastEntity: LastEntity | null = null;
```

Then in each create/update case, set `lastEntity` where the id is available. The create cases currently `.select("name")` / `.select("title")` etc.; widen the select to include the primary key and capture it. Concrete edits:

- `create_task` — change the insert select to `.select("task_id, title")` and after success add:
  ```typescript
        lastEntity = { type: "task", id: (data as { task_id: string }).task_id, label: (data as { title: string }).title };
  ```
- `create_deal` — change to `.select("deal_id, title")` and add:
  ```typescript
        lastEntity = { type: "deal", id: (data as { deal_id: string }).deal_id, label: (data as { title: string }).title };
  ```
- `create_client` — `.select("client_id, name")` → `lastEntity = { type: "client", id: data.client_id, label: data.name }`.
- `create_lead` — already `.select("lead_number, last_name, company")`; add `lead_id`: `.select("lead_id, lead_number, last_name, company")` → `lastEntity = { type: "lead", id: data.lead_id, label: \`${data.last_name} (${data.company})\` }`.
- `create_contact` — `.select("contact_id, last_name")` → `lastEntity = { type: "contact", id: data.contact_id, label: data.last_name }`.
- `create_meeting` — `.select("meeting_id, title")` → `lastEntity = { type: "meeting", id: data.meeting_id, label: data.title }`.
- `create_call` — `.select("call_id, subject")` → `lastEntity = { type: "call", id: data.call_id, label: data.subject }`.
- `update` — after a successful update, if the entity is attachable add:
  ```typescript
        if (ATTACH_ENTITY_TYPES.has(cfg.entity)) {
          lastEntity = { type: cfg.entity, id: targetId, label: cfg.label };
        }
  ```
  (Add `ATTACH_ENTITY_TYPES` to the `media.ts` import.)

(`create_workspace`, `create_project`, `create_client_task`, `log_note` are not attachable entity types — leave `lastEntity` null for them.)

- [ ] **Step 3: Write `last_entity` before the `finally` cleanup**

In `executePending`, the `try` returns a string in each case. To record `lastEntity` without rewriting every `return`, restructure so the message is computed then recorded. Simplest: wrap the existing switch return value. Change each `return \`✅ ...\`;` is invasive — instead, set `lastEntity` in the cases (Step 2) and add this just inside the `finally` block, before the delete:

```typescript
  } finally {
    if (lastEntity) {
      try { await setLastEntity(admin, row.provider, row.user_id, lastEntity); }
      catch (e) { console.warn("setLastEntity failed:", e); }
    }
    await admin.from("agent_pending_actions").delete().eq("id", pendingId);
  }
```

> `lastEntity` is declared in the `try` scope; move its declaration up to the function scope (just after the `const a = row.action ...` line, outside the `try`) so the `finally` can read it.

- [ ] **Step 4: Type-check + test**

Run: `deno check supabase/functions/_shared/agent/agentActions.ts && deno test supabase/functions/_shared/agent/`
Expected: no type errors; all existing tests still PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/agent/agentActions.ts
git commit -m "feat(bot): record last_entity after create/update for media attach target"
```

---

## Task 3: Telegram `downloadMedia`

**Files:**
- Modify: `supabase/functions/telegram-webhook/telegram.ts`

- [ ] **Step 1: Add `downloadMedia`**

In `telegram.ts`, add:

```typescript
export interface DownloadedMedia {
  bytes: Uint8Array;
  mimeType: string;
  fileName: string;
}

/** Fetch a Telegram file by file_id: getFile → download from the file API. */
export const downloadMedia = async (
  fileId: string,
  mimeHint: string,
  fileNameHint: string,
): Promise<DownloadedMedia> => {
  const file = await tg("getFile", { file_id: fileId }); // { file_path, ... }
  const path = (file as { file_path: string }).file_path;
  const res = await fetch(`https://api.telegram.org/file/bot${BOT_TOKEN}/${path}`);
  if (!res.ok) throw new Error(`telegram file download failed: ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  return { bytes, mimeType: mimeHint || "application/octet-stream", fileName: fileNameHint || path.split("/").pop() || "file" };
};
```

- [ ] **Step 2: Type-check**

Run: `deno check supabase/functions/telegram-webhook/telegram.ts`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/telegram-webhook/telegram.ts
git commit -m "feat(bot): telegram downloadMedia via getFile"
```

---

## Task 4: WhatsApp `downloadMedia`

**Files:**
- Modify: `supabase/functions/whatsapp-webhook/whatsapp.ts`

- [ ] **Step 1: Add `downloadMedia`**

In `whatsapp.ts`, add (it needs the access token + api version already defined at the top):

```typescript
export interface DownloadedMedia {
  bytes: Uint8Array;
  mimeType: string;
  fileName: string;
}

/** Resolve a WhatsApp media id to a temporary URL, then download the bytes.
 *  Both calls require the bearer token. */
export const downloadMedia = async (
  mediaId: string,
  fileNameHint: string,
): Promise<DownloadedMedia> => {
  const metaRes = await fetch(`https://graph.facebook.com/${API_VERSION}/${mediaId}`, {
    headers: { authorization: `Bearer ${ACCESS_TOKEN}` },
  });
  if (!metaRes.ok) throw new Error(`whatsapp media meta failed: ${metaRes.status}`);
  const meta = await metaRes.json() as { url: string; mime_type: string };
  const binRes = await fetch(meta.url, { headers: { authorization: `Bearer ${ACCESS_TOKEN}` } });
  if (!binRes.ok) throw new Error(`whatsapp media download failed: ${binRes.status}`);
  const bytes = new Uint8Array(await binRes.arrayBuffer());
  return { bytes, mimeType: meta.mime_type || "application/octet-stream", fileName: fileNameHint || `file-${mediaId}` };
};
```

- [ ] **Step 2: Type-check**

Run: `deno check supabase/functions/whatsapp-webhook/whatsapp.ts`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/whatsapp-webhook/whatsapp.ts
git commit -m "feat(bot): whatsapp downloadMedia via media id"
```

---

## Task 5: Telegram — detect + handle media

**Files:**
- Modify: `supabase/functions/telegram-webhook/index.ts`
- Modify: `supabase/functions/telegram-webhook/handlers.ts`

- [ ] **Step 1: Extend the update type + detection in `index.ts`**

In `telegram-webhook/index.ts`, extend the `TgUpdate.message` shape:

```typescript
  message?: {
    chat: { id: number };
    from?: { id: number; username?: string };
    text?: string;
    caption?: string;
    voice?: { file_id: string; mime_type?: string };
    audio?: { file_id: string; mime_type?: string; file_name?: string };
    document?: { file_id: string; mime_type?: string; file_name?: string };
    photo?: Array<{ file_id: string }>;
  };
```

Add `handleMedia` to the imports from `./handlers.ts`, and in the message branch — after the linked-account check and before `handleNaturalLanguage` — detect media. Place this so media is handled even when there's no `text`:

```typescript
    const media = msg.voice
      ? { kind: "voice" as const, fileId: msg.voice.file_id, mime: msg.voice.mime_type ?? "audio/ogg", name: "voice.ogg" }
      : msg.audio
      ? { kind: "audio" as const, fileId: msg.audio.file_id, mime: msg.audio.mime_type ?? "audio/mpeg", name: msg.audio.file_name ?? "audio.mp3" }
      : msg.document
      ? { kind: "document" as const, fileId: msg.document.file_id, mime: msg.document.mime_type ?? "application/octet-stream", name: msg.document.file_name ?? "file" }
      : (msg.photo && msg.photo.length)
      ? { kind: "photo" as const, fileId: msg.photo[msg.photo.length - 1].file_id, mime: "image/jpeg", name: "photo.jpg" }
      : null;
    if (media) {
      await handleMedia(admin, chatId, account, media, msg.caption);
      return new Response("ok");
    }
```

> Note: the existing early `if (!msg?.from || !msg.text) return` guard returns before media is seen. Change it to `if (!msg?.from) return new Response("ok");` and move the `text`-specific slash-command handling under an `if (msg.text)` guard so media-only messages reach the media branch.

- [ ] **Step 2: Add `handleMedia` to `telegram-webhook/handlers.ts`**

Add the imports:

```typescript
import { downloadMedia } from "./telegram.ts";
import { transcribeAudio, attachToEntity, loadLastEntity, ATTACH_ENTITY_TYPES } from "../_shared/agent/media.ts";
```

Add the function:

```typescript
type TgMedia = { kind: "voice" | "audio" | "document" | "photo"; fileId: string; mime: string; name: string };

export const handleMedia = async (
  admin: SupabaseClient,
  chatId: number,
  account: LinkedAccount,
  media: TgMedia,
  caption: string | undefined,
): Promise<void> => {
  const dl = await downloadMedia(media.fileId, media.mime, media.name);

  // Voice/audio → transcribe → run as a normal typed command.
  if (media.kind === "voice" || media.kind === "audio") {
    let transcript = "";
    try {
      transcript = await transcribeAudio(dl.bytes, dl.mimeType);
    } catch {
      await sendMessage(chatId, "Couldn't transcribe that voice note — try typing it.");
      return;
    }
    if (!transcript) {
      await sendMessage(chatId, "I couldn't hear anything in that clip.");
      return;
    }
    await handleNaturalLanguage(admin, chatId, account, transcript);
    return;
  }

  // Image/document → attach to the last-touched record.
  const target = await loadLastEntity(admin, "telegram", account.user_id);
  if (!target || !ATTACH_ENTITY_TYPES.has(target.type)) {
    await sendMessage(chatId, "I don't know what to attach this to yet. Create or open a record first (e.g. `new client Acme`), then resend the file.");
    return;
  }
  try {
    await attachToEntity(admin, account.current_org_id, account.user_id, target.type, target.id, dl.bytes, dl.mimeType, dl.fileName);
    await sendMessage(chatId, `📎 Attached *${dl.fileName}* to ${target.type} *${target.label}*.`);
  } catch (err) {
    await sendMessage(chatId, `❌ Couldn't attach that: ${(err as Error).message}`);
  }
};
```

- [ ] **Step 3: Type-check**

Run: `deno check supabase/functions/telegram-webhook/index.ts`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/telegram-webhook/index.ts supabase/functions/telegram-webhook/handlers.ts
git commit -m "feat(bot): telegram media — voice→command, file→attach"
```

---

## Task 6: WhatsApp — detect + handle media

**Files:**
- Modify: `supabase/functions/whatsapp-webhook/index.ts`
- Modify: `supabase/functions/whatsapp-webhook/handlers.ts`

- [ ] **Step 1: Detect media in `whatsapp-webhook/index.ts`**

The inbound message type already includes `image|audio|document` in the union. Extend the message interface fields:

```typescript
      image?: { id: string; mime_type?: string; caption?: string };
      audio?: { id: string; mime_type?: string; voice?: boolean };
      document?: { id: string; mime_type?: string; filename?: string; caption?: string };
```

In `handleOne`, after the interactive/button handling and before the `m.type !== "text"` early-return, add:

```typescript
  if (m.type === "audio" && m.audio) {
    await handleMedia(admin, phoneNumber, { kind: "audio", mediaId: m.audio.id, mime: m.audio.mime_type ?? "audio/ogg", name: "voice.ogg" }, undefined);
    return;
  }
  if (m.type === "image" && m.image) {
    await handleMedia(admin, phoneNumber, { kind: "image", mediaId: m.image.id, mime: m.image.mime_type ?? "image/jpeg", name: "image.jpg" }, m.image.caption);
    return;
  }
  if (m.type === "document" && m.document) {
    await handleMedia(admin, phoneNumber, { kind: "document", mediaId: m.document.id, mime: m.document.mime_type ?? "application/octet-stream", name: m.document.filename ?? "file" }, m.document.caption);
    return;
  }
```

Add `handleMedia` to the imports from `./handlers.ts`.

- [ ] **Step 2: Add `handleMedia` to `whatsapp-webhook/handlers.ts`**

Add the imports:

```typescript
import { downloadMedia } from "./whatsapp.ts";
import { transcribeAudio, attachToEntity, loadLastEntity, ATTACH_ENTITY_TYPES } from "../_shared/agent/media.ts";
```

Add the function (note: WhatsApp `handleMedia` first resolves the linked account itself, since `handleOne` calls it before the account lookup):

```typescript
type WaMedia = { kind: "audio" | "image" | "document"; mediaId: string; mime: string; name: string };

export const handleMedia = async (
  admin: SupabaseClient,
  phoneNumber: string,
  media: WaMedia,
  caption: string | undefined,
): Promise<void> => {
  const account = await findLinkedAccount(admin, phoneNumber);
  if (!account) {
    await sendMessage(phoneNumber, "🔗 This number isn't linked. Send /start <code> first.");
    return;
  }
  const dl = await downloadMedia(media.mediaId, media.name);

  if (media.kind === "audio") {
    let transcript = "";
    try {
      transcript = await transcribeAudio(dl.bytes, dl.mimeType);
    } catch {
      await sendMessage(phoneNumber, "Couldn't transcribe that voice note — try typing it.");
      return;
    }
    if (!transcript) {
      await sendMessage(phoneNumber, "I couldn't hear anything in that clip.");
      return;
    }
    await handleNaturalLanguage(admin, account, transcript);
    return;
  }

  const target = await loadLastEntity(admin, PROVIDER, account.user_id);
  if (!target || !ATTACH_ENTITY_TYPES.has(target.type)) {
    await sendMessage(phoneNumber, "I don't know what to attach this to yet. Create or open a record first (e.g. new client Acme), then resend the file.");
    return;
  }
  try {
    await attachToEntity(admin, account.current_org_id, account.user_id, target.type, target.id, dl.bytes, dl.mimeType, dl.fileName);
    await sendMessage(phoneNumber, `📎 Attached ${dl.fileName} to ${target.type} ${target.label}.`);
  } catch (err) {
    await sendMessage(phoneNumber, `❌ Couldn't attach that: ${(err as Error).message}`);
  }
};
```

- [ ] **Step 3: Type-check**

Run: `deno check supabase/functions/whatsapp-webhook/index.ts`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/whatsapp-webhook/index.ts supabase/functions/whatsapp-webhook/handlers.ts
git commit -m "feat(bot): whatsapp media — voice→command, file→attach"
```

---

## Task 7: Deploy + verify

- [ ] **Step 1: Set the transcription model secret (optional)**

Default is `whisper-1`. To override: in Supabase → Edge Functions → Secrets set `OPENAI_TRANSCRIBE_MODEL` (e.g. `gpt-4o-mini-transcribe`). Confirm `OPENAI_API_KEY` is already set (reused).

- [ ] **Step 2: Deploy**

```bash
npx supabase functions deploy telegram-webhook --no-verify-jwt
npx supabase functions deploy whatsapp-webhook --no-verify-jwt
```

- [ ] **Step 3: Voice → command (both bots)**

Send a voice note saying "new client Voice Test Co". Expect the normal confirm flow ("Create client *Voice Test Co*?"), then confirm → client created. (Transcript is used silently — no separate "Heard:" message, per the locked decision.)

- [ ] **Step 4: Image → attach**

Right after creating a record (so `last_entity` is set), send a photo. Expect "📎 Attached photo.jpg to client *Voice Test Co*." Verify in the app: the file appears in that client's attachments related-list.

- [ ] **Step 5: Document → attach**

Send a PDF. Expect it attached to the same last-touched record with the real filename.

- [ ] **Step 6: No-target case**

Unlink + relink a fresh chat (clears `last_entity`), send a photo before creating anything. Expect the "I don't know what to attach this to yet" guidance, not a silent drop.

- [ ] **Step 7: Bad audio**

Send a 1-second silent clip. Expect a graceful "couldn't hear anything" / "couldn't transcribe" message, never a 500.

---

## Self-Review

**Spec coverage (§6):** voice→transcribe→run-as-typed (Tasks 5/6 call `handleNaturalLanguage` with the transcript) ✓; image/doc→`attachToEntity` against `last_entity` (Task 1 + 2 + 5/6) ✓; provider downloads (Tasks 3/4) ✓; default target = last-touched record (Task 2 records it; Tasks 5/6 read it) ✓; no-target prompt + transcription-failure messages (Tasks 5/6) ✓; reuses migration-116 `attachments` table/bucket ✓; webhooks still return 200 (handlers swallow + message on error) ✓.

**Placeholder scan:** The `last_entity` capture per create-case is given as concrete `.select()` + assignment edits (Task 2 Step 2) — explicit, not "similar to". All shared code shown in full.

**Type consistency:** `DownloadedMedia { bytes, mimeType, fileName }` is the same shape from both providers' `downloadMedia` and is consumed identically in both `handleMedia`s. `transcribeAudio(bytes, mime)` and `attachToEntity(admin, org, user, type, id, bytes, mime, name)` signatures match call sites and tests. `LastEntity { type, id, label }` written by `setLastEntity` (Task 2) and read by `loadLastEntity` (Tasks 5/6). `ATTACH_ENTITY_TYPES` gates both the attach call and the `last_entity` recording.

**Cross-phase note:** This completes the 5-phase spec. After all phases land, unify the two `HELP_TEXT` strings (Telegram's still lists only PM examples) to advertise queries/edits/media — a small follow-up not blocking any phase.
