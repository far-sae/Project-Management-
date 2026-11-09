# Call Guest Links + Waiting Room Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Team members can invite people without an account (clients) into a call via a link; guests wait in a lobby until a member admits them.

**Architecture:** A new `call-guest` Supabase Edge Function issues signed, stateless 24h invite tokens and LiveKit tokens for guests with *no* subscribe/publish rights plus `role: guest, status: waiting` metadata. Members' clients show waiting guests and call `admit`/`deny`, which the function performs through LiveKit's RoomService API. A public `/join/:token` page drives `LiveKitCallService` directly. A "Start meeting" entry lets a member open a project room without ringing anyone.

**Tech Stack:** React 18 + TS, Vitest, Supabase Edge Functions (Deno, `djwt@v3.0.2` already used by `livekit-token`), LiveKit Cloud (Twirp RoomService), livekit-client 2.x.

**Spec:** `docs/superpowers/specs/2026-11-09-call-floating-window-and-guest-links-design.md` — section **B**.

## Global Constraints

- Link: `https://taskcalendar.co.uk/join/<token>`; valid **24 hours**; only for the one room it names (`project:<id>` or `dm:<a>__<b>`).
- Guest identity `guest:<random>`; display name required, trimmed, **≤ 60 chars**; guest LiveKit token TTL **2 hours**.
- Waiting guest grants: `canSubscribe: false, canPublish: false, canPublishData: false`; metadata `{"role":"guest","status":"waiting"}`.
- Admitted guest grants: `canSubscribe: true, canPublish: true, canPublishData: true, canPublishSources: [CAMERA, MICROPHONE]`; metadata status `"admitted"`. Guests never get screen share, recording, invite, or admit.
- Waiting guest gives up after **10 minutes** ("No one let you in").
- `create-invite`, `admit`, `deny`: caller must pass `can_access_project(<projectId>)`, have `project_access_role(<projectId>) <> 'viewer'`, and `is_org_viewer(<orgId>) = false` (project rooms); for `dm:<a>__<b>` the caller must be `a` or `b`. Only identities starting `guest:` may be admitted/denied.
- Invite signing secret: new Edge Function secret `CALL_INVITE_SECRET` (random ≥ 32 bytes). Never reuse `LIVEKIT_API_SECRET` raw.
- Copy (exact): join page notice **"This call may be recorded."**; prompt **"<Name> (guest) wants to join"** with **Admit** / **Deny**; tile label **"Guest"**; badge **"Recording"**; expired page **"This link has expired — ask for a new one."**; denied **"You weren't let into the call."**; timeout **"No one let you in."**; meeting over **"The meeting has ended."**
- Recording badge visible to **every** participant whenever **any** participant has attribute `recording = "1"`.
- CORS via `ALLOWED_ORIGINS` (same as `livekit-token`). Production origin `https://taskcalendar.co.uk`.

## Review Focus

1. **Waiting guest leaks into member UI** (tile, "N people", `connected` transition, or `shouldEndCallWhenAlone` count) → waiting guests must be invisible except in the admit prompt. Tests in Task 3 (`visiblePeers`) and Task 5.
2. **Tampered or expired invite token** (edited room, edited `exp`, wrong signature, malformed base64) → `guest-join` rejects; page shows the expired copy. Tests in Task 1.
3. **Member alone in "Start meeting" for a long time** → never auto-ended by `shouldEndCallWhenAlone`; only hang-up ends it. Test in Task 5.
4. **Two members click Admit at once / admit a guest who already left** → second call is harmless (LiveKit `UpdateParticipant` 404 → function returns `{ ok: true, gone: true }`), UI prompt disappears. Test in Task 2 (`classifyRoomServiceError`).
5. **Guest name with HTML/emoji/whitespace-only or 200 chars** → trimmed, whitespace-only rejected, truncated to 60, rendered as text. Test in Task 1 (`normalizeGuestName`).

---

### Task 1: Invite token + guest name helpers (shared, pure)

**Files:**
- Create: `supabase/functions/_shared/callInvite.ts` (no remote imports — must load under Vitest)
- Test: `tests/unit/callInvite.test.ts` (import via `@/supabase-functions/_shared/callInvite.ts`)

**Interfaces — Produces:**
- `interface InvitePayload { room: string; exp: number /* unix seconds */; label: string; inviterName: string }`
- `signInvite(p: InvitePayload, secret: string): Promise<string>` → `base64url(JSON) + '.' + base64url(HMAC-SHA256)` using `crypto.subtle`.
- `verifyInvite(token: string, secret: string, nowSec: number): Promise<InvitePayload | null>` — null on bad format, bad signature (constant-time compare), `exp <= nowSec`, or room failing `isValidRoomName`.
- `isValidRoomName(name: string): boolean` — same rules as `livekit-token` (`project:[A-Za-z0-9_:-]{1,128}` or `dm:<a>__<b>`).
- `normalizeGuestName(raw: unknown): string | null` — trim, collapse whitespace, null if empty, slice to 60.
- `INVITE_TTL_SECONDS = 24 * 60 * 60`

- [ ] **Step 1: Failing tests:** round-trip sign→verify returns payload; verify fails when payload room edited, when signature edited, when `exp` passed (`nowSec = exp`), for `'garbage'`, `'a.b.c'`, and for room `'other:x'`; `normalizeGuestName('  Jane   Doe ') === 'Jane Doe'`, `('   ') === null`, `(42) === null`, `('x'.repeat(200)).length === 60`.
- [ ] **Step 2: Run** `npx vitest run tests/unit/callInvite.test.ts` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(calls): signed guest invite tokens`

---

### Task 2: `call-guest` Edge Function + `livekit-token` changes

**Files:**
- Create: `supabase/functions/_shared/livekitRoles.ts` (pure, no remote imports)
- Create: `supabase/functions/call-guest/index.ts`
- Modify: `supabase/functions/livekit-token/index.ts`
- Test: `tests/unit/livekitRoles.test.ts`

**Interfaces — Produces (`livekitRoles.ts`):**
- `livekitHttpUrl(wsUrl: string): string` — `wss://h` → `https://h`, `ws://h` → `http://h`, strips trailing `/`.
- `isGuestIdentity(id: string): boolean` — starts with `guest:`.
- `guestWaitingGrant(room)`, `guestAdmittedPermission()`, `GUEST_WAITING_METADATA = '{"role":"guest","status":"waiting"}'`, `GUEST_ADMITTED_METADATA = '{"role":"guest","status":"admitted"}'`.
- `onlyGuestsRemain(identities: string[]): boolean` — true when non-empty and every identity is a guest.
- `classifyRoomServiceError(status: number): 'gone' | 'error'` — 404 → `'gone'`.

**`call-guest` actions** (POST JSON `{ action, ... }`, responses JSON):
- `create-invite { roomName }` (requires `Authorization: Bearer <user JWT>`) → access check per Global Constraints using a Supabase client created with the caller's JWT (so `auth.uid()` works in the RPCs) → `{ url: 'https://taskcalendar.co.uk/join/' + token, expiresAt }`. `label` = project name (projects table) or `'Call with <inviterName>'` for DMs.
- `guest-join { invite, name }` (anon key only) → `verifyInvite` + `normalizeGuestName` → LiveKit token (2h) with `guestWaitingGrant`, metadata `GUEST_WAITING_METADATA`, identity `guest:<crypto.randomUUID()>` → `{ token, url, label, identity }`. Errors: `410 {code:'INVITE_EXPIRED'}`, `400 {code:'BAD_NAME'}`.
- `admit { roomName, identity }` / `deny { roomName, identity }` (user JWT) → access check; reject non-guest identity (400); admin JWT (`roomAdmin: true, room`) → `POST {livekitHttpUrl}/twirp/livekit.RoomService/UpdateParticipant` with `{ room, identity, permission: guestAdmittedPermission(), metadata: GUEST_ADMITTED_METADATA }` or `RemoveParticipant {room, identity}` → `{ ok: true }` / `{ ok: true, gone: true }`.

**`livekit-token` changes:**
- Member grant gains `canUpdateOwnMetadata: true` (needed for the recording attribute).
- Before returning a member token: `ListParticipants {room}`; if `onlyGuestsRemain(identities)` → `RemoveParticipant` each, then continue. Failures here are logged and ignored (room may not exist yet → 404).

- [ ] **Step 1: Failing tests** for every `livekitRoles.ts` export (`livekitHttpUrl('wss://x.livekit.cloud/') === 'https://x.livekit.cloud'`; `onlyGuestsRemain([]) === false`, `(['guest:a']) === true`, `(['guest:a','u1']) === false`; `classifyRoomServiceError(404) === 'gone'`, `(500) === 'error'`; waiting grant has `canSubscribe/canPublish/canPublishData === false`).
- [ ] **Step 2: Run** `npx vitest run tests/unit/livekitRoles.test.ts` → FAIL.
- [ ] **Step 3: Implement** `livekitRoles.ts`, `call-guest/index.ts`, `livekit-token` changes.
- [ ] **Step 4: Run** → PASS; `deno check` is not available locally — rely on deploy-time bundling.
- [ ] **Step 5: Set secret + deploy** (outward-facing — confirm with the owner first):
  `supabase secrets set CALL_INVITE_SECRET=<openssl rand -base64 48>`; `supabase functions deploy call-guest`; `supabase functions deploy livekit-token`.
  Verify: `curl -X OPTIONS .../functions/v1/call-guest -H "Origin: https://taskcalendar.co.uk"` → 200; `POST {"action":"guest-join","invite":"bad","name":"x"}` with anon key → 410.
- [ ] **Step 6: Commit** `feat(calls): call-guest edge function for guest invites and admission`

---

### Task 3: Client API + participant roles in `LiveKitCallService`

**Files:**
- Create: `src/services/livekit/guestApi.ts`
- Modify: `src/services/livekit/LiveKitCallService.ts`, `src/services/livekit/callHelpers.ts`
- Test: `tests/unit/guestApi.test.ts`, `tests/unit/callRoles.test.ts`

**Interfaces — Produces:**
- `guestApi.ts`: `createGuestInvite(roomName: string): Promise<{ url: string; expiresAt: string }>`, `joinAsGuest(invite: string, name: string): Promise<{ token: string; url: string; label: string; identity: string }>` (throws `Error` with `.code` `'INVITE_EXPIRED' | 'BAD_NAME'` when returned), `admitGuest(roomName, identity): Promise<void>`, `denyGuest(roomName, identity): Promise<void>` — all via `supabase.functions.invoke('call-guest', { body: { action, ... } })`.
- `CallPeerSnapshot` gains `role: 'member' | 'guest'`, `isWaiting: boolean`, `isRecording: boolean`.
- `callHelpers.ts`: `parseParticipantMeta(metadata?: string): { role: 'member'|'guest'; status: 'waiting'|'admitted'|null }` (bad JSON → member); `visiblePeers(peers)` (drops `isWaiting`), `waitingGuests(peers)` (only `isWaiting`), `anyoneRecording(peers): boolean`.
- `LiveKitCallService`:
  - `connect(options & { credentials?: { token: string; url: string }; publishOnConnect?: boolean /* default true */ })` — skips `fetchLiveKitToken` when `credentials` given; skips mic/cam publish when `publishOnConnect === false`.
  - `publishLocalMedia(opts: { mic: boolean; camera: boolean }): Promise<void>`.
  - `setRecordingFlag(on: boolean): Promise<void>` — `localParticipant.setAttributes({ recording: on ? '1' : '' })`, errors → `onError`.
  - Snapshot: `isWaiting` = guest metadata status `'waiting'` (remote) or, for local, `!localParticipant.permissions?.canSubscribe` when local is a guest; `isRecording` = `participant.attributes?.recording === '1'`.
  - Bind `ParticipantMetadataChanged`, `ParticipantAttributesChanged`, `ParticipantPermissionsChanged` → refresh.

- [ ] **Step 1: Failing tests:** guestApi invokes `'call-guest'` with the right `action` bodies and surfaces `.code`; `parseParticipantMeta('{"role":"guest","status":"waiting"}')`, `('nope')`, `(undefined)`; `visiblePeers`/`waitingGuests`/`anyoneRecording` over a mixed list; `LiveKitCallService.connect({ credentials, publishOnConnect:false, ... })` does **not** call `fetchLiveKitToken` (mock `./fetchLiveKitToken` and `livekit-client` `Room`) and does not call `setMicrophoneEnabled`.
- [ ] **Step 2: Run** `npx vitest run tests/unit/guestApi.test.ts tests/unit/callRoles.test.ts` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS, plus full `npx vitest run`.
- [ ] **Step 5: Commit** `feat(calls): guest roles, waiting state and recording flag in call service`

---

### Task 4: Public guest join page

**Files:**
- Create: `src/pages/GuestJoin.tsx`
- Modify: `src/App.tsx` (add `{ path: '/join/:token', element: lazyRoute(<GuestJoin />) }` next to `/accept-invite/:token`, outside `AppLayout`)
- Modify: `src/components/calling/CallControls.tsx` (add `allowScreenShare?: boolean` default `true`; `hideBackgroundEffect`/recording already optional)
- Test: `tests/unit/guestJoinPage.test.tsx`

**Interfaces:** Consumes `joinAsGuest` (Task 3), `LiveKitCallService` (Task 3), exported `ParticipantTile` / `RemoteAudioSink` from `CallOverlay.tsx` (export them), `visiblePeers`, `anyoneRecording`.

Phases (local state machine): `form` → `waiting` → `in-call` → terminal `ended | denied | timeout | expired | error`.
- `form`: label + "Invited by <inviterName>" (decode the invite payload part client-side for display only), name input (max 60), camera/mic preview via `getUserMedia` with toggles, notice "This call may be recorded.", button **Ask to join**.
- `waiting`: "Waiting for someone to let you in…" + Cancel. 10-minute timer → `timeout`. Disconnect reason `PARTICIPANT_REMOVED` while waiting → `denied`.
- `in-call`: entered when local `isWaiting` becomes false → `publishLocalMedia({ mic, camera })` per preview toggles; grid of `visiblePeers` with `RemoteAudioSink`s; `CallControls` with `allowScreenShare={false}`, no recording; "Recording" badge when `anyoneRecording`. If no `role === 'member'` peer remains for 5s → `ended`.
- Stop preview tracks before connecting (avoid holding the camera twice).

- [ ] **Step 1: Failing tests** (mock `guestApi` + `LiveKitCallService`): shows recording notice and disabled Ask to join until a name is typed; expired error → expired copy; after Ask to join shows waiting copy; simulated permissions change → shows the call and calls `publishLocalMedia`; Cancel disconnects.
- [ ] **Step 2: Run** `npx vitest run tests/unit/guestJoinPage.test.tsx` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(calls): public guest join page with waiting room`

---

### Task 5: Member side — Start meeting, Invite guest, admit prompt, Guest label, shared Recording badge

**Files:**
- Modify: `src/services/webrtc/types.ts` (`CallState.isOpenMeeting: boolean`, default `false`)
- Modify: `src/components/calling/CallProvider.tsx`
- Modify: `src/components/calling/CallOverlay.tsx`
- Modify: `src/components/project/ProjectRightRail.tsx` (call buttons ~L1085–1163)
- Test: `tests/unit/callHelpers.test.ts` (extend), `tests/unit/callOverlayGuests.test.tsx`

**Interfaces — Produces:**
- `CallActions.startMeeting(context: CallContext, mediaType: CallMediaType): Promise<void>` — project rooms only; connects to `projectRoomName(context.targetId)` without ringing; state `{ status: 'connected', direction: 'outgoing', isOpenMeeting: true }`; no ring timeout.
- `CallActions.inviteGuest(): Promise<void>` — `createGuestInvite(state.roomName)` → `navigator.clipboard.writeText(url)` → toast "Guest link copied — it works for 24 hours".
- `CallActions.admitGuest(identity: string)`, `CallActions.denyGuest(identity: string)`.
- `shouldEndCallWhenAlone(status: string, remoteCount: number, isOpenMeeting = false): boolean` — always `false` when `isOpenMeeting`.

Behaviour:
- `CallProvider.onParticipantsChange`: compute remotes from `visiblePeers(peers)` for the connected-transition, headline, ring-cancel logic and `shouldEndCallWhenAlone`; store all peers in state (overlay filters).
- Admitting a guest during an outgoing ring must not cancel teammates' rings: ring-cancel logic only counts `role === 'member'` remotes.
- Recording: `handleToggleRecording` calls `setRecordingFlag(true/false)` via a new `CallActions.setRecordingFlag(on: boolean)`; the overlay badge uses `anyoneRecording(state.participants)` instead of only the local recorder.
- Overlay: header buttons **Invite guest** (`UserPlus` icon; hidden for view-only users — pass `canInviteGuests` from the provider, derived from the same `isViewerOrg` rule the rail uses; server enforces anyway). Banner per waiting guest: "<Name> (guest) wants to join" + **Admit** / **Deny** (disable both while the request runs). Tiles of guests show a "Guest" chip. Grids/counts use `visiblePeers`.
- The outgoing ring screen (`isOutgoingRinging` branch in `CallOverlay`) also shows **Invite guest** and any waiting-guest banners, since `state.roomName` is already set while ringing.
- Rail: add a third button **Start meeting** (`CalendarPlus` icon, `aria-label="Start meeting"`) enabled for non-viewers even with no other members.

- [ ] **Step 1: Failing tests:** `shouldEndCallWhenAlone('connected', 0, true) === false`; overlay renders the admit banner text for a waiting guest snapshot and calls `actions.admitGuest('guest:1')` on Admit; waiting guest not rendered as a tile and not counted in "N people"; "Recording" badge shown when a remote snapshot has `isRecording: true`.
- [ ] **Step 2: Run** the two test files → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** full `npx vitest run`, `npx tsc --noEmit -p tsconfig.json`, `npx eslint src tests --ext ts,tsx` → all clean.
- [ ] **Step 5: Manual end-to-end** (production after deploy, or local with `http://localhost:5173` added to `ALLOWED_ORIGINS`): member clicks Start meeting → Invite guest → open link in a private window → name + Ask to join → member sees prompt → Admit → both see/hear each other; Deny path; member starts recording → guest sees "Recording"; member hangs up and starts a new meeting → previous guest is not in it.
- [ ] **Step 6: Commit** `feat(calls): start meeting, guest invites and admission for members`
