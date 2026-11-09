import { afterEach, describe, expect, it } from 'vitest';
import { pickMiniMainTile } from '@/services/livekit/callHelpers';
import { copyDocumentStyles, getPipSupport } from '@/services/calling/pip';
import type { CallPeerSnapshot } from '@/services/livekit/LiveKitCallService';

const stream = {} as MediaStream;
function peer(p: Partial<CallPeerSnapshot> & { userId: string }): CallPeerSnapshot {
  return {
    displayName: p.userId,
    audioStream: null,
    videoStream: stream,
    isMicMuted: false,
    isCameraOff: false,
    isScreenSharing: false,
    isSpeaking: false,
    isLocal: false,
    ...p,
  };
}

describe('pickMiniMainTile', () => {
  it('prefers a remote screen sharer', () => {
    const sharer = peer({ userId: 'b', isScreenSharing: true });
    const peers = [peer({ userId: 'me', isLocal: true }), peer({ userId: 'a', isSpeaking: true }), sharer];
    expect(pickMiniMainTile(peers)).toBe(sharer);
  });

  it('prefers the speaking remote over the first remote', () => {
    const speaking = peer({ userId: 'b', isSpeaking: true });
    expect(pickMiniMainTile([peer({ userId: 'a' }), speaking])).toBe(speaking);
  });

  it('falls back to the first remote', () => {
    const first = peer({ userId: 'a' });
    expect(pickMiniMainTile([peer({ userId: 'me', isLocal: true }), first, peer({ userId: 'b' })])).toBe(first);
  });

  it('never returns the local screen share', () => {
    const result = pickMiniMainTile([peer({ userId: 'me', isLocal: true, isScreenSharing: true })]);
    expect(result?.userId).toBe('me');
    expect(result?.isScreenSharing).toBe(false);
    expect(result?.videoStream).toBeNull();
  });

  it('returns null for no participants', () => {
    expect(pickMiniMainTile([])).toBeNull();
  });
});

describe('getPipSupport', () => {
  const proto = HTMLVideoElement.prototype as unknown as Record<string, unknown>;
  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).documentPictureInPicture;
    delete proto.requestPictureInPicture;
  });

  it("is 'document' when window.documentPictureInPicture exists", () => {
    (window as unknown as Record<string, unknown>).documentPictureInPicture = {};
    expect(getPipSupport(window)).toBe('document');
  });

  it("is 'video' when only requestPictureInPicture exists", () => {
    proto.requestPictureInPicture = () => Promise.resolve();
    expect(getPipSupport(window)).toBe('video');
  });

  it("is 'none' when neither exists", () => {
    expect(getPipSupport(window)).toBe('none');
  });
});

describe('copyDocumentStyles', () => {
  it('copies <style> and <link rel=stylesheet> nodes and the <html> class list', () => {
    const from = document.implementation.createHTMLDocument('from');
    const style = from.createElement('style');
    style.textContent = '.a{color:red}';
    const link = from.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://example.test/x.css';
    from.head.append(style, link);
    from.documentElement.className = 'dark';

    const to = document.implementation.createHTMLDocument('to');
    copyDocumentStyles(from, to);

    expect(to.head.querySelector('style')?.textContent).toBe('.a{color:red}');
    expect(to.head.querySelector('link[rel="stylesheet"]')?.getAttribute('href')).toBe(
      'https://example.test/x.css',
    );
    expect(to.documentElement.classList.contains('dark')).toBe(true);
  });

  it('makes relative stylesheet hrefs absolute (the PiP window is about:blank)', () => {
    const from = document.implementation.createHTMLDocument('from');
    const base = from.createElement('base');
    base.href = 'https://app.test/';
    from.head.appendChild(base);
    const link = from.createElement('link');
    link.rel = 'stylesheet';
    link.setAttribute('href', '/assets/index-abc.css');
    from.head.appendChild(link);

    const to = document.implementation.createHTMLDocument('to');
    copyDocumentStyles(from, to);
    expect(to.head.querySelector('link')?.getAttribute('href')).toBe(
      'https://app.test/assets/index-abc.css',
    );
  });
});
