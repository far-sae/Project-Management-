import { beforeEach, describe, expect, it, vi } from 'vitest';

const lp = vi.hoisted(() => ({
  enableCameraAndMicrophone: vi.fn(async () => {}),
  setMicrophoneEnabled: vi.fn(async () => {}),
  setCameraEnabled: vi.fn(async () => {}),
  /** Resolves when the test lets the permission prompt "answer". */
  gate: null as null | Promise<void>,
}));

vi.mock('livekit-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('livekit-client')>();
  class FakeRoom {
    localParticipant = {
      identity: 'me',
      name: 'Me',
      isMicrophoneEnabled: false,
      isCameraEnabled: false,
      isScreenShareEnabled: false,
      attributes: {},
      metadata: '',
      trackPublications: new Map(),
      getTrackPublication: () => undefined,
      enableCameraAndMicrophone: async () => {
        if (lp.gate) await lp.gate;
        return lp.enableCameraAndMicrophone();
      },
      setMicrophoneEnabled: async (on: boolean) => {
        if (lp.gate) await lp.gate;
        return lp.setMicrophoneEnabled(on);
      },
      setCameraEnabled: (on: boolean) => lp.setCameraEnabled(on),
    };
    remoteParticipants = new Map([
      ['them', {
        identity: 'them',
        name: 'Them',
        isMicrophoneEnabled: true,
        isCameraEnabled: true,
        isScreenShareEnabled: false,
        attributes: {},
        metadata: '',
        trackPublications: new Map(),
        getTrackPublication: () => undefined,
      }],
    ]);
    on() {
      return this;
    }
    async connect() {}
    async disconnect() {}
  }
  return { ...actual, Room: FakeRoom };
});
vi.mock('@/services/livekit/fetchLiveKitToken', () => ({
  fetchLiveKitToken: async () => ({ token: 't', url: 'wss://x', identity: 'me', roomName: 'r' }),
  projectRoomName: (id: string) => `project:${id}`,
}));

import { LiveKitCallService } from '@/services/livekit/LiveKitCallService';

const events = () => ({
  onParticipantsChange: vi.fn(),
  onConnectionStateChange: vi.fn(),
  onDisconnected: vi.fn(),
  onError: vi.fn(),
});

describe('joining a call asks for camera + mic once', () => {
  beforeEach(() => {
    lp.enableCameraAndMicrophone.mockReset().mockResolvedValue(undefined);
    lp.setMicrophoneEnabled.mockReset().mockResolvedValue(undefined);
    lp.setCameraEnabled.mockReset().mockResolvedValue(undefined);
    lp.gate = null;
  });

  it('video call: one combined permission request, not mic then camera', async () => {
    const svc = new LiveKitCallService(events());
    await svc.connect({ roomName: 'project:p1', participantName: 'Me', mediaType: 'video' });
    expect(lp.enableCameraAndMicrophone).toHaveBeenCalledTimes(1);
    expect(lp.setCameraEnabled).not.toHaveBeenCalled();
    expect(lp.setMicrophoneEnabled).not.toHaveBeenCalled();
  });

  it('audio call: only the microphone', async () => {
    const svc = new LiveKitCallService(events());
    await svc.connect({ roomName: 'project:p1', participantName: 'Me', mediaType: 'audio' });
    expect(lp.setMicrophoneEnabled).toHaveBeenCalledWith(true);
    expect(lp.enableCameraAndMicrophone).not.toHaveBeenCalled();
  });

  it('camera refused or missing: still joins with the microphone', async () => {
    lp.enableCameraAndMicrophone.mockRejectedValue(new Error('Permission denied'));
    lp.setCameraEnabled.mockRejectedValue(new Error('Permission denied'));
    const ev = events();
    const svc = new LiveKitCallService(ev);
    await svc.connect({ roomName: 'project:p1', participantName: 'Me', mediaType: 'video' });
    expect(lp.setMicrophoneEnabled).toHaveBeenCalledWith(true);
    expect(ev.onError).toHaveBeenCalled();
  });

  it('shows who is in the call before the permission prompt is answered', async () => {
    let answer: () => void = () => {};
    lp.gate = new Promise<void>((r) => {
      answer = r;
    });
    const ev = events();
    const svc = new LiveKitCallService(ev);
    const joined = svc.connect({ roomName: 'project:p1', participantName: 'Me', mediaType: 'video' });
    await vi.waitFor(() => expect(ev.onParticipantsChange).toHaveBeenCalled());
    const peers = ev.onParticipantsChange.mock.calls[0][0] as Array<{ isLocal: boolean }>;
    expect(peers.some((p) => !p.isLocal)).toBe(true);
    answer();
    await joined;
  });
});
