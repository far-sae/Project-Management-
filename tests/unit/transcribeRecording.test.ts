import { beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.fn();
vi.mock('@/services/supabase/config', () => ({
  supabase: { functions: { invoke: (...args: unknown[]) => invoke(...args) } },
}));

import {
  MAX_TRANSCRIBE_BYTES,
  transcribeRecording,
} from '@/services/ai/transcribeRecording';
import { combineTranscript } from '@/hooks/useMeetingRecorder';

describe('transcribeRecording', () => {
  beforeEach(() => invoke.mockReset());

  it('sends the recorded audio to the transcribe-audio function and returns the text', async () => {
    invoke.mockResolvedValue({ data: { text: '  hello team  ' }, error: null });
    const blob = new Blob(['abc'], { type: 'audio/webm' });
    await expect(transcribeRecording(blob)).resolves.toBe('hello team');
    const [name, opts] = invoke.mock.calls[0] as [string, { body: FormData }];
    expect(name).toBe('transcribe-audio');
    expect(opts.body).toBeInstanceOf(FormData);
    expect(opts.body.get('file')).toBeInstanceOf(Blob);
  });

  it('throws the server error message', async () => {
    invoke.mockResolvedValue({ data: { error: 'OPENAI_API_KEY missing' }, error: null });
    await expect(transcribeRecording(new Blob(['a']))).rejects.toThrow(/OPENAI_API_KEY/);
  });

  it('refuses files over the 25MB transcription limit without uploading', async () => {
    const big = { size: MAX_TRANSCRIBE_BYTES + 1, type: 'audio/webm' } as Blob;
    await expect(transcribeRecording(big)).rejects.toThrow(/too long/i);
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe('combineTranscript', () => {
  it('keeps the last unfinished sentence when recording stops', () => {
    expect(combineTranscript('first part.', 'and the last bit')).toBe(
      'first part. and the last bit',
    );
    expect(combineTranscript('', '  only interim ')).toBe('only interim');
    expect(combineTranscript('done.', '')).toBe('done.');
  });
});
