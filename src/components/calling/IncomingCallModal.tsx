import React, { useEffect, useRef } from 'react';
import { Phone, PhoneOff, Video } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import type { CallParticipant, CallMediaType } from '@/services/webrtc/types';

interface IncomingCallModalProps {
  caller: CallParticipant;
  mediaType: CallMediaType;
  onAccept: () => void;
  onReject: () => void;
}

export const IncomingCallModal: React.FC<IncomingCallModalProps> = ({
  caller,
  mediaType,
  onAccept,
  onReject,
}) => {
  const ctxRef = useRef<AudioContext | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const getOrCreateCtx = (): AudioContext | null => {
      try {
        if (ctxRef.current && ctxRef.current.state !== 'closed') return ctxRef.current;
        const Ctor =
          window.AudioContext ||
          (window as typeof window & { webkitAudioContext?: typeof AudioContext })
            .webkitAudioContext;
        if (!Ctor) return null;
        ctxRef.current = new Ctor();
        return ctxRef.current;
      } catch {
        return null;
      }
    };

    const playRing = () => {
      const ctx = getOrCreateCtx();
      if (!ctx) return;

      try {
        const master = ctx.createGain();
        master.gain.setValueAtTime(0.5, ctx.currentTime);
        master.connect(ctx.destination);

        const playNote = (freq: number, start: number, dur: number, peak: number) => {
          const osc = ctx.createOscillator();
          const overtone = ctx.createOscillator();
          const noteGain = ctx.createGain();
          const overtoneGain = ctx.createGain();

          osc.type = 'sine';
          overtone.type = 'sine';
          osc.frequency.setValueAtTime(freq, ctx.currentTime + start);
          overtone.frequency.setValueAtTime(freq * 2.01, ctx.currentTime + start);

          const t = ctx.currentTime + start;
          noteGain.gain.setValueAtTime(0.0001, t);
          noteGain.gain.exponentialRampToValueAtTime(peak, t + 0.02);
          noteGain.gain.exponentialRampToValueAtTime(0.0001, t + dur);

          overtoneGain.gain.setValueAtTime(0.0001, t);
          overtoneGain.gain.exponentialRampToValueAtTime(peak * 0.3, t + 0.03);
          overtoneGain.gain.exponentialRampToValueAtTime(0.0001, t + dur);

          osc.connect(noteGain);
          overtone.connect(overtoneGain);
          noteGain.connect(master);
          overtoneGain.connect(master);

          osc.start(t);
          overtone.start(t);
          osc.stop(t + dur + 0.02);
          overtone.stop(t + dur + 0.02);
        };

        // Teams-style melody: three ascending bell notes, pause, repeat
        // G5 → B5 → D6 (a major triad going up — bright, inviting)
        playNote(784, 0, 0.25, 0.2);     // G5
        playNote(988, 0.28, 0.25, 0.22);  // B5
        playNote(1175, 0.56, 0.4, 0.25);  // D6 (longer, rings out)

        // Second ring after pause
        playNote(784, 1.2, 0.25, 0.18);
        playNote(988, 1.48, 0.25, 0.2);
        playNote(1175, 1.76, 0.4, 0.22);
      } catch {
        /* audio blocked */
      }
    };

    playRing();
    intervalRef.current = setInterval(playRing, 3000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      const ctx = ctxRef.current;
      ctxRef.current = null;
      void ctx?.close().catch(() => {});
    };
  }, []);

  return (
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      role="alertdialog"
      aria-label={`Incoming ${mediaType} call from ${caller.displayName}`}
    >
      <div className="flex flex-col items-center gap-5 rounded-2xl border border-border bg-card p-8 shadow-2xl min-w-[280px] max-w-sm animate-in fade-in zoom-in-95 duration-200">
        {/* Pulsing ring indicator */}
        <div className="relative">
          <div className="absolute inset-[-8px] rounded-full bg-primary/15 animate-ping" />
          <div className="absolute inset-[-4px] rounded-full bg-primary/10 animate-pulse" />
          <Avatar className="h-20 w-20 ring-4 ring-primary/30 relative">
            <AvatarImage src={caller.photoURL} alt={caller.displayName} />
            <AvatarFallback className="text-2xl bg-primary/10 text-primary">
              {(caller.displayName || '?').charAt(0).toUpperCase()}
            </AvatarFallback>
          </Avatar>
        </div>

        <div className="text-center">
          <p className="text-lg font-semibold text-foreground">
            {caller.displayName}
          </p>
          <p className="text-sm text-muted-foreground mt-1 animate-pulse">
            Incoming {mediaType} call…
          </p>
        </div>

        <div className="flex items-center gap-6 mt-2">
          <div className="flex flex-col items-center gap-1.5">
            <Button
              variant="destructive"
              size="lg"
              className="h-14 w-14 rounded-full shadow-lg"
              onClick={onReject}
              aria-label="Decline call"
            >
              <PhoneOff className="h-6 w-6" />
            </Button>
            <span className="text-xs text-muted-foreground">Decline</span>
          </div>
          <div className="flex flex-col items-center gap-1.5">
            <Button
              size="lg"
              className="h-14 w-14 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white shadow-lg"
              onClick={onAccept}
              aria-label="Accept call"
            >
              {mediaType === 'video' ? (
                <Video className="h-6 w-6" />
              ) : (
                <Phone className="h-6 w-6" />
              )}
            </Button>
            <span className="text-xs text-muted-foreground">Accept</span>
          </div>
        </div>
      </div>
    </div>
  );
};
