import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { registerAutoPip, requestVideoPipFor, shouldClosePip } from '@/services/calling/pip';
import { usePipWindow } from '@/hooks/usePipWindow';

describe('shouldClosePip', () => {
  it('closes when the call is not active', () => {
    expect(shouldClosePip({ callActive: false, tabVisible: false, isLocalSharing: true })).toBe(true);
  });
  it('stays open while sharing even if the tab is visible', () => {
    expect(shouldClosePip({ callActive: true, tabVisible: true, isLocalSharing: true })).toBe(false);
  });
  it('closes when the tab is visible and not sharing', () => {
    expect(shouldClosePip({ callActive: true, tabVisible: true, isLocalSharing: false })).toBe(true);
  });
  it('stays open while the tab is hidden', () => {
    expect(shouldClosePip({ callActive: true, tabVisible: false, isLocalSharing: false })).toBe(false);
  });
});

describe('registerAutoPip', () => {
  it('sets and clears the enterpictureinpicture handler', () => {
    const setActionHandler = vi.fn();
    const nav = { mediaSession: { setActionHandler } } as unknown as Navigator;
    const onEnter = vi.fn();
    const unregister = registerAutoPip(onEnter, nav);
    expect(setActionHandler).toHaveBeenCalledWith('enterpictureinpicture', onEnter);
    unregister();
    expect(setActionHandler).toHaveBeenLastCalledWith('enterpictureinpicture', null);
  });

  it('swallows a TypeError for an unsupported action', () => {
    const nav = {
      mediaSession: {
        setActionHandler: () => {
          throw new TypeError('not a valid enum value');
        },
      },
    } as unknown as Navigator;
    expect(() => registerAutoPip(() => {}, nav)()).not.toThrow();
  });

  it('is a no-op without mediaSession', () => {
    expect(() => registerAutoPip(() => {}, {} as Navigator)()).not.toThrow();
  });
});

function installFakeDocumentPip() {
  const fake = Object.assign(new EventTarget(), {
    document: document.implementation.createHTMLDocument('pip'),
    close: vi.fn(),
  });
  (window as unknown as Record<string, unknown>).documentPictureInPicture = {
    requestWindow: vi.fn(async () => fake),
  };
  return fake;
}

describe('usePipWindow', () => {
  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).documentPictureInPicture;
  });

  it('clears pipWindow when the PiP window fires pagehide', async () => {
    const fake = installFakeDocumentPip();
    const { result } = renderHook(() =>
      usePipWindow({ callActive: true, isLocalSharing: true }),
    );
    await act(async () => {
      await result.current.openPip();
    });
    expect(result.current.pipWindow).toBe(fake);
    act(() => {
      fake.dispatchEvent(new Event('pagehide'));
    });
    expect(result.current.pipWindow).toBeNull();
  });

  it('closes when sharing stops while the call tab is visible', async () => {
    const fake = installFakeDocumentPip();
    const vis = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    const { result, rerender } = renderHook(
      (props: { sharing: boolean }) =>
        usePipWindow({ callActive: true, isLocalSharing: props.sharing }),
      { initialProps: { sharing: true } },
    );
    await act(async () => {
      await result.current.openPip();
    });
    expect(fake.close).not.toHaveBeenCalled();
    rerender({ sharing: false });
    expect(fake.close).toHaveBeenCalled();
    vis.mockRestore();
  });

  it('recheck() closes the window when the share picker was cancelled on a visible tab', async () => {
    const fake = installFakeDocumentPip();
    const vis = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    const { result } = renderHook(() =>
      usePipWindow({ callActive: true, isLocalSharing: false }),
    );
    await act(async () => {
      await result.current.openPip();
    });
    act(() => result.current.recheck());
    expect(fake.close).toHaveBeenCalled();
    vis.mockRestore();
  });

  it('closes the window when callActive turns false', async () => {
    const fake = installFakeDocumentPip();
    const { result, rerender } = renderHook(
      (props: { callActive: boolean }) =>
        usePipWindow({ callActive: props.callActive, isLocalSharing: true }),
      { initialProps: { callActive: true } },
    );
    await act(async () => {
      await result.current.openPip();
    });
    rerender({ callActive: false });
    expect(fake.close).toHaveBeenCalled();
    expect(result.current.pipWindow).toBeNull();
  });
});

describe('requestVideoPipFor', () => {
  it('requests picture-in-picture synchronously on the user tile video', () => {
    const video = document.createElement('video');
    video.dataset.callUser = 'alice';
    const request = vi.fn(() => Promise.resolve({} as PictureInPictureWindow));
    (video as unknown as { requestPictureInPicture: typeof request }).requestPictureInPicture = request;
    document.body.appendChild(video);
    const result = requestVideoPipFor('alice');
    // Called before any await so Safari still sees the click.
    expect(request).toHaveBeenCalledTimes(1);
    expect(result).toBeInstanceOf(Promise);
    video.remove();
  });

  it('returns null when that user has no video tile', () => {
    expect(requestVideoPipFor('nobody')).toBeNull();
  });
});

describe('usePipWindow video fallback', () => {
  it('exits video picture-in-picture when the call ends', () => {
    const exit = vi.fn(() => Promise.resolve());
    const doc = document as unknown as Record<string, unknown>;
    Object.defineProperty(document, 'pictureInPictureElement', { configurable: true, get: () => ({}) });
    doc.exitPictureInPicture = exit;
    const { rerender } = renderHook(
      (props: { callActive: boolean }) =>
        usePipWindow({ callActive: props.callActive, isLocalSharing: false }),
      { initialProps: { callActive: true } },
    );
    expect(exit).not.toHaveBeenCalled();
    rerender({ callActive: false });
    expect(exit).toHaveBeenCalled();
    delete (document as unknown as Record<string, unknown>).pictureInPictureElement;
    delete doc.exitPictureInPicture;
  });
});
