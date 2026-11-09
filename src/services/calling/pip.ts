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
    'requestPictureInPicture' in win.HTMLVideoElement.prototype &&
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
