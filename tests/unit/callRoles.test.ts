import { describe, it, expect, vi, beforeEach } from 'vitest';

const fetchLiveKitToken = vi.fn();
vi.mock('@/services/livekit/fetchLiveKitToken', () => ({
  fetchLiveKitToken: (...a: unknown[]) => fetchLiveKitToken(...a),
  projectRoomName: (id: string) => `project:${id}`,
}));

const setMicrophoneEnabled = vi.fn();
const setCameraEnabled = vi.fn();
const connectFn = vi.fn();
vi.mock('livekit-client', async () => {
  const actual = await vi.importActual<typeof import('livekit-client')>('livekit-client');
  class FakeRoom {
    remoteParticipants = new Map();
    localParticipant = {
      identity: 'guest:1',
      name: 'G',
      setMicrophoneEnabled,
      setCameraEnabled,
      getTrackPublication: () => undefined,
      attributes: {},
      permissions: { canSubscribe: true },
    };
    on() {
      return this;
    }
    connect(...a: unknown[]) {
      return connectFn(...a);
    }
    disconnect = vi.fn();
  }
  return { ...actual, Room: FakeRoom };
});

import {
  parseParticipantMeta,
  visiblePeers,
  waitingGuests,
  anyoneRecording,
} from '@/services/livekit/callHelpers';
import { LiveKitCallService, type CallPeerSnapshot } from '@/services/livekit/LiveKitCallService';

function peer(over: Partial<CallPeerSnapshot>): CallPeerSnapshot {
  return {
    userId: 'u',
    displayName: 'U',
    audioStream: null,
    videoStream: null,
    isMicMuted: false,
    isCameraOff: false,
    isScreenSharing: false,
    isSpeaking: false,
    isLocal: false,
    role: 'member',
    isWaiting: false,
    isRecording: false,
    ...over,
  };
}

describe('parseParticipantMeta', () => {
  it('parses waiting guest', () => {
    expect(parseParticipantMeta('{"role":"guest","status":"waiting"}')).toEqual({
      role: 'guest',
      status: 'waiting',
    });
  });
  it('parses admitted guest', () => {
    expect(parseParticipantMeta('{"role":"guest","status":"admitted"}')).toEqual({
      role: 'guest',
      status: 'admitted',
    });
  });
  it('bad JSON is a member', () => {
    expect(parseParticipantMeta('nope')).toEqual({ role: 'member', status: null });
  });
  it('undefined is a member', () => {
    expect(parseParticipantMeta(undefined)).toEqual({ role: 'member', status: null });
  });
});

describe('peer list helpers', () => {
  const list = [
    peer({ userId: 'a' }),
    peer({ userId: 'g1', role: 'guest', isWaiting: true }),
    peer({ userId: 'g2', role: 'guest', isRecording: true }),
  ];
  it('visiblePeers drops waiting', () => {
    expect(visiblePeers(list).map((p) => p.userId)).toEqual(['a', 'g2']);
  });
  it('waitingGuests keeps only waiting', () => {
    expect(waitingGuests(list).map((p) => p.userId)).toEqual(['g1']);
  });
  it('anyoneRecording', () => {
    expect(anyoneRecording(list)).toBe(true);
    expect(anyoneRecording([peer({})])).toBe(false);
  });
});

describe('LiveKitCallService.connect with credentials', () => {
  beforeEach(() => {
    fetchLiveKitToken.mockReset();
    setMicrophoneEnabled.mockReset();
    setCameraEnabled.mockReset();
    connectFn.mockReset().mockResolvedValue(undefined);
  });

  const events = () => ({
    onParticipantsChange: vi.fn(),
    onConnectionStateChange: vi.fn(),
    onDisconnected: vi.fn(),
    onError: vi.fn(),
  });

  it('skips token fetch and publishing', async () => {
    const svc = new LiveKitCallService(events());
    await svc.connect({
      roomName: 'project:1',
      participantName: 'G',
      mediaType: 'video',
      credentials: { token: 't', url: 'wss://l' },
      publishOnConnect: false,
    });
    expect(fetchLiveKitToken).not.toHaveBeenCalled();
    expect(connectFn).toHaveBeenCalledWith('wss://l', 't', expect.anything());
    expect(setMicrophoneEnabled).not.toHaveBeenCalled();
    expect(setCameraEnabled).not.toHaveBeenCalled();
  });

  it('default path still fetches token and publishes', async () => {
    fetchLiveKitToken.mockResolvedValue({ token: 't', url: 'wss://l' });
    const svc = new LiveKitCallService(events());
    await svc.connect({ roomName: 'project:1', participantName: 'G', mediaType: 'video' });
    expect(fetchLiveKitToken).toHaveBeenCalled();
    expect(setMicrophoneEnabled).toHaveBeenCalledWith(true);
    expect(setCameraEnabled).toHaveBeenCalledWith(true);
  });

  it('publishLocalMedia publishes requested tracks', async () => {
    const svc = new LiveKitCallService(events());
    await svc.connect({
      roomName: 'r',
      participantName: 'G',
      mediaType: 'audio',
      credentials: { token: 't', url: 'u' },
      publishOnConnect: false,
    });
    await svc.publishLocalMedia({ mic: true, camera: false });
    expect(setMicrophoneEnabled).toHaveBeenCalledWith(true);
    expect(setCameraEnabled).not.toHaveBeenCalled();
  });
});
