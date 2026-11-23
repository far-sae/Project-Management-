// Sharing a screen in a call: the screen takes the middle, everybody's camera
// goes to the side, and the person sharing keeps their own camera picture.
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { ParticipantTile, ScreenShareStage } from '@/components/calling/CallTiles';
import { mayShareScreen, pickMiniMainTile } from '@/services/livekit/callHelpers';
import type { CallPeerSnapshot } from '@/services/livekit/LiveKitCallService';
import { guestAdmittedPermission } from '../../supabase/functions/_shared/livekitRoles';

const camera = { id: 'camera' } as unknown as MediaStream;
const shared = { id: 'screen' } as unknown as MediaStream;

function peer(p: Partial<CallPeerSnapshot> & { userId: string }): CallPeerSnapshot {
  return {
    displayName: p.userId,
    audioStream: null,
    videoStream: camera,
    screenStream: null,
    isMicMuted: false,
    isCameraOff: false,
    isScreenSharing: false,
    canShareScreen: true,
    isSpeaking: false,
    isLocal: false,
    role: 'member',
    isWaiting: false,
    isRecording: false,
    ...p,
  };
}
const sharer = (over: Partial<CallPeerSnapshot> = {}) =>
  peer({ userId: 'elena', displayName: 'Elena', isScreenSharing: true, screenStream: shared, ...over });
const streamOf = (el: Element | null) => (el as HTMLVideoElement | null)?.srcObject ?? null;

beforeEach(() => { HTMLMediaElement.prototype.play = vi.fn(() => Promise.resolve()); });
afterEach(cleanup);

describe('a tile of somebody who is sharing', () => {
  it('still shows their camera: sharing does not take their picture away', () => {
    const { container } = render(<ParticipantTile snap={sharer()} />);
    expect(streamOf(container.querySelector('video'))).toBe(camera);
    expect(screen.getByText('Sharing')).toBeTruthy();
    expect(screen.queryByLabelText("Elena's camera is off")).toBeNull();
  });

  it('shows their initial when the camera really is off, sharing or not', () => {
    const { container } = render(<ParticipantTile snap={sharer({ isCameraOff: true })} />);
    expect(container.querySelector('video')).toBeNull();
    expect(screen.getByLabelText("Elena's camera is off")).toBeTruthy();
  });

  it('shows the screen itself when asked to, whole and never mirrored', () => {
    const { container } = render(<ParticipantTile snap={sharer({ isLocal: true })} screen />);
    const video = container.querySelector('video') as HTMLVideoElement;
    expect(streamOf(video)).toBe(shared);
    expect(video.className).toContain('object-contain');
    expect(video.className).not.toContain('scale-x-[-1]');
    expect(screen.getByText('Your screen')).toBeTruthy();
  });

  it('says whose screen it is', () => {
    render(<ParticipantTile snap={sharer()} screen />);
    expect(screen.getByText('Elena’s screen')).toBeTruthy();
    // The screen is not a person: it has no microphone or camera marks.
    expect(screen.queryByText('Sharing')).toBeNull();
  });

  it('shows the screen even while their camera is off', () => {
    const { container } = render(<ParticipantTile snap={sharer({ isCameraOff: true, videoStream: null })} screen />);
    expect(streamOf(container.querySelector('video'))).toBe(shared);
  });
});

describe('the call while a screen is shared', () => {
  const me = peer({ userId: 'me', displayName: 'Sam', isLocal: true });
  const priya = peer({ userId: 'priya', displayName: 'Priya', role: 'guest' });

  it('puts the screen in the middle and everybody at the side, the sharer among them', () => {
    render(<ScreenShareStage sharer={sharer()} peers={[me, sharer(), priya]} />);
    const stage = screen.getByTestId('shared-screen');
    expect(streamOf(stage.querySelector('video'))).toBe(shared);
    const side = screen.getByRole('list', { name: 'People in the call' });
    const names = within(side).getAllByRole('listitem').map((item) => item.textContent ?? '');
    expect(names).toHaveLength(3);
    // The person sharing comes first, with their own camera.
    expect(names[0]).toContain('Elena');
    expect(streamOf(within(side).getAllByRole('listitem')[0]!.querySelector('video'))).toBe(camera);
    expect(names.join(' ')).toContain('Sam');
    expect(names.join(' ')).toContain('Priya');
  });

  it('keeps the side list on a phone too, as a row under the screen', () => {
    render(<ScreenShareStage sharer={sharer()} peers={[me, sharer()]} />);
    const side = screen.getByRole('list', { name: 'People in the call' });
    expect(side.className).not.toMatch(/(^| )hidden( |$)/);
    expect(side.className).toContain('sm:flex-col');
  });

  it('works when the person sharing is you', () => {
    const mine = sharer({ userId: 'me', displayName: 'Sam', isLocal: true });
    render(<ScreenShareStage sharer={mine} peers={[mine, priya]} />);
    expect(within(screen.getByTestId('shared-screen')).getByText('Your screen')).toBeTruthy();
    expect(within(screen.getByRole('list', { name: 'People in the call' })).getAllByRole('listitem')).toHaveLength(2);
  });
});

describe('the small floating window', () => {
  it('shows your camera when you are the one sharing, never your own screen', () => {
    const mine = sharer({ userId: 'me', isLocal: true });
    const picked = pickMiniMainTile([mine]);
    expect(picked).toBe(mine);
    expect(picked?.videoStream).toBe(camera);
  });
});

describe('who may share a screen', () => {
  // LiveKit's numbers for a track's source: 1 camera, 2 microphone, 3 screen, 4 the screen's sound.
  it('is a guest once the server lets them, and not before', () => {
    expect(mayShareScreen({ canPublish: true, canPublishSources: [1, 2] }, true)).toBe(false);
    expect(mayShareScreen({ canPublish: true, canPublishSources: [1, 2, 3, 4] }, true)).toBe(true);
    // A guest still waiting to be let in can publish nothing.
    expect(mayShareScreen({ canPublish: false, canPublishSources: [] }, true)).toBe(false);
    expect(mayShareScreen(undefined, true)).toBe(false);
  });

  it('is every team member: an empty list means every source', () => {
    expect(mayShareScreen({ canPublish: true, canPublishSources: [] }, false)).toBe(true);
    expect(mayShareScreen(undefined, false)).toBe(true);
  });

  it('is what the server gives a guest who is let in', () => {
    expect(guestAdmittedPermission().canPublishSources).toEqual(['CAMERA', 'MICROPHONE', 'SCREEN_SHARE', 'SCREEN_SHARE_AUDIO']);
  });
});
