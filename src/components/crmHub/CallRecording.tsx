import React, { useEffect, useRef, useState } from 'react';
import { Loader2, Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { errorSentence, fetchRecording } from '@/services/voice/client';
import type { CrmActivity } from '@/types/crmHub';

/** The id of the recorded call behind a timeline entry, or null when it has no recording. */
export const recordedCallId = (activity: Pick<CrmActivity, 'type' | 'metadata'>): string | null => {
  const meta = activity.metadata as { callId?: unknown; recorded?: unknown } | null | undefined;
  return activity.type === 'call' && meta?.recorded === true && typeof meta.callId === 'string' ? meta.callId : null;
};

/**
 * "Play recording" on a call's timeline entry. The audio is fetched through
 * our own server (which checks the person may hear it) only when asked for.
 */
export const CallRecording: React.FC<{ callId: string }> = ({ callId }) => {
  const [src, setSrc] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const made = useRef<string | null>(null);

  useEffect(() => () => {
    if (made.current) URL.revokeObjectURL(made.current);
  }, []);

  const load = async () => {
    setLoading(true);
    setProblem(null);
    try {
      const url = URL.createObjectURL(await fetchRecording(callId));
      made.current = url;
      setSrc(url);
    } catch (err) {
      setProblem(errorSentence(err));
    } finally {
      setLoading(false);
    }
  };

  if (src) {
    return (
      <audio className="mt-2 h-9 w-full max-w-sm" controls autoPlay src={src} aria-label="Call recording" />
    );
  }
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <Button type="button" variant="outline" size="sm" onClick={load} disabled={loading}>
        {loading ? <Loader2 className="animate-spin" aria-hidden /> : <Play aria-hidden />}Play recording
      </Button>
      {problem && <p role="alert" className="text-xs text-destructive">{problem}</p>}
    </div>
  );
};
