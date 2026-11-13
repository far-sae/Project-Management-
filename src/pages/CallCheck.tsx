import React, { useCallback, useState } from 'react';
import { AlertTriangle, CheckCircle2, Circle, Loader2, MinusCircle, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/services/supabase/config';
import { isMediaSupported } from '@/services/webrtc/mediaUtils';
import { dmRoomName, fetchLiveKitToken } from '@/services/livekit/fetchLiveKitToken';
import {
  runCallCheck,
  type CallCheckDeps,
  type CallCheckResult,
  type CallCheckStatus,
} from '@/services/calling/callCheck';

const RINGING_TIMEOUT_MS = 8_000;

function realDeps(userId: string, displayName: string): CallCheckDeps {
  return {
    browserSupported: () =>
      isMediaSupported() && typeof RTCPeerConnection !== 'undefined' && window.isSecureContext,
    getUserMedia: (c) => navigator.mediaDevices.getUserMedia(c),
    checkServer: async () => {
      // A private room only this user can join (dm:<me>__<me>), so the check
      // never rings or joins anyone else.
      const { token, url } = await fetchLiveKitToken({
        roomName: dmRoomName(userId, userId),
        participantName: displayName,
      });
      const { ConnectionCheck, CheckStatus } = await import('livekit-client');
      const check = new ConnectionCheck(url, token);
      const ws = await check.checkWebsocket();
      if (ws.status !== CheckStatus.SUCCESS) return { websocket: false, webrtc: false };
      const rtc = await check.checkWebRTC();
      return { websocket: true, webrtc: rtc.status === CheckStatus.SUCCESS };
    },
    checkRinging: () =>
      new Promise<boolean>((resolve) => {
        const ch = supabase.channel(`call-check:${userId}:${Date.now()}`, {
          config: { broadcast: { self: true } },
        });
        const finish = (ok: boolean) => {
          clearTimeout(timer);
          void supabase.removeChannel(ch).catch(() => undefined);
          resolve(ok);
        };
        const timer = setTimeout(() => finish(false), RINGING_TIMEOUT_MS);
        ch.on('broadcast', { event: 'ping' }, () => finish(true)).subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            void ch.send({ type: 'broadcast', event: 'ping', payload: {} });
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            finish(false);
          }
        });
      }),
  };
}

const ICON: Record<CallCheckStatus, React.ReactNode> = {
  pending: <Circle className="h-5 w-5 text-muted-foreground/50" aria-hidden />,
  running: <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden />,
  ok: <CheckCircle2 className="h-5 w-5 text-success" aria-hidden />,
  warn: <AlertTriangle className="h-5 w-5 text-warning" aria-hidden />,
  fail: <XCircle className="h-5 w-5 text-destructive" aria-hidden />,
  skipped: <MinusCircle className="h-5 w-5 text-muted-foreground/50" aria-hidden />,
};

const STATUS_TEXT: Record<CallCheckStatus, string> = {
  pending: 'Not run yet',
  running: 'Checking',
  ok: 'Passed',
  warn: 'Warning',
  fail: 'Failed',
  skipped: 'Skipped',
};

/** Step-by-step check of everything a call needs on this computer. */
export const CallCheck: React.FC = () => {
  const { user } = useAuth();
  const [results, setResults] = useState<CallCheckResult[] | null>(null);
  const [running, setRunning] = useState(false);

  const start = useCallback(async () => {
    if (!user || running) return;
    setRunning(true);
    try {
      await runCallCheck(
        realDeps(user.userId, user.displayName || user.email || 'Call check'),
        setResults,
      );
    } finally {
      setRunning(false);
    }
  }, [user, running]);

  const done = results && !running;
  const problems = results?.filter((r) => r.status === 'fail').length ?? 0;

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6 px-4 py-8">
      <div>
        <h1 className="text-2xl font-semibold text-balance">Call check</h1>
        <p className="mt-1 text-sm text-muted-foreground text-pretty">
          Tests your browser, microphone, camera and connection — the same things a call needs — and
          tells you what to fix. Your browser may ask for camera and microphone access: choose Allow.
        </p>
      </div>

      <Button type="button" onClick={start} disabled={!user || running} className="active:scale-[0.97]">
        {running && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
        {running ? 'Checking…' : results ? 'Run again' : 'Start check'}
      </Button>

      {results && (
        <ol className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card" aria-live="polite">
          {results.map((r) => (
            <li key={r.id} className="flex gap-3 px-4 py-3">
              <span className="mt-0.5 shrink-0">{ICON[r.status]}</span>
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  {r.label}
                  <span className="sr-only"> — {STATUS_TEXT[r.status]}</span>
                </p>
                {r.detail && (
                  <p
                    className={cn(
                      'mt-0.5 text-sm text-pretty break-words',
                      r.status === 'fail' ? 'text-foreground' : 'text-muted-foreground',
                    )}
                  >
                    {r.detail}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}

      {done && (
        <p className="text-sm text-muted-foreground text-pretty">
          {problems === 0
            ? 'Everything a call needs works on this computer. If calls still fail, make sure the person calling you is in the same project, and keep a TaskCalendar tab open so you can be rung.'
            : 'Fix the failed items above, reload this page and run the check again. Also check that your laptop’s camera or microphone isn’t switched off with a keyboard key.'}
        </p>
      )}
    </div>
  );
};
