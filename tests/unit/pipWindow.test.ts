import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { registerAutoPip, shouldClosePip } from '@/services/calling/pip';
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
