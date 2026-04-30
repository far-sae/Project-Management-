import React, { useEffect, useMemo, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, Sparkles, Download, FileText, Mic } from 'lucide-react';
import {
  summarizeMeetingTranscript,
  isAIEnabled,
  type MeetingNotes,
  type AIError,
} from '@/services/ai';
import type { MeetingRecording } from '@/hooks/useMeetingRecorder';
import { toast } from 'sonner';

interface MeetingNotesReviewModalProps {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  recording: MeetingRecording | null;
  /** Required for AI note generation — omit when unauthenticated. */
  userId?: string;
  /** Display name for the file download — defaults to "meeting". */
  meetingLabel?: string;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export const MeetingNotesReviewModal: React.FC<MeetingNotesReviewModalProps> = ({
  open,
  onOpenChange,
  recording,
  userId,
  meetingLabel = 'meeting',
}) => {
  const [transcript, setTranscript] = useState('');
  const [notes, setNotes] = useState<MeetingNotes | null>(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const aiAvailable = isAIEnabled();

  // Reset when a new recording is loaded into the modal.
  useEffect(() => {
    if (open && recording) {
      setTranscript(recording.transcript);
      setNotes(null);
      setError(null);
    }
  }, [open, recording]);

  const audioUrl = useMemo(() => {
    if (!recording?.audioBlob) return null;
    return URL.createObjectURL(recording.audioBlob);
  }, [recording]);

  // Revoke the object URL when the modal closes / recording changes so we
  // don't leak Blob references for long calls.
  useEffect(() => {
    return () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    };
  }, [audioUrl]);

  const handleDownloadAudio = () => {
    if (!recording?.audioBlob || !audioUrl) return;
    const a = document.createElement('a');
    a.href = audioUrl;
    const stamp = recording.startedAt
      ? recording.startedAt.replace(/[:T.]/g, '-').slice(0, 19)
      : new Date().toISOString().replace(/[:T.]/g, '-').slice(0, 19);
    a.download = `${meetingLabel}-${stamp}.webm`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const handleDownloadTranscript = () => {
    if (!transcript.trim()) return;
    const blob = new Blob([transcript], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const stamp = recording?.startedAt
      ? recording.startedAt.replace(/[:T.]/g, '-').slice(0, 19)
      : new Date().toISOString().replace(/[:T.]/g, '-').slice(0, 19);
    a.download = `${meetingLabel}-transcript-${stamp}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const handleDownloadNotes = () => {
    if (!notes) return;
    const lines: string[] = [];
    lines.push('# Meeting notes');
    if (recording?.startedAt) lines.push(`_Recorded: ${recording.startedAt}_`);
    if (recording?.durationSec)
      lines.push(`_Duration: ${formatDuration(recording.durationSec)}_`);
    lines.push('');
    lines.push('## Summary');
    lines.push(notes.summary || '(none)');
    lines.push('');
    if (notes.decisions.length) {
      lines.push('## Decisions');
      for (const d of notes.decisions) lines.push(`- ${d}`);
      lines.push('');
    }
    if (notes.actionItems.length) {
      lines.push('## Action items');
      for (const a of notes.actionItems) {
        const owner = a.owner ? ` — ${a.owner}` : '';
        const due = a.dueDate ? ` (due ${a.dueDate})` : '';
        lines.push(`- [ ] ${a.title}${owner}${due}`);
      }
      lines.push('');
    }
    if (notes.openQuestions.length) {
      lines.push('## Open questions');
      for (const q of notes.openQuestions) lines.push(`- ${q}`);
      lines.push('');
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const stamp = recording?.startedAt
      ? recording.startedAt.replace(/[:T.]/g, '-').slice(0, 19)
      : new Date().toISOString().replace(/[:T.]/g, '-').slice(0, 19);
    a.download = `${meetingLabel}-notes-${stamp}.md`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const handleGenerate = async () => {
    if (!userId?.trim()) {
      const msg = 'Sign in to generate AI notes.';
      setError(msg);
      toast.error(msg);
      return;
    }
    if (!transcript.trim()) {
      setError('Add some transcript text first.');
      return;
    }
    setGenerating(true);
    setError(null);
    try {
      const result = await summarizeMeetingTranscript(userId, transcript);
      setNotes(result);
      toast.success('AI notes ready');
    } catch (err) {
      const msg =
        (err as AIError)?.message ||
        (err instanceof Error ? err.message : 'Failed to generate notes');
      setError(msg);
      toast.error(msg);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mic className="h-4 w-4 text-primary" />
            Meeting recording
          </DialogTitle>
          <DialogDescription>
            {recording?.durationSec
              ? `Captured ${formatDuration(recording.durationSec)} of audio.`
              : 'Captured audio from the call.'}
            {' '}Review the transcript below, then generate AI notes if you'd like a tidy summary.
          </DialogDescription>
        </DialogHeader>

        {audioUrl && (
          <div className="rounded-lg border border-border bg-muted/30 p-3">
            <audio controls src={audioUrl} className="w-full" />
            <div className="mt-2 flex justify-end">
              <Button
                size="sm"
                variant="ghost"
                onClick={handleDownloadAudio}
                className="h-7 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
              >
                <Download className="h-3.5 w-3.5" />
                Download audio
              </Button>
            </div>
          </div>
        )}

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-sm font-medium text-foreground">
              Transcript
            </label>
            <Button
              size="sm"
              variant="ghost"
              onClick={handleDownloadTranscript}
              disabled={!transcript.trim()}
              className="h-7 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
            >
              <FileText className="h-3.5 w-3.5" />
              Download .txt
            </Button>
          </div>
          <Textarea
            value={transcript}
            onChange={(e) => setTranscript(e.target.value)}
            rows={8}
            placeholder="The transcript from your meeting will appear here. You can edit it before generating notes."
            className="text-sm"
          />
          {!transcript.trim() && (
            <p className="mt-1 text-xs text-muted-foreground">
              Live captioning needs Chrome or Edge. On other browsers, paste your own notes here
              and AI will tidy them up.
            </p>
          )}
        </div>

        <div>
          <Button
            type="button"
            onClick={() => void handleGenerate()}
            disabled={
              generating ||
              !transcript.trim() ||
              !aiAvailable ||
              !userId?.trim()
            }
            className="gap-2"
          >
            {generating ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            Generate AI notes
          </Button>
          {!aiAvailable && (
            <p className="mt-1 text-xs text-muted-foreground">
              AI is not configured for this workspace — only audio capture and the raw transcript
              are available.
            </p>
          )}
          {aiAvailable && !userId?.trim() && (
            <p className="mt-1 text-xs text-muted-foreground">
              Sign in to generate AI notes from the transcript.
            </p>
          )}
          {error && (
            <p className="mt-2 text-xs text-destructive">{error}</p>
          )}
        </div>

        {notes && (
          <div className="rounded-lg border border-border bg-card p-4 space-y-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                Summary
              </p>
              <p className="text-sm text-foreground whitespace-pre-wrap">
                {notes.summary || '—'}
              </p>
            </div>
            {notes.decisions.length > 0 && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                  Decisions
                </p>
                <ul className="list-disc list-inside space-y-1 text-sm text-foreground">
                  {notes.decisions.map((d, i) => <li key={i}>{d}</li>)}
                </ul>
              </div>
            )}
            {notes.actionItems.length > 0 && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                  Action items
                </p>
                <ul className="space-y-1 text-sm text-foreground">
                  {notes.actionItems.map((a, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <span className="mt-1 inline-block h-3.5 w-3.5 rounded border border-border" aria-hidden="true" />
                      <span className="flex-1">
                        {a.title}
                        {a.owner && (
                          <span className="text-muted-foreground"> — {a.owner}</span>
                        )}
                        {a.dueDate && (
                          <span className="text-muted-foreground"> (due {a.dueDate})</span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {notes.openQuestions.length > 0 && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                  Open questions
                </p>
                <ul className="list-disc list-inside space-y-1 text-sm text-foreground">
                  {notes.openQuestions.map((q, i) => <li key={i}>{q}</li>)}
                </ul>
              </div>
            )}
            <div className="pt-1 flex justify-end">
              <Button
                size="sm"
                variant="ghost"
                onClick={handleDownloadNotes}
                className="h-7 gap-1.5 text-xs"
              >
                <Download className="h-3.5 w-3.5" />
                Download notes (.md)
              </Button>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default MeetingNotesReviewModal;
