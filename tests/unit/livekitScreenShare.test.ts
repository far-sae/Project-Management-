// What the call service reports while somebody shares a screen: the camera
// and the screen are two pictures, never one in place of the other.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const room = vi.hoisted(() => ({
  local: new Map<string, unknown>(),
  remote: new Map<string, unknown>(),
  localSharing: false,
  localPermissions: undefined as undefined | { canPublish: boolean; canSubscribe: boolean; canPublishSources: number[] },
  setScreenShareEnabled: vi.fn(async () => {}),
}));

vi.mock('livekit-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('livekit-client')>();
  class FakeRoom {
    localParticipant = {
      identity: 'guest:me',
      name: 'Me',
      isMicrophoneEnabled: true,
      isCameraEnabled: true,
      get isScreenShareEnabled() { return room.localSharing; },
      get permissions() { return room.localPermissions; },
      attributes: {},
      metadata: '',
      get trackPublications() { return room.local; },
      getTrackPublication: (source: string) => room.local.get(source),
      enableCameraAndMicrophone: async () => {},
      setMicrophoneEnabled: async () => {},
      setCameraEnabled: async () => {},
      setScreenShareEnabled: room.setScreenShareEnabled,
    };
    remoteParticipants = new Map([
      ['them', {
        identity: 'them',
        name: 'Them',
        attributes: {},
        metadata: '',
        permissions: { canPublish: true, canSubscribe: true, canPublishSources: [] },
        get trackPublications() { return room.remote; },
        getTrackPublication: (source: string) => room.remote.get(source),
      }],
    ]);
    on() { return this; }
    async connect() {}
    async disconnect() {}
  }
  return { ...actual, Room: FakeRoom };
});
vi.mock('@/services/livekit/fetchLiveKitToken', () => ({
  fetchLiveKitToken: async () => ({ token: 't', url: 'wss://x', identity: 'me', roomName: 'r' }),
  projectRoomName: (id: string) => `project:${id}`,
}));

import { LiveKitCallService, type CallPeerSnapshot } from '@/services/livekit/LiveKitCallService';

class FakeStream {
  constructor(readonly tracks: Array<{ id: string }>) {}
  ids() { return this.tracks.map((t) => t.id); }
}
const ids = (stream: MediaStream | null) => (stream as unknown as FakeStream | null)?.ids() ?? [];

const pub = (source: string, kind: 'audio' | 'video', id: string, over: Record<string, unknown> = {}) => ({
  source, kind, isMuted: false, isSubscribed: true, track: { kind, source, mediaStreamTrack: { id } }, ...over,
});
const camera = (id: string, over = {}) => ['camera', pub('camera', 'video', id, over)] as const;
const screenShare = (id: string) => ['screen_share', pub('screen_share', 'video', id)] as const;
const screenSound = (id: string) => ['screen_share_audio', pub('screen_share_audio', 'audio', id)] as const;
const microphone = (id: string) => ['microphone', pub('microphone', 'audio', id)] as const;

async function snapshots(): Promise<{ me: CallPeerSnapshot; them: CallPeerSnapshot; svc: LiveKitCallService }> {
  const onParticipantsChange = vi.fn();
  const svc = new LiveKitCallService({ onParticipantsChange, onConnectionStateChange: vi.fn(), onDisconnected: vi.fn(), onError: vi.fn() });
  await svc.connect({ roomName: 'project:p1', participantName: 'Me', mediaType: 'video' });
  const list = onParticipantsChange.mock.calls.at(-1)![0] as CallPeerSnapshot[];
  return { me: list.find((p) => p.isLocal)!, them: list.find((p) => !p.isLocal)!, svc };
}

beforeEach(() => {
  vi.stubGlobal('MediaStream', FakeStream);
  room.local = new Map();
  room.remote = new Map();
  room.localSharing = false;
  room.localPermissions = undefined;
  room.setScreenShareEnabled.mockClear();
});

describe('somebody else shares their screen', () => {
  it('keeps their camera as their picture and gives the screen as a second one', async () => {
    room.remote = new Map<string, unknown>([camera('their-camera'), screenShare('their-screen'), microphone('their-mic'), screenSound('their-screen-sound')]);
    const { them } = await snapshots();
    expect(them.isScreenSharing).toBe(true);
    expect(ids(them.videoStream)).toEqual(['their-camera']);
    expect(ids(them.screenStream)).toEqual(['their-screen']);
    expect(them.isCameraOff).toBe(false);
    // What they say and what the shared tab plays are both heard.
    expect(ids(them.audioStream).sort()).toEqual(['their-mic', 'their-screen-sound']);
  });

  it('has the same answer whichever of the two was published first', async () => {
    room.remote = new Map<string, unknown>([screenShare('their-screen'), camera('their-camera')]);
    const { them } = await snapshots();
    expect(ids(them.videoStream)).toEqual(['their-camera']);
    expect(ids(them.screenStream)).toEqual(['their-screen']);
  });

  it('says the camera is off when it is, and still gives the screen', async () => {
    room.remote = new Map<string, unknown>([camera('their-camera', { isMuted: true }), screenShare('their-screen')]);
    const { them } = await snapshots();
    expect(them.isCameraOff).toBe(true);
    expect(ids(them.screenStream)).toEqual(['their-screen']);
  });

  it('gives no screen when nobody shares', async () => {
    room.remote = new Map<string, unknown>([camera('their-camera')]);
    const { them } = await snapshots();
    expect(them.isScreenSharing).toBe(false);
    expect(them.screenStream).toBeNull();
    expect(ids(them.videoStream)).toEqual(['their-camera']);
  });
});

describe('you share your screen', () => {
  it('keeps your camera on and reports both pictures', async () => {
    room.localSharing = true;
    room.local = new Map<string, unknown>([camera('my-camera'), screenShare('my-screen'), microphone('my-mic')]);
    const { me } = await snapshots();
    expect(me.isScreenSharing).toBe(true);
    expect(me.isCameraOff).toBe(false);
    expect(ids(me.videoStream)).toEqual(['my-camera']);
    expect(ids(me.screenStream)).toEqual(['my-screen']);
  });

  it('starts the share without touching the camera', async () => {
    const { svc } = await snapshots();
    await svc.toggleScreenShare();
    expect(room.setScreenShareEnabled).toHaveBeenCalledWith(true, { audio: true });
  });
});

describe('whether you may share', () => {
  it('is no for a guest the server has not allowed', async () => {
    room.localPermissions = { canPublish: true, canSubscribe: true, canPublishSources: [1, 2] };
    expect((await snapshots()).me.canShareScreen).toBe(false);
  });

  it('is yes for a guest the server has allowed', async () => {
    room.localPermissions = { canPublish: true, canSubscribe: true, canPublishSources: [1, 2, 3, 4] };
    expect((await snapshots()).me.canShareScreen).toBe(true);
  });
});
