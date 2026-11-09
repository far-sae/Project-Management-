# Floating Mini Call Window Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Google-Meet-style floating window that keeps the call visible (faces + controls) on top of other tabs/windows.

**Architecture:** Chrome/Edge use the Document Picture-in-Picture API: a React portal renders a compact call view into the PiP window, opened automatically via the Media Session `enterpictureinpicture` action (tab switch), on screen-share start, or by a "Pop out" button. Other browsers fall back to plain video Picture-in-Picture of the main tile. Audio sinks never move out of the main document.

**Tech Stack:** React 18, TypeScript, Vitest + jsdom, livekit-client 2.x (already wired via `LiveKitCallService`).

**Spec:** `docs/superpowers/specs/2026-11-09-call-floating-window-and-guest-links-design.md` — section **A**.

## Global Constraints

- Opens **any time** the call tab becomes hidden during an active call (`connecting`, `connected`, `reconnecting`) — where the browser allows it — and when the local user **starts screen sharing**.
- Closes when the call ends, or when the call tab is visible again **and** the local user is not sharing.
- Never shows the local user's own screen share as a tile (mirror effect).
- Remote `<audio>` sinks (`RemoteAudioSink`) stay in the main document; never render them in the PiP window, never duplicate them.
- Mini window size ≈ 320×240.
- No new npm dependencies.

## Review Focus

1. **Call ends while the mini window is open** (other side hangs up, or hang-up clicked inside the mini window) → the window must close; no orphan window. Test in Task 2 (`shouldClosePip` with `callActive: false`).
2. **User closes the PiP window with the browser's own ×** → app state resets so "Pop out"/auto-open works again. Test in Task 2 (`pagehide` clears the window).
3. **Only participant is the local user who is sharing** → main tile is the local *camera* (or initials), never the local screen. Test in Task 1.
4. **Browser without Document PiP and without video PiP** (Firefox) → no "Pop out" button, no errors on tab switch. Test in Task 2 (`registerAutoPip` no-op) and Task 1 (`getPipSupport` returns `'none'`).
5. **`setActionHandler('enterpictureinpicture')` throws** (older Chrome throws `TypeError` for unknown actions) → swallowed, call continues. Test in Task 2.

---

### Task 1: Pure helpers — main-tile picking and PiP capability

**Files:**
- Modify: `src/services/livekit/callHelpers.ts`
- Create: `src/services/calling/pip.ts`
- Test: `tests/unit/miniCallHelpers.test.ts`

**Interfaces:**
- Consumes: `CallPeerSnapshot` from `src/services/livekit/LiveKitCallService.ts`.
- Produces:
  - `pickMiniMainTile(peers: CallPeerSnapshot[]): CallPeerSnapshot | null` (in `callHelpers.ts`)
  - `type PipSupport = 'document' | 'video' | 'none'`
  - `getPipSupport(win?: Window): PipSupport` (in `pip.ts`)
  - `copyDocumentStyles(from: Document, to: Document): void` (in `pip.ts`)

- [ ] **Step 1: Write the failing tests**

```ts
// pickMiniMainTile — order: remote screen sharer > remote speaking > first remote > local.
// A local tile is returned only if it is NOT screen sharing; a local sharer
// yields the local snapshot with videoStream replaced by null (camera hidden
// behind the share) — represent this by returning `{ ...local, videoStream: null, isScreenSharing: false }`.
it('prefers a remote screen sharer', ...)              // expect(...).toBe(remoteSharer)
it('prefers the speaking remote over the first remote', ...)
it('falls back to the first remote', ...)
it('never returns the local screen share', ...)        // local sharing, no remotes → result.isScreenSharing === false && result.videoStream === null
it('returns null for no participants', ...)
// getPipSupport
it("is 'document' when window.documentPictureInPicture exists", ...)
it("is 'video' when only HTMLVideoElement.prototype.requestPictureInPicture exists", ...)
it("is 'none' when neither exists", ...)
// copyDocumentStyles
it('copies <style> and <link rel=stylesheet> nodes and the <html> class list', ...)
// from.head has <style>.a{}</style> and <link rel="stylesheet" href="/x.css">, from.documentElement.className = 'dark'
// → to.head contains both (by textContent / href) and to.documentElement.classList.contains('dark')
```

- [ ] **Step 2: Run** `npx vitest run tests/unit/miniCallHelpers.test.ts` — Expected: FAIL (exports missing).

- [ ] **Step 3: Implement** the three functions. `getPipSupport` checks `'documentPictureInPicture' in win` first, then `'requestPictureInPicture' in HTMLVideoElement.prototype` and `document.pictureInPictureEnabled !== false`. `copyDocumentStyles` clones nodes with `cloneNode(true)` (works across same-origin documents for `<style>`/`<link>`; use `to.importNode` if cloning fails) and copies `documentElement.className`.

- [ ] **Step 4: Run** the test — Expected: PASS.

- [ ] **Step 5: Commit** `feat(calls): helpers for floating mini window`

---

### Task 2: PiP window lifecycle hook

**Files:**
- Modify: `src/services/calling/pip.ts`
- Create: `src/hooks/usePipWindow.ts`
- Test: `tests/unit/pipWindow.test.ts`

**Interfaces:**
- Consumes: `getPipSupport`, `copyDocumentStyles` (Task 1).
- Produces (in `pip.ts`):
  - `shouldClosePip(s: { callActive: boolean; tabVisible: boolean; isLocalSharing: boolean }): boolean` — true when `!callActive || (tabVisible && !isLocalSharing)`.
  - `registerAutoPip(onEnter: () => void, nav?: Navigator): () => void` — sets `navigator.mediaSession.setActionHandler('enterpictureinpicture', onEnter)`; returns an unregister that sets it to `null`. Any throw (missing `mediaSession`, `TypeError` for unknown action) → returns a no-op.
  - `openDocumentPip(opts: { width: number; height: number }): Promise<Window>` — `documentPictureInPicture.requestWindow(opts)` then `copyDocumentStyles(document, pipWin.document)`.
  - `openVideoPip(stream: MediaStream): Promise<void>` — hidden muted `<video>` appended to `document.body`, `srcObject = stream`, `await play()`, `await requestPictureInPicture()`; removes the element on `leavepictureinpicture`.
- Produces (in `usePipWindow.ts`):
  - `usePipWindow(args: { callActive: boolean; isLocalSharing: boolean }): { pipWindow: Window | null; support: PipSupport; openPip: () => Promise<void>; closePip: () => void }`
    - `openPip` is a no-op if a window is already open; uses `openDocumentPip({ width: 320, height: 240 })`. Errors are caught and returned as a rejected promise for the caller to toast.
    - Listens for `pagehide` on the PiP window → sets `pipWindow` to `null`.
    - Listens for `document.visibilitychange`; on every change and whenever `callActive`/`isLocalSharing` change, closes the window if `shouldClosePip(...)`.
    - While `callActive && support === 'document'`, calls `registerAutoPip(() => void openPip())`; unregisters on cleanup / call end.

- [ ] **Step 1: Write the failing tests**

```ts
it('shouldClosePip: closes when the call is not active', ...)          // {callActive:false, tabVisible:false, isLocalSharing:true} → true
it('shouldClosePip: stays open while sharing even if tab visible', ...) // {true, true, true} → false
it('shouldClosePip: closes when tab visible and not sharing', ...)      // {true, true, false} → true
it('shouldClosePip: stays open while tab hidden', ...)                  // {true, false, false} → false
it('registerAutoPip sets and clears the enterpictureinpicture handler', ...)
// fake nav.mediaSession.setActionHandler = vi.fn(); unregister() → called with ('enterpictureinpicture', null)
it('registerAutoPip swallows TypeError from unsupported action', ...)   // setActionHandler throws → no throw, returns function
it('usePipWindow clears pipWindow when the PiP window fires pagehide', ...)
// stub window.documentPictureInPicture.requestWindow → returns a fake window (EventTarget + document = document.implementation.createHTMLDocument())
// renderHook(usePipWindow,{callActive:true,isLocalSharing:false}); await act(openPip); dispatch 'pagehide' on fake → result.current.pipWindow === null
it('usePipWindow closes the window when callActive turns false', ...)  // fake.close spy called
```

- [ ] **Step 2: Run** `npx vitest run tests/unit/pipWindow.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** the four `pip.ts` functions and the hook per the Interfaces block.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `feat(calls): picture-in-picture window lifecycle`

---

### Task 3: Mini call view rendered into the PiP window

**Files:**
- Create: `src/components/calling/MiniCallView.tsx`
- Modify: `src/components/calling/CallOverlay.tsx` (export `ParticipantTile` so the mini view can reuse it)
- Test: `tests/unit/miniCallView.test.tsx`

**Interfaces:**
- Consumes: `pickMiniMainTile` (Task 1), `ParticipantTile`, `CallControls` (existing, `compact` prop).
- Produces: `MiniCallView: React.FC<{ participants: CallPeerSnapshot[]; isMuted: boolean; isCameraOff: boolean; isScreenSharing: boolean; mediaType: 'audio'|'video'; onToggleMute(): void; onToggleCamera(): void; onStopSharing(): void; onHangUp(): void; onBackToCall(): void }>`

Layout: main tile (from `pickMiniMainTile`) fills the top; below it a horizontal strip of the other participants (`compact` tiles, local included, local screen share excluded); bottom row: mute, camera (video calls only), **Stop sharing** (only when `isScreenSharing`), hang up, **Back to call**. Dark background, full window size (`h-screen w-screen`). Must contain **no** `<audio>` elements.

- [ ] **Step 1: Write the failing tests** (render with testing-library; stub `HTMLMediaElement.prototype.play`)

```tsx
it('renders the main speaker name and a strip of the others', ...)
it('shows Stop sharing only while sharing', ...)          // queryByRole('button',{name:/stop sharing/i})
it('calls onBackToCall / onHangUp', ...)
it('renders no audio elements', ...)                      // container.querySelectorAll('audio').length === 0
```

- [ ] **Step 2: Run** `npx vitest run tests/unit/miniCallView.test.tsx` — Expected: FAIL.
- [ ] **Step 3: Implement** `MiniCallView`.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `feat(calls): compact mini call view`

---

### Task 4: Wire the floating window into the call overlay

**Files:**
- Modify: `src/components/calling/CallOverlay.tsx`

**Interfaces:**
- Consumes: `usePipWindow` (Task 2), `openVideoPip`, `getPipSupport` (Task 2/1), `MiniCallView` (Task 3), `useCall()` state/actions.

Behaviour:
- `callActive = ['connecting','connected','reconnecting'].includes(state.status)`; `const pip = usePipWindow({ callActive, isLocalSharing: state.isScreenSharing })`.
- When `pip.pipWindow` is set, render `createPortal(<MiniCallView …/>, pip.pipWindow.document.body)` **in addition to** the normal overlay (the overlay keeps rendering `RemoteAudioSink`s in the main document).
- `onBackToCall`: `pip.closePip(); window.focus()`.
- Header gets a **"Pop out"** button (icon `PictureInPicture2` from lucide-react, `aria-label="Pop out call"`), shown when `pip.support !== 'none'`. Click: `support === 'document'` → `pip.openPip()`; `support === 'video'` → `openVideoPip(mainTile.videoStream)` where `mainTile = pickMiniMainTile(state.participants)`; toast `'Nothing to show yet'` if it has no video. Errors → `toast.error(message)`.
- Screen share start: wrap the overlay's `onToggleScreenShare` — if **not** currently sharing and `support === 'document'` and no PiP window, call `pip.openPip()` **first, without awaiting before calling** `actions.toggleScreenShare()` (both must run inside the click's user activation; if `requestWindow` rejects, ignore — the "Pop out" button remains).
- The existing in-app PiP (`pip`/`setPip` state for the draggable box) is renamed `minimized`/`setMinimized` to avoid confusion with browser PiP; behaviour unchanged.

- [ ] **Step 1: Implement** the wiring above.
- [ ] **Step 2: Verify** `npx tsc --noEmit -p tsconfig.json` → exit 0; `npx eslint src/components/calling --ext ts,tsx` → exit 0; `npx vitest run` → all pass.
- [ ] **Step 3: Manual check in Chrome** (two browser profiles, same project): start a video call; (a) switch tab → mini window appears (if Chrome shows a permission chip for automatic PiP, allow it); return → it closes; (b) click Share screen, pick a window → mini window appears and stays while sharing; stop sharing from the mini window → returns to normal and closes when the call tab is visible; (c) other side hangs up while the mini window is open → it closes; (d) close the mini window with the browser × → "Pop out" works again; (e) audio keeps playing throughout with no echo/doubling.
- [ ] **Step 4: Commit** `feat(calls): floating mini call window like Google Meet`
