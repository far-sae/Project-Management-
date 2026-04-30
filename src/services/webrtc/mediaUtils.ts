import type { CallMediaType } from './types';

const VIDEO_CONSTRAINTS: MediaTrackConstraints = {
  width: { ideal: 1280, max: 1920 },
  height: { ideal: 720, max: 1080 },
  frameRate: { ideal: 30, max: 30 },
};

const SCREEN_CONSTRAINTS: DisplayMediaStreamOptions = {
  video: {
    width: { ideal: 1920 },
    height: { ideal: 1080 },
    frameRate: { ideal: 15, max: 30 },
  },
  audio: false,
};

export async function acquireUserMedia(
  mediaType: CallMediaType,
): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio: true,
    video: mediaType === 'video' ? VIDEO_CONSTRAINTS : false,
  });
}

export async function acquireScreenMedia(): Promise<MediaStream> {
  return navigator.mediaDevices.getDisplayMedia(SCREEN_CONSTRAINTS);
}

export function stopAllTracks(stream: MediaStream | null | undefined): void {
  stream?.getTracks().forEach((t) => t.stop());
}

export function setTrackEnabled(
  stream: MediaStream | null,
  kind: 'audio' | 'video',
  enabled: boolean,
): void {
  stream
    ?.getTracks()
    .filter((t) => t.kind === kind)
    .forEach((t) => {
      t.enabled = enabled;
    });
}

export async function enumerateDevices(
  kind: MediaDeviceKind,
): Promise<MediaDeviceInfo[]> {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((d) => d.kind === kind);
}

export function isMediaSupported(): boolean {
  return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
}

export function isScreenShareSupported(): boolean {
  return !!(navigator.mediaDevices && 'getDisplayMedia' in navigator.mediaDevices);
}
