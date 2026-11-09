import { useCallback, useEffect, useRef, useState } from 'react';
import {
  exitVideoPip,
  getPipSupport,
  openDocumentPip,
  registerAutoPip,
  shouldClosePip,
  type PipSupport,
} from '@/services/calling/pip';

const PIP_SIZE = { width: 320, height: 240 };

/**
 * Owns the floating mini call window (Document Picture-in-Picture):
 * opening it (manually, on screen share, or automatically when the user
 * switches tabs), noticing when the user closes it, and closing it when the
 * call ends or the user is back on the call tab and not sharing.
 */
export function usePipWindow(args: { callActive: boolean; isLocalSharing: boolean }): {
  pipWindow: Window | null;
  support: PipSupport;
  openPip: () => Promise<void>;
  closePip: () => void;
  /** Re-apply the close rule now (e.g. after the share picker was cancelled). */
  recheck: () => void;
} {
  const { callActive, isLocalSharing } = args;
  const [pipWindow, setPipWindow] = useState<Window | null>(null);
  const pipRef = useRef<Window | null>(null);
  const openingRef = useRef(false);
  const [support] = useState<PipSupport>(() => getPipSupport());
  const argsRef = useRef(args);
  argsRef.current = args;

  const closePip = useCallback(() => {
    const win = pipRef.current;
    pipRef.current = null;
    setPipWindow(null);
    if (win) {
      try {
        win.close();
      } catch {
        /* already closed */
      }
    }
  }, []);

  const openPip = useCallback(async () => {
    if (pipRef.current || openingRef.current) return;
    openingRef.current = true;
    try {
      const win = await openDocumentPip(PIP_SIZE);
      pipRef.current = win;
      setPipWindow(win);
      // User closed it with the browser's own ×.
      win.addEventListener(
        'pagehide',
        () => {
          if (pipRef.current === win) {
            pipRef.current = null;
            setPipWindow(null);
          }
        },
        { once: true },
      );
    } finally {
      openingRef.current = false;
    }
  }, []);

  const recheck = useCallback(() => {
    if (!pipRef.current) return;
    if (
      shouldClosePip({
        callActive: argsRef.current.callActive,
        tabVisible: document.visibilityState === 'visible',
        isLocalSharing: argsRef.current.isLocalSharing,
      })
    ) {
      closePip();
    }
  }, [closePip]);

  // Close when the call ends, or the tab is visible again and not sharing.
  useEffect(() => {
    const check = recheck;
    // Re-check right away too: e.g. sharing stopped while already on the tab.
    check();
    if (!callActive) {
      // Safari/video fallback window must not outlive the call either.
      exitVideoPip();
      return;
    }
    document.addEventListener('visibilitychange', check);
    return () => document.removeEventListener('visibilitychange', check);
  }, [callActive, isLocalSharing, recheck]);

  // Automatic open on tab switch while a call is active (Chrome/Edge).
  useEffect(() => {
    if (!callActive || support !== 'document') return;
    return registerAutoPip(() => {
      void openPip().catch(() => undefined);
    });
  }, [callActive, support, openPip]);

  // Never leave a window behind on unmount.
  useEffect(() => () => closePip(), [closePip]);

  return { pipWindow, support, openPip, closePip, recheck };
}
