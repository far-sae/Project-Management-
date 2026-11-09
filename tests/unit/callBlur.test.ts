import { beforeEach, describe, expect, it, vi } from 'vitest';

const supported = { value: true };
vi.mock('@livekit/track-processors', () => ({
  supportsBackgroundProcessors: () => supported.value,
  BackgroundProcessor: vi.fn((opts: unknown) => ({ kind: 'blur-processor', opts })),
}));

import { LiveKitCallService } from '@/services/livekit/LiveKitCallService';

function makeService(cameraTrack: unknown) {
  const svc = new LiveKitCallService({
    onParticipantsChange: vi.fn(),
    onConnectionStateChange: vi.fn(),
    onDisconnected: vi.fn(),
    onError: vi.fn(),
  });
  const localParticipant = {
    identity: 'me',
    name: 'Me',
    isMicrophoneEnabled: true,
    isCameraEnabled: true,
    isScreenShareEnabled: false,
    isSpeaking: false,
    getTrackPublication: vi.fn((source: string) =>
      source === 'camera' && cameraTrack ? { track: cameraTrack } : undefined,
    ),
  };
  (svc as unknown as { room: unknown }).room = {
    localParticipant,
    remoteParticipants: new Map(),
  };
  return svc;
}

describe('LiveKitCallService.setBackgroundBlur', () => {
  beforeEach(() => {
    supported.value = true;
  });

  it('attaches a background-blur processor to the camera track', async () => {
    const track = { setProcessor: vi.fn(async () => {}), stopProcessor: vi.fn(async () => {}) };
    await makeService(track).setBackgroundBlur(true);
    expect(track.setProcessor).toHaveBeenCalledTimes(1);
    const processor = (track.setProcessor.mock.calls[0] as unknown[])[0] as {
      opts: { mode: string };
    };
    expect(processor.opts.mode).toBe('background-blur');
  });

  it('removes the processor when blur is turned off', async () => {
    const track = { setProcessor: vi.fn(async () => {}), stopProcessor: vi.fn(async () => {}) };
    const svc = makeService(track);
    await svc.setBackgroundBlur(true);
    await svc.setBackgroundBlur(false);
    expect(track.stopProcessor).toHaveBeenCalledTimes(1);
  });

  it('fails clearly when the camera is not on', async () => {
    await expect(makeService(null).setBackgroundBlur(true)).rejects.toThrow(/camera/i);
  });

  it('fails clearly on browsers without support', async () => {
    supported.value = false;
    const track = { setProcessor: vi.fn(async () => {}), stopProcessor: vi.fn(async () => {}) };
    await expect(makeService(track).setBackgroundBlur(true)).rejects.toThrow(/browser/i);
    expect(track.setProcessor).not.toHaveBeenCalled();
  });
});
