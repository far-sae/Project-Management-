import { supabase } from '@/services/supabase/config';

/** OpenAI's upload limit for a single transcription request. */
export const MAX_TRANSCRIBE_BYTES = 25 * 1024 * 1024;

/**
 * Transcribe a recorded call (every participant's voice is in the mixed
 * recording) via the `transcribe-audio` Edge Function (OpenAI Whisper).
 * Resolves to the trimmed transcript text; throws with a readable message.
 */
export async function transcribeRecording(audio: Blob): Promise<string> {
  if (audio.size > MAX_TRANSCRIBE_BYTES) {
    throw new Error('Recording is too long to transcribe automatically (max 25 MB).');
  }
  const form = new FormData();
  const name = (audio.type || '').includes('mp4') ? 'call.mp4' : 'call.webm';
  form.append('file', audio, name);

  const { data, error } = await supabase.functions.invoke('transcribe-audio', {
    body: form,
  });
  if (error) {
    const msg = error.message || '';
    if (/not.*found|404/i.test(msg)) {
      throw new Error(
        'transcribe-audio Edge Function is not deployed. Run: supabase functions deploy transcribe-audio',
      );
    }
    throw new Error(msg || 'Transcription failed');
  }
  const body = (data ?? {}) as { text?: string; error?: string };
  if (body.error) throw new Error(body.error);
  return (body.text ?? '').trim();
}
