import { describe, expect, it, vi } from 'vitest';

const roomOptions: unknown[] = [];
vi.mock('livekit-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('livekit-client')>();
  class FakeRoom {
    localParticipant = {};
    remoteParticipants = new Map();
    constructor(opts: unknown) {
      roomOptions.push(opts);
    }
    on() {
      return this;
    }
    async connect() {
      throw new Error('stop here');
    }
  }
  return { ...actual, Room: FakeRoom };
});
vi.mock('@/services/livekit/fetchLiveKitToken', () => ({
  fetchLiveKitToken: async () => ({ token: 't', url: 'wss://x', identity: 'me', roomName: 'r' }),
  projectRoomName: (id: string) => `project:${id}`,
}));

import { LiveKitCallService } from '@/services/livekit/LiveKitCallService';

describe('LiveKit room options', () => {
  it('disables adaptiveStream (tiles use raw MediaStreams, never track.attach())', async () => {
    // Regression: with adaptiveStream on, LiveKit treats a remote video with
    // no attach()-ed element as invisible and asks the server to stop
    // sending it — remote cameras/screens froze or never started.
    const svc = new LiveKitCallService({
      onParticipantsChange: vi.fn(),
      onConnectionStateChange: vi.fn(),
      onDisconnected: vi.fn(),
      onError: vi.fn(),
    });
    await expect(
      svc.connect({ roomName: 'project:p1', participantName: 'Me', mediaType: 'video' }),
    ).rejects.toThrow('stop here');
    expect(roomOptions[0]).toMatchObject({ adaptiveStream: false, dynacast: true });
  });
});
