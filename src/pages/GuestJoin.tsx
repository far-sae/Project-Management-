import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { DisconnectReason } from 'livekit-client';
import { Mic, MicOff, Video, VideoOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CallControls } from '@/components/calling/CallControls';
import {
  ParticipantTile,
  RemoteAudioSink,
  attachStream,
} from '@/components/calling/CallTiles';
import { joinAsGuest, GuestApiError } from '@/services/livekit/guestApi';
import {
  LiveKitCallService,
  type CallPeerSnapshot,
} from '@/services/livekit/LiveKitCallService';
import { anyoneRecording, visiblePeers } from '@/services/livekit/callHelpers';

type Phase =
  | 'form'
  | 'waiting'
  | 'in-call'
  | 'ended'
  | 'denied'
  | 'timeout'
  | 'expired'
  | 'error';

const WAIT_TIMEOUT_MS = 10 * 60 * 1000;
const NO_MEMBER_GRACE_MS = 5000;
const MAX_NAME = 60;

/** DISPLAY ONLY — the server re-verifies the signature. Never trust this. */
function decodeInviteForDisplay(token: string): { label: string; inviterName: string } {
  try {
    const part = token.split('.')[0] ?? '';
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const bytes = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
    const p = JSON.parse(new TextDecoder().decode(bytes)) as {
      label?: unknown;
      inviterName?: unknown;
    };
    return {
      label: typeof p.label === 'string' ? p.label.slice(0, 120) : '',
      inviterName: typeof p.inviterName === 'string' ? p.inviterName.slice(0, 120) : '',
    };
  } catch {
    return { label: '', inviterName: '' };
  }
}

const TERMINAL_COPY: Record<'ended' | 'denied' | 'timeout' | 'expired', string> = {
  ended: 'The meeting has ended.',
  denied: "You weren't let into the call.",
  timeout: 'No one let you in.',
  expired: 'This link has expired — ask for a new one.',
};

export const GuestJoin: React.FC = () => {
  const { token = '' } = useParams<{ token: string }>();
  const info = useMemo(() => decodeInviteForDisplay(token), [token]);

  const [phase, setPhase] = useState<Phase>('form');
  const [name, setName] = useState('');
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [hasPreview, setHasPreview] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [peers, setPeers] = useState<CallPeerSnapshot[]>([]);

  const mountedRef = useRef(true);
  const phaseRef = useRef<Phase>('form');
  const svcRef = useRef<LiveKitCallService | null>(null);
  const previewStreamRef = useRef<MediaStream | null>(null);
  const previewVideoRef = useRef<HTMLVideoElement>(null);
  const micOnRef = useRef(true);
  const camOnRef = useRef(true);
  const publishedRef = useRef(false);

  const go = useCallback((next: Phase) => {
    phaseRef.current = next;
    if (mountedRef.current) setPhase(next);
  }, []);

  const stopPreview = useCallback(() => {
    previewStreamRef.current?.getTracks().forEach((t) => t.stop());
    previewStreamRef.current = null;
    if (previewVideoRef.current) previewVideoRef.current.srcObject = null;
  }, []);

  const teardownService = useCallback(() => {
    const svc = svcRef.current;
    svcRef.current = null;
    if (svc) void svc.disconnect().catch(() => {});
  }, []);

  /** Move to a terminal phase and release the connection. */
  const finish = useCallback(
    (next: Phase, msg = '') => {
      teardownService();
      if (mountedRef.current) setErrorMsg(msg);
      go(next);
    },
    [go, teardownService],
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      stopPreview();
      teardownService();
    };
  }, [stopPreview, teardownService]);

  // Camera/mic preview while on the form.
  useEffect(() => {
    if (phase !== 'form') return;
    let cancelled = false;
    const md = navigator.mediaDevices;
    if (!md?.getUserMedia) return;
    (async () => {
      let stream: MediaStream | null = null;
      try {
        stream = await md.getUserMedia({ audio: true, video: true });
      } catch {
        try {
          stream = await md.getUserMedia({ audio: true });
        } catch {
          stream = null;
        }
      }
      if (!stream) return;
      if (cancelled) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      previewStreamRef.current = stream;
      setHasPreview(true);
      stream.getAudioTracks().forEach((t) => (t.enabled = micOnRef.current));
      stream.getVideoTracks().forEach((t) => (t.enabled = camOnRef.current));
      attachStream(previewVideoRef.current, stream);
    })();
    return () => {
      cancelled = true;
      stopPreview();
    };
  }, [phase, stopPreview]);

  const toggleMicPreview = () => {
    const next = !micOn;
    micOnRef.current = next;
    setMicOn(next);
    previewStreamRef.current?.getAudioTracks().forEach((t) => (t.enabled = next));
  };
  const toggleCamPreview = () => {
    const next = !camOn;
    camOnRef.current = next;
    setCamOn(next);
    previewStreamRef.current?.getVideoTracks().forEach((t) => (t.enabled = next));
  };

  const trimmed = name.trim();

  const onAskToJoin = async () => {
    if (!trimmed || submitting) return;
    setSubmitting(true);
    // Release the camera before LiveKit opens it again.
    stopPreview();
    setHasPreview(false);
    try {
      const res = await joinAsGuest(token, trimmed);
      if (!mountedRef.current) return;
      publishedRef.current = false;
      const svc: LiveKitCallService = new LiveKitCallService({
        onParticipantsChange: (list) => {
          if (!mountedRef.current || svcRef.current !== svc) return;
          setPeers(list);
          const local = list.find((p) => p.isLocal);
          if (phaseRef.current === 'waiting' && local && !local.isWaiting) {
            go('in-call');
          }
        },
        onConnectionStateChange: () => {},
        onDisconnected: (reason) => {
          if (!mountedRef.current || svcRef.current !== svc) return;
          const cur = phaseRef.current;
          if (cur === 'waiting') {
            if (reason === DisconnectReason.PARTICIPANT_REMOVED) finish('denied');
            else finish('error', 'The connection was lost.');
          } else if (cur === 'in-call') {
            finish('ended');
          }
        },
        onError: () => {},
      });
      svcRef.current = svc;
      go('waiting');
      try {
        await svc.connect({
          roomName: '',
          participantName: trimmed,
          mediaType: 'video',
          credentials: { token: res.token, url: res.url },
          publishOnConnect: false,
        });
      } catch {
        if (mountedRef.current && svcRef.current === svc) {
          finish('error', 'Could not connect to the call.');
        }
      }
    } catch (err) {
      if (!mountedRef.current) return;
      if (err instanceof GuestApiError && err.code === 'INVITE_EXPIRED') {
        finish('expired');
      } else {
        finish('error', err instanceof Error ? err.message : 'Something went wrong.');
      }
    } finally {
      if (mountedRef.current) setSubmitting(false);
    }
  };

  // Waiting: give up after 10 minutes.
  useEffect(() => {
    if (phase !== 'waiting') return;
    const t = window.setTimeout(() => finish('timeout'), WAIT_TIMEOUT_MS);
    return () => window.clearTimeout(t);
  }, [phase, finish]);

  // Admitted: publish per preview toggles.
  useEffect(() => {
    if (phase !== 'in-call' || publishedRef.current) return;
    publishedRef.current = true;
    void svcRef.current
      ?.publishLocalMedia({ mic: micOnRef.current, camera: camOnRef.current })
      .catch(() => {});
  }, [phase]);

  // In call: end if no team member is left for 5s.
  const hasMember = peers.some((p) => p.role === 'member' && !p.isLocal);
  useEffect(() => {
    if (phase !== 'in-call' || hasMember) return;
    const t = window.setTimeout(() => finish('ended'), NO_MEMBER_GRACE_MS);
    return () => window.clearTimeout(t);
  }, [phase, hasMember, finish]);

  const shell = (children: React.ReactNode) => (
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center p-4">
      {children}
    </div>
  );

  if (phase === 'ended' || phase === 'denied' || phase === 'timeout' || phase === 'expired') {
    return shell(
      <p className="text-lg text-center" role="status">
        {TERMINAL_COPY[phase]}
      </p>,
    );
  }

  if (phase === 'error') {
    return shell(
      <div className="text-center space-y-3" role="alert">
        <p className="text-lg">{errorMsg || 'Something went wrong.'}</p>
        <Button onClick={() => finish('form')}>Try again</Button>
      </div>,
    );
  }

  if (phase === 'waiting') {
    return shell(
      <div className="text-center space-y-4">
        <p className="text-lg" role="status">Waiting for someone to let you in…</p>
        <Button variant="outline" onClick={() => finish('form')}>Cancel</Button>
      </div>,
    );
  }

  if (phase === 'in-call') {
    const shown = visiblePeers(peers);
    const recording = anyoneRecording(peers);
    const local = peers.find((p) => p.isLocal);
    return (
      <div className="relative min-h-screen bg-black text-white flex flex-col">
        {recording && (
          <div className="absolute top-3 left-3 z-10 rounded-md bg-red-600 px-2 py-1 text-xs font-medium">
            Recording
          </div>
        )}
        <div className="flex-1 grid gap-2 p-2 auto-rows-fr grid-cols-1 sm:grid-cols-2">
          {shown.map((p) => (
            <ParticipantTile
              key={p.userId}
              snap={p.role === 'guest' && !p.isLocal ? { ...p, displayName: `${p.displayName} (Guest)` } : p}
              className="min-h-[160px]"
            />
          ))}
        </div>
        {shown.filter((p) => !p.isLocal).map((p) => (
          <RemoteAudioSink key={`a-${p.userId}`} snap={p} />
        ))}
        <CallControls
          isMuted={local?.isMicMuted ?? !micOn}
          isCameraOff={local?.isCameraOff ?? !camOn}
          isScreenSharing={false}
          videoEffect="none"
          isApplyingEffect={false}
          mediaType="video"
          allowScreenShare={false}
          onToggleMute={() => void svcRef.current?.setMicMuted(!(local?.isMicMuted ?? false))}
          onToggleCamera={() => void svcRef.current?.setCameraOff(!(local?.isCameraOff ?? false))}
          onToggleScreenShare={() => {}}
          onToggleBackgroundEffect={() => {}}
          onHangUp={() => finish('ended')}
        />
      </div>
    );
  }

  // form
  return shell(
    <div className="w-full max-w-md space-y-4">
      <div className="text-center space-y-1">
        <h1 className="text-xl font-semibold">{info.label || 'Join call'}</h1>
        {info.inviterName && (
          <p className="text-sm text-muted-foreground">Invited by {info.inviterName}</p>
        )}
      </div>
      <div className="relative aspect-video overflow-hidden rounded-xl bg-black/80 flex items-center justify-center">
        <video
          ref={previewVideoRef}
          autoPlay
          playsInline
          muted
          className="absolute inset-0 h-full w-full object-cover scale-x-[-1]"
          style={{ display: hasPreview && camOn ? 'block' : 'none' }}
        />
        {!(hasPreview && camOn) && (
          <span className="text-sm text-white/70">Camera off</span>
        )}
        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-2">
          <Button
            type="button"
            size="icon"
            variant="secondary"
            className="rounded-full"
            aria-label={micOn ? 'Mute microphone' : 'Unmute microphone'}
            onClick={toggleMicPreview}
          >
            {micOn ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}
          </Button>
          <Button
            type="button"
            size="icon"
            variant="secondary"
            className="rounded-full"
            aria-label={camOn ? 'Turn camera off' : 'Turn camera on'}
            onClick={toggleCamPreview}
          >
            {camOn ? <Video className="h-4 w-4" /> : <VideoOff className="h-4 w-4" />}
          </Button>
        </div>
      </div>
      <div className="space-y-1.5">
        <label htmlFor="guest-name" className="text-sm font-medium">Your name</label>
        <Input
          id="guest-name"
          value={name}
          maxLength={MAX_NAME}
          autoComplete="name"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void onAskToJoin();
          }}
        />
      </div>
      <p className="text-xs text-muted-foreground text-center">This call may be recorded.</p>
      <Button className="w-full" disabled={!trimmed || submitting} onClick={() => void onAskToJoin()}>
        Ask to join
      </Button>
    </div>,
  );
};

export default GuestJoin;
