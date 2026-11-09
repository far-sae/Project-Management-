/**
 * Picture-in-picture helpers for the floating mini call window.
 *
 * - 'document': Chrome/Edge Document Picture-in-Picture — a real always-on-top
 *   mini window we can render React (faces + controls) into.
 * - 'video': only the classic <video> picture-in-picture (Safari, older
 *   browsers) — shows one video, no controls.
 * - 'none': neither (Firefox).
 */
export type PipSupport = 'document' | 'video' | 'none';

export function getPipSupport(win: Window = window): PipSupport {
  if ('documentPictureInPicture' in win) return 'document';
  const doc = win.document as Document & { pictureInPictureEnabled?: boolean };
  if (
    'requestPictureInPicture' in (win as Window & typeof globalThis).HTMLVideoElement.prototype &&
    doc.pictureInPictureEnabled !== false
  ) {
    return 'video';
  }
  return 'none';
}

/**
 * Copy the app's stylesheets and <html> classes (e.g. `dark`) into another
 * document so Tailwind classes render the same inside the PiP window.
 */
export function copyDocumentStyles(from: Document, to: Document): void {
  const nodes = from.head.querySelectorAll('style, link[rel="stylesheet"]');
  for (const node of Array.from(nodes)) {
    to.head.appendChild(to.importNode(node, true));
  }
  to.documentElement.className = from.documentElement.className;
}

/**
 * Close the mini window when the call is over, or when the user is back on
 * the call tab — except while they're sharing their screen (then it stays,
 * Meet-style, so they keep seeing faces while presenting).
 */
export function shouldClosePip(s: {
  callActive: boolean;
  tabVisible: boolean;
  isLocalSharing: boolean;
}): boolean {
  return !s.callActive || (s.tabVisible && !s.isLocalSharing);
}

/**
 * Let Chrome open the mini window automatically when the user switches tabs
 * during a call ("automatic picture-in-picture" for camera/mic sites).
 * Returns an unregister function. Browsers that don't know the action throw
 * a TypeError — that just means no automatic pop-up.
 */
export function registerAutoPip(
  onEnter: () => void,
  nav: Navigator = navigator,
): () => void {
  const session = nav.mediaSession;
  if (!session?.setActionHandler) return () => {};
  const action = 'enterpictureinpicture' as MediaSessionAction;
  try {
    session.setActionHandler(action, onEnter);
  } catch {
    return () => {};
  }
  return () => {
    try {
      session.setActionHandler(action, null);
    } catch {
      /* already cleared */
    }
  };
}

interface DocumentPictureInPictureApi {
  requestWindow(opts: { width: number; height: number }): Promise<Window>;
}

/** Open a Document Picture-in-Picture window styled like the app. */
export async function openDocumentPip(opts: {
  width: number;
  height: number;
}): Promise<Window> {
  const api = (window as unknown as { documentPictureInPicture?: DocumentPictureInPictureApi })
    .documentPictureInPicture;
  if (!api) throw new Error('Floating window is not supported in this browser.');
  const pipWin = await api.requestWindow(opts);
  copyDocumentStyles(document, pipWin.document);
  return pipWin;
}

/**
 * Fallback for browsers without Document PiP: float a single video (no
 * controls) using the classic <video> picture-in-picture.
 */
export async function openVideoPip(stream: MediaStream): Promise<void> {
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.style.position = 'fixed';
  video.style.width = '1px';
  video.style.height = '1px';
  video.style.opacity = '0';
  video.style.pointerEvents = 'none';
  video.srcObject = stream;
  document.body.appendChild(video);
  video.addEventListener('leavepictureinpicture', () => video.remove(), { once: true });
  try {
    await video.play();
    await video.requestPictureInPicture();
  } catch (err) {
    video.remove();
    throw err;
  }
}
