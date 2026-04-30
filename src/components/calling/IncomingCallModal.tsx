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
  const ringRef = useRef<AudioContext | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Play a ring sound on loop
  useEffect(() => {
    const getOrCreateContext = (): AudioContext | null => {
      try {
        if (ringRef.current && ringRef.current.state !== 'closed') {
          return ringRef.current;
        }
        const AudioCtor =
          window.AudioContext ||
          (window as typeof window & { webkitAudioContext?: typeof AudioContext })
            .webkitAudioContext;
        if (!AudioCtor) return null;
        ringRef.current = new AudioCtor();
        return ringRef.current;
      } catch {
        return null;
      }
    };

    const playRing = () => {
      const ctx = getOrCreateContext();
      if (!ctx) return;

      const playTone = (freq: number, start: number, dur: number) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, ctx.currentTime + start);
        gain.gain.setValueAtTime(0.0001, ctx.currentTime + start);
        gain.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + start + 0.05);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + dur);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(ctx.currentTime + start);
        osc.stop(ctx.currentTime + start + dur + 0.01);
      };

      try {
        // Two-tone ring pattern (~1s); spacing matches interval
        playTone(440, 0, 0.3);
        playTone(480, 0, 0.3);
        playTone(440, 0.5, 0.3);
        playTone(480, 0.5, 0.3);
      } catch {
        /* audio blocked */
      }
    };

    playRing();
    intervalRef.current = setInterval(playRing, 2000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      const ctx = ringRef.current;
      ringRef.current = null;
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
          <div className="absolute inset-0 rounded-full bg-primary/20 animate-ping" />
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
          <p className="text-sm text-muted-foreground mt-1">
            Incoming {mediaType} call…
          </p>
        </div>

        <div className="flex items-center gap-4 mt-2">
          <Button
            variant="destructive"
            size="lg"
            className="h-14 w-14 rounded-full shadow-lg"
            onClick={onReject}
            aria-label="Decline call"
          >
            <PhoneOff className="h-6 w-6" />
          </Button>
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
        </div>
      </div>
    </div>
  );
};
