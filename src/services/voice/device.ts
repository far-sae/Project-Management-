/**
 * The phone line itself: the provider's browser library, loaded only when a
 * call is actually placed (it is large, and most visits never call anyone).
 */

export type LineEvent = 'ringing' | 'answered' | 'ended';

export interface Line {
  hangUp(): void;
  mute(on: boolean): void;
  /** Keypad tones, for "press 1 for sales". */
  press(digits: string): void;
}

export const MICROPHONE_MESSAGE = 'Allow the microphone for this site in your browser, then call again.';
export const LINE_FAILED_MESSAGE = 'The call could not be connected. Please try again.';

const isMicrophoneProblem = (err: unknown): boolean => {
  const e = err as { name?: string; code?: number; message?: string } | null;
  const text = `${e?.name ?? ''} ${e?.message ?? ''}`.toLowerCase();
  // 31208: the person refused the microphone; 31201 / 31402: none could be opened.
  return e?.code === 31208 || e?.code === 31201 || e?.code === 31402 || text.includes('notallowed') || text.includes('permission') || text.includes('microphone');
};

/**
 * Places the call the server prepared (`callId`) with its short-lived `token`.
 * `on` is told when the other phone rings, when it is answered, and once when
 * the call is over (with a sentence when it ended because something failed).
 */
export async function openLine(
  token: string,
  callId: string,
  on: (event: LineEvent, problem?: string) => void,
): Promise<Line> {
  const { Device } = await import('@twilio/voice-sdk');
  const device = new Device(token, { closeProtection: true });
  let over = false;
  const finish = (problem?: string) => {
    if (over) return;
    over = true;
    try {
      device.destroy();
    } catch {
      /* already gone */
    }
    on('ended', problem);
  };

  device.on('error', (err: unknown) => finish(isMicrophoneProblem(err) ? MICROPHONE_MESSAGE : LINE_FAILED_MESSAGE));

  let call: Awaited<ReturnType<typeof device.connect>>;
  try {
    // Only the id goes to the provider: the number to ring is on the server's own record of this call.
    call = await device.connect({ params: { callId } });
  } catch (err) {
    finish(isMicrophoneProblem(err) ? MICROPHONE_MESSAGE : LINE_FAILED_MESSAGE);
    throw err;
  }
  call.on('ringing', () => on('ringing'));
  call.on('accept', () => on('answered'));
  call.on('disconnect', () => finish());
  call.on('cancel', () => finish());
  call.on('reject', () => finish());
  call.on('error', (err: unknown) => finish(isMicrophoneProblem(err) ? MICROPHONE_MESSAGE : LINE_FAILED_MESSAGE));

  return {
    hangUp: () => {
      try {
        call.disconnect();
      } finally {
        finish();
      }
    },
    mute: (muted) => call.mute(muted),
    press: (digits) => call.sendDigits(digits),
  };
}
