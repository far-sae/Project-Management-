# Calls: floating mini window + guest links with a waiting room

Date: 2026-11-09
Status: approved design, awaiting implementation plan

Two independent features for the in-app LiveKit calls. They touch the same
files (`CallOverlay`, `CallProvider`, `LiveKitCallService`) so they are
designed together, but can be built and shipped in either order.
Suggested order: **A (floating window) first** — smaller, no server work.

---

## A. Floating mini call window ("like Google Meet")

### Why
The call UI lives inside the TaskCalendar tab. The moment a user switches to
another tab, window or app — most often right after starting a screen share —
the call disappears: they can't see faces, who is talking, or the controls.
Google Meet solves this with a small always-on-top window. The owner wants
the same.

### Goals
- **Any time** the call tab becomes hidden during an active call
  (`connecting`, `connected`, `reconnecting`), a small floating window opens
  automatically on top of other windows. Not only while screen sharing.
- It closes automatically when the user returns to the call tab, or when the
  call ends.
- Contents:
  - main tile: the active speaker (else first remote). If a *remote* person is
    sharing their screen, show that share. **Never show the local user's own
    screen share** (mirror effect) — show other people instead.
  - a small strip of the other participants' faces (local user included,
    small).
  - controls: mute, camera, stop sharing (only while sharing), hang up,
    and "back to call" (focus the call tab / close the mini window).
- A manual **"Pop out"** button in the full call header for when the
  automatic open doesn't fire.
- **Browser limitation (Claude's call, owner to be told):** Chrome only fires
  automatic picture-in-picture when the user switches to *another tab* (and
  the site is allowed to). Switching to another window/app usually doesn't
  hide the tab, so nothing fires. Therefore the mini window also opens
  **when the user starts sharing their screen** (using that click), and it
  stays open while sharing even if the call tab is visible; it closes when
  sharing stops *and* the call tab is visible, or when the call ends.
  Builder must verify that the share click's user activation can open the
  PiP window (order: try opening PiP before `getDisplayMedia`, else after;
  if Chrome refuses, fall back to highlighting the "Pop out" button).

### How (decided by Claude — builder may adjust details)
- **Chrome / Edge:** Document Picture-in-Picture API
  (`documentPictureInPicture.requestWindow`).
  - Automatic open: register
    `navigator.mediaSession.setActionHandler('enterpictureinpicture', …)`
    while a call is active (Chrome's "automatic picture-in-picture" for
    sites using camera/mic). Clear the handler when the call ends.
  - Manual open: the "Pop out" button (user gesture).
  - Render the mini UI into the PiP window with a React portal; copy the
    app's stylesheets into the PiP document so Tailwind classes work.
- **Other browsers (Firefox, Safari):** no Document PiP. Fall back to
  `HTMLVideoElement.requestPictureInPicture()` on the main tile's video from
  the "Pop out" button (no controls inside). Hide the button where neither
  API exists. No automatic open on these browsers.
- **Audio stays in the main page.** Remote `<audio>` sinks must remain in
  the main document (they keep playing while the tab is hidden). Only video
  tiles + controls render in the PiP window. Never duplicate audio sinks.
- Reuse existing `ParticipantTile` / `CallControls` (compact variant) where
  practical. `attachStream` already handles `srcObject` + `play()`.

### Non-goals
- Virtual backgrounds, chat, or recording controls inside the mini window.
- Changing the in-app layout while sharing (owner said it looks fine).

### Anti-goals (failure even if it "works")
- Audio cutting out or doubling when the mini window opens/closes.
- The mini window staying open after the call has ended.
- The presenter seeing their own screen inside their own mini window.

---

## B. Guest links for people outside the organisation (clients)

### Why
Clients and other outsiders need to join calls without a TaskCalendar
account. The owner wants Meet-style safety: **guests wait in a lobby until
someone in the call admits them**, so a forwarded link can't let a stranger
straight in.

### Goals / user flow
0. **Start a meeting without ringing (Claude's call — required).** Today a
   call only exists once a teammate answers: `startCall` needs someone to
   ring and tears the room down after 30s unanswered. A client call is often
   one member + the client, so add a **"Start meeting"** option on the
   project call button: the member joins the project room straight away,
   nobody is rung, there is no ring timeout, and the call counts as live
   (status `connected`, alone) — `shouldEndCallWhenAlone` must not end a
   meeting the member started alone; it ends when they hang up. "Invite
   guest" is also available while an outgoing ring is in progress.
   Admitting a guest during an outgoing ring does **not** cancel teammates'
   rings. No notification to absent members that a guest is waiting
   (out of scope) — the member who shares the link is expected to be in
   the meeting.
1. **Create link.** During an active call, any team member in the call clicks
   **"Invite guest"**. A link is copied to the clipboard
   (`https://taskcalendar.co.uk/join/<token>`), with a toast confirming.
   The member shares it however they like (WhatsApp, email…).
2. **Link scope.** The link only opens **that one call room** (the project
   room `project:<id>`, or that DM room `dm:<a>__<b>`). It expires **24 hours**
   after creation (Claude's call).
3. **Guest page** (`/join/:token`, public — no login, no sidebar, outside
   `AppLayout`/`ProtectedRoute`, like `/accept-invite/:token`):
   - shows what they're joining (call label, e.g. project name, and who
     invited them), a **name** field (required, ≤ 60 chars), a camera + mic
     preview with on/off toggles, and **"Ask to join"**.
   - after clicking: "Waiting for someone to let you in…" screen with a
     Cancel button.
   - if no team member is in the call: "Waiting for the host to join…"
     (same waiting screen; they're let in once a member joins and admits).
4. **Admit / deny.** Every team member currently in the call sees a prompt:
   "**<Name> (guest) wants to join** — Admit · Deny". Shown in the full
   overlay and the mini window/PiP. First member to click wins.
   - Admit → guest enters the call.
   - Deny → guest sees "You weren't let into the call." and is disconnected.
5. **In the call**, guests see/hear everything members do and can mute,
   toggle camera and leave. Their tile is labelled **"Guest"**.
6. **Guests cannot:** record, invite others, admit others, share their
   screen (Claude's call — easy to flip later), or reach any other part of
   TaskCalendar.
7. Expired / invalid link → friendly "This link has expired, ask for a new
   one" page.
8. **Recording transparency (owner's decision).** Members may still record
   when guests are present, but guests must be told:
   - the join page says **"This call may be recorded."**
   - while anyone is recording, **every** participant (guests and members)
     sees a live **"Recording"** badge — not only the person recording.
   - How (Claude's call): the recording member sets a LiveKit participant
     attribute (e.g. `recording: "1"`, cleared on stop/hang-up); clients
     show the badge when any participant has it. `livekit-token` must add
     `canUpdateOwnMetadata: true` to member grants for this; guests don't
     get it.
   - Guest audio and transcripts may be saved to project chat as today.

### How (decided by Claude — builder may adjust details)
**Waiting room via LiveKit permissions** — no extra realtime channel:
- The guest joins the LiveKit room with a token that has
  `canSubscribe: false, canPublish: false, canPublishData: false` and
  participant **metadata** `{"role":"guest","status":"waiting"}`,
  identity `guest:<random>`, name = typed name. So a waiting guest can't see
  or hear anything.
- Members' clients detect waiting guests (metadata) and show the prompt.
  Waiting guests are **excluded** from tiles, participant counts, the
  "call connected" transition, and `shouldEndCallWhenAlone` remote counts.
- Admit → server calls LiveKit `RoomService.UpdateParticipant` to grant
  `canSubscribe/canPublish/canPublishData` (publish sources: camera +
  microphone only) and set metadata `status: "admitted"`. The guest client
  reacts to `ParticipantPermissionsChanged` / metadata change and shows the
  call. Deny → `RoomService.RemoveParticipant`.
- A guest still waiting after **10 minutes** is shown "No one let you in"
  and disconnected (client-side timer; Claude's call).
- **Guests never outlive the team in a room (Claude's call).** Project rooms
  are reused and guest tokens last 2h, so an admitted guest left behind
  must not see the next call:
  - server-enforced: whenever a member gets a token for a room
    (`livekit-token`), the server lists the room's participants via
    RoomService; if **only guests** are in it, it removes them before
    returning the token. (No webhook needed.)
  - client courtesy: the guest page disconnects itself with "The meeting
    has ended" when no team member remains in the room.
- **Who may invite/admit (Claude's call):** same rule as starting calls in
  the UI — view-only users can't. `create-invite`, `admit`, `deny` require
  `can_access_project` **and** a non-viewer role (`project_access_role` /
  `is_org_viewer`, both in prod since migration 166).

**Server (Supabase Edge Function, new `call-guest`)**, actions:
- `create-invite` (signed-in member): verify the caller may use the room —
  `project:<id>` → `can_access_project(<id>)` RPC run with the caller's JWT
  (function exists in prod, migration 166); `dm:<a>__<b>` → caller is a or b.
  Returns a **signed, stateless invite token**: HMAC-SHA256 over
  `{room, exp, label, inviterName}` using a new secret
  `CALL_INVITE_SECRET` (fallback: derive from `LIVEKIT_API_SECRET` only if
  the builder prefers not to add a secret — must not reuse it raw).
- `guest-join` (no Supabase session — called with the anon key): verify
  signature + expiry, validate name, mint a 2-hour LiveKit token with the
  waiting-room grants above. Returns `{token, url, label}`.
- `admit` / `deny` (signed-in member): same room access check as
  `create-invite`, then call LiveKit's Twirp API
  (`https://<LIVEKIT_URL host>/twirp/livekit.RoomService/...`) with a
  server JWT carrying `roomAdmin: true` for that room. Only identities
  starting with `guest:` may be admitted/denied.
- CORS via `ALLOWED_ORIGINS` like `livekit-token`.

**Client**
- `LiveKitCallService`: accept a pre-minted `{token,url}` (guest path) in
  addition to fetching one; expose guest metadata/permission state in
  `CallPeerSnapshot` (e.g. `role`, `isWaiting`).
- Members: "Invite guest" button + waiting-guest prompt in `CallOverlay`;
  "Guest" label on tiles.
- Guest page: a self-contained `GuestCallPage` that drives
  `LiveKitCallService` directly (it must not depend on `AuthContext` /
  `CallProvider`, which assume a signed-in user), reusing `ParticipantTile`
  and `CallControls`. Recording/invite controls hidden.

### Constraints / facts the builder should know
- Production LiveKit + Supabase project: `cotrbcnouzcjdruiqmly`.
  `ALLOWED_ORIGINS` = `https://taskcalendar.co.uk` (localhost is blocked).
- `livekit-token` currently only checks room-name *shape*, not membership
  (any signed-in user can mint a token for any project room). Out of scope
  here, but don't copy that gap into `call-guest`.
- Every call room is reused per project, so an invite for `project:<id>`
  works for any call in that project during its 24h — acceptable.

### Non-goals
- Scheduling meetings / emailing invites from the app.
- Revoking a single link before it expires.
- Guest screen sharing, chat, or recording.
- A persistent guest list or analytics.

### Anti-goals (failure even if it "works")
- A guest seeing or hearing anything before being admitted.
- A guest reaching any TaskCalendar data or page beyond the call.
- A forwarded/old link letting someone in without a member's approval.
- A team member's call ending or showing "connected" because of a
  waiting guest.

### Left to the builder
- Exact UI styling, copy, and placement of buttons/prompts.
- Mini-window size (≈ 320×240 suggested), layout of the face strip.
- Test strategy (unit tests for invite signing/verification and the
  waiting-guest filtering are expected; browser APIs can be mocked).
