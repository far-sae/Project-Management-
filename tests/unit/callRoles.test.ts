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

describe('LiveKitCallService role derivation', () => {
  const events = () => ({
    onParticipantsChange: vi.fn(),
    onConnectionStateChange: vi.fn(),
    onDisconnected: vi.fn(),
    onError: vi.fn(),
  });
  const remote = (identity: string, metadata: string) => ({
    identity,
    name: identity,
    metadata,
    trackPublications: new Map(),
    getTrackPublication: () => undefined,
    isSpeaking: false,
    attributes: {},
  });

  async function connected() {
    connectFn.mockReset().mockResolvedValue(undefined);
    const ev = events();
    const svc = new LiveKitCallService(ev);
    await svc.connect({
      roomName: 'r',
      participantName: 'G',
      mediaType: 'audio',
      credentials: { token: 't', url: 'u' },
      publishOnConnect: false,
    });
    const room = (svc as unknown as { room: { remoteParticipants: Map<string, unknown> } }).room;
    return { svc, ev, room };
  }
  const lastPeers = (ev: ReturnType<typeof events>) =>
    ev.onParticipantsChange.mock.calls.at(-1)![0] as CallPeerSnapshot[];

  it('ignores self-edited guest/waiting metadata on a member identity', async () => {
    const { svc, ev, room } = await connected();
    room.remoteParticipants.set(
      'a',
      remote('7a1b-uuid', '{"role":"guest","status":"waiting"}'),
    );
    room.remoteParticipants.set(
      'b',
      remote('guest:x', '{"role":"guest","status":"waiting"}'),
    );
    await svc.publishLocalMedia({ mic: false, camera: false });
    const peers = lastPeers(ev);
    const member = peers.find((p) => p.userId === '7a1b-uuid')!;
    const guest = peers.find((p) => p.userId === 'guest:x')!;
    expect(member.role).toBe('member');
    expect(member.isWaiting).toBe(false);
    expect(guest.role).toBe('guest');
    expect(guest.isWaiting).toBe(true);
  });
});

describe('LiveKitCallService.publishLocalMedia isolation', () => {
  it('still enables the camera when the microphone fails, reporting both errors', async () => {
    connectFn.mockReset().mockResolvedValue(undefined);
    setMicrophoneEnabled.mockReset().mockRejectedValue(new Error('mic denied'));
    setCameraEnabled.mockReset().mockRejectedValue(new Error('cam denied'));
    const onError = vi.fn();
    const svc = new LiveKitCallService({
      onParticipantsChange: vi.fn(),
      onConnectionStateChange: vi.fn(),
      onDisconnected: vi.fn(),
      onError,
    });
    await svc.connect({
      roomName: 'r',
      participantName: 'G',
      mediaType: 'video',
      credentials: { token: 't', url: 'u' },
      publishOnConnect: false,
    });
    await svc.publishLocalMedia({ mic: true, camera: true });
    expect(setCameraEnabled).toHaveBeenCalledWith(true);
    expect(onError).toHaveBeenCalledWith('mic denied');
    expect(onError).toHaveBeenCalledWith('cam denied');
  });
});
