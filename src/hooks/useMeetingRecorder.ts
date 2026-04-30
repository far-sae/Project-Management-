import { useCallback, useEffect, useRef, useState } from 'react';

// Browser SpeechRecognition is webkit-prefixed on Chrome/Edge; types live on
// `window` but are not in lib.dom.d.ts. We narrow just enough to compile.
type SpeechRecognitionResultLike = {
  isFinal: boolean;
  0: { transcript: string };
};
interface SpeechRecognitionEventLike extends Event {
  resultIndex: number;
  results: { length: number; [i: number]: SpeechRecognitionResultLike };
}
interface SpeechRecognitionLike extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: Event) => void) | null;
  onend: (() => void) | null;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

export interface MeetingRecording {
  /** WebM/Opus blob produced by MediaRecorder, downloadable as audio. */
  audioBlob: Blob | null;
  /** ISO timestamp when recording started. */
  startedAt: string | null;
  /** Duration in seconds. */
  durationSec: number;
  /** Plain-text transcript built up from SpeechRecognition results. */
  transcript: string;
}

/** Outcome of `start()` so callers do not race `error` React state after await. */
export type MeetingRecorderStartResult =
  | { outcome: 'started' }
  | { outcome: 'failed'; error: string }
  /** `start()` was a no-op because recording was already active. */
  | { outcome: 'already' };

export interface UseMeetingRecorderResult {
  isRecording: boolean;
  /** Live transcript while recording (final + interim segments). */
  liveTranscript: string;
  /** True if Web SpeechRecognition is available — when false, only audio is captured. */
  speechRecognitionAvailable: boolean;
  /** Last error surfaced to the UI. */
  error: string | null;
  /** Most recently completed recording. Null until the user hits stop. */
  lastRecording: MeetingRecording | null;
  start: () => Promise<MeetingRecorderStartResult>;
  stop: () => Promise<MeetingRecording | null>;
  reset: () => void;
}

/**
 * Build a single mixed audio MediaStream from any number of source streams
 * via Web Audio. We connect each source's audio track into one
 * MediaStreamDestination so MediaRecorder can capture both sides of the call.
 *
 * Falls back to the first available stream when AudioContext isn't supported
 * (very old browsers) so recording at least captures one side.
 */
function buildMixedAudioStream(streams: Array<MediaStream | null | undefined>): {
  stream: MediaStream;
  cleanup: () => void;
} {
  const valid = streams.filter((s): s is MediaStream => !!s && s.getAudioTracks().length > 0);
  const AudioCtx =
    (window.AudioContext as typeof AudioContext | undefined) ||
    ((window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext as
      | typeof AudioContext
      | undefined);

  // No streams with audio — nothing to mix or pass through.
  if (valid.length === 0) {
    return { stream: new MediaStream(), cleanup: () => {} };
  }

  // No Web Audio API — passthrough the first stream with audio (valid[0] is safe here).
  if (!AudioCtx) {
    return { stream: valid[0], cleanup: () => {} };
  }

  const ctx = new AudioCtx();
  const dest = ctx.createMediaStreamDestination();
  const sources = valid.map((s) => ctx.createMediaStreamSource(s));
  for (const src of sources) src.connect(dest);

  return {
    stream: dest.stream,
    cleanup: () => {
      try {
        for (const src of sources) src.disconnect();
        dest.disconnect();
        void ctx.close();
      } catch {
        /* already torn down */
      }
    },
  };
}

/**
 * Hook that records the audio of an active call and (when the browser supports
 * it) runs Web SpeechRecognition over the mic to build a live transcript.
 *
 * The remote audio cannot be directly fed into SpeechRecognition (the API only
 * accepts the device microphone), so the transcript captures the local speaker
 * + anything the mic picks up from speakers. For a multi-speaker transcript,
 * a server-side Whisper pipeline would be needed — that's a follow-up.
 */
export function useMeetingRecorder(
  localStream: MediaStream | null,
  remoteStream: MediaStream | null,
): UseMeetingRecorderResult {
  const [isRecording, setIsRecording] = useState(false);
  const [liveTranscript, setLiveTranscript] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [lastRecording, setLastRecording] = useState<MeetingRecording | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const cleanupAudioRef = useRef<() => void>(() => {});
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const finalTranscriptRef = useRef('');
  const startedAtRef = useRef<string | null>(null);
  const startedAtMsRef = useRef<number>(0);

  const speechRecognitionAvailable = !!getSpeechRecognitionCtor();

  const stopRecognition = useCallback(() => {
    const rec = recognitionRef.current;
    if (!rec) return;
    rec.onresult = null;
    rec.onerror = null;
    rec.onend = null;
    try { rec.stop(); } catch { /* already stopped */ }
    recognitionRef.current = null;
  }, []);

  const start = useCallback(async (): Promise<MeetingRecorderStartResult> => {
    if (isRecording) {
      return { outcome: 'already' };
    }
    setError(null);
    setLiveTranscript('');
    finalTranscriptRef.current = '';

    if (typeof MediaRecorder === 'undefined') {
      const msg = 'Recording is not supported in this browser.';
      setError(msg);
      return { outcome: 'failed', error: msg };
    }

    const { stream: mixed, cleanup } = buildMixedAudioStream([localStream, remoteStream]);
    if (mixed.getAudioTracks().length === 0) {
      cleanup();
      const msg = 'No audio source available to record.';
      setError(msg);
      return { outcome: 'failed', error: msg };
    }
    cleanupAudioRef.current = cleanup;

    let recorder: MediaRecorder;
    try {
      // Prefer opus where supported — best compression and broadest playback.
      const opts = MediaRecorder.isTypeSupported?.('audio/webm;codecs=opus')
        ? { mimeType: 'audio/webm;codecs=opus' }
        : undefined;
      recorder = new MediaRecorder(mixed, opts);
    } catch (err) {
      cleanup();
      const msg =
        err instanceof Error ? err.message : 'Failed to start recorder';
      setError(msg);
      return { outcome: 'failed', error: msg };
    }

    chunksRef.current = [];
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.onerror = () => {
      setError('Recorder error — recording stopped.');
    };
    recorder.start(1000); // emit a chunk every 1s so we don't lose anything if the tab crashes
    recorderRef.current = recorder;
    startedAtRef.current = new Date().toISOString();
    startedAtMsRef.current = Date.now();
    setIsRecording(true);

    // Live captioning via Web SpeechRecognition (Chrome/Edge). Independent of
    // the audio recorder — if it fails we still capture the audio file.
    const Ctor = getSpeechRecognitionCtor();
    if (Ctor) {
      try {
        const rec = new Ctor();
        rec.continuous = true;
        rec.interimResults = true;
        rec.lang = navigator.language || 'en-US';
        rec.onresult = (event: SpeechRecognitionEventLike) => {
          let interim = '';
          for (let i = event.resultIndex; i < event.results.length; i++) {
            const result = event.results[i];
            const text = result[0].transcript;
            if (result.isFinal) {
              finalTranscriptRef.current = `${finalTranscriptRef.current} ${text}`.trim();
            } else {
              interim += text;
            }
          }
          const combined = `${finalTranscriptRef.current}${interim ? ` ${interim}` : ''}`.trim();
          setLiveTranscript(combined);
        };
        rec.onerror = () => {
          // Common: 'not-allowed' (mic permission), 'no-speech', 'aborted'.
          // Don't surface — recording continues without captions.
        };
        rec.onend = () => {
          // Browsers stop SpeechRecognition after a few seconds of silence.
          // Restart it while the recorder is still running so the transcript
          // doesn't truncate mid-meeting.
          if (recorderRef.current && recorderRef.current.state === 'recording') {
            try { rec.start(); } catch { /* already restarted */ }
          }
        };
        rec.start();
        recognitionRef.current = rec;
      } catch {
        // SpeechRecognition init failed — recording continues without captions.
      }
    }

    return { outcome: 'started' };
  }, [isRecording, localStream, remoteStream]);

  const stop = useCallback(async (): Promise<MeetingRecording | null> => {
    const recorder = recorderRef.current;
    if (!recorder) return null;
    if (recorder.state === 'inactive') return lastRecording;

    const result = await new Promise<MeetingRecording>((resolve) => {
      recorder.onstop = () => {
        const audioBlob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        const transcript = finalTranscriptRef.current.trim();
        const durationSec = Math.max(0, Math.round((Date.now() - startedAtMsRef.current) / 1000));
        resolve({
          audioBlob,
          startedAt: startedAtRef.current,
          durationSec,
          transcript,
        });
      };
      try { recorder.stop(); } catch { /* already stopped */ }
    });

    stopRecognition();
    cleanupAudioRef.current();
    cleanupAudioRef.current = () => {};
    recorderRef.current = null;
    chunksRef.current = [];

    setIsRecording(false);
    setLastRecording(result);
    setLiveTranscript(result.transcript);
    return result;
  }, [lastRecording, stopRecognition]);

  const reset = useCallback(() => {
    setLastRecording(null);
    setLiveTranscript('');
    setError(null);
    finalTranscriptRef.current = '';
  }, []);

  // Auto-stop on unmount so we don't leak the AudioContext / MediaRecorder.
  useEffect(() => {
    return () => {
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== 'inactive') {
        try { recorder.stop(); } catch { /* noop */ }
      }
      stopRecognition();
      cleanupAudioRef.current();
    };
  }, [stopRecognition]);

  return {
    isRecording,
    liveTranscript,
    speechRecognitionAvailable,
    error,
    lastRecording,
    start,
    stop,
    reset,
  };
}
