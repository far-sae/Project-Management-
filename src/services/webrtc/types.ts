export type CallDirection = 'outgoing' | 'incoming';
export type CallMediaType = 'audio' | 'video';
export type CallStatus =
  | 'idle'
  | 'ringing'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'ended';
/** Re-exported from BackgroundProcessor so consumers don't need a deeper import. */
export type CallVideoEffect = 'none' | 'blur';

export interface CallParticipant {
  userId: string;
  displayName: string;
  photoURL?: string;
}

export interface CallState {
  status: CallStatus;
  callId: string | null;
  direction: CallDirection | null;
  mediaType: CallMediaType;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  screenStream: MediaStream | null;
  isMuted: boolean;
  isCameraOff: boolean;
  isScreenSharing: boolean;
  /** Currently active visual effect on the local camera (Teams-style blur). */
  videoEffect: CallVideoEffect;
  /** True while the background-effect pipeline is loading MediaPipe assets. */
  isApplyingEffect: boolean;
  localParticipant: CallParticipant | null;
  remoteParticipant: CallParticipant | null;
  /** Project or DM context so we know which channel to signal on. */
  context: CallContext | null;
  error: string | null;
}

export interface CallContext {
  type: 'project' | 'dm';
  /** projectId for project calls, recipientUserId for DM calls */
  targetId: string;
  /** Human-readable label for the call UI header */
  label: string;
}

// ── Signaling messages ──────────────────────────────────────

export interface SignalOffer {
  type: 'offer';
  sdp: RTCSessionDescriptionInit;
  callId: string;
  from: CallParticipant;
  mediaType: CallMediaType;
  context: CallContext;
}

export interface SignalAnswer {
  type: 'answer';
  sdp: RTCSessionDescriptionInit;
  callId: string;
  from: CallParticipant;
}

export interface SignalIceCandidate {
  type: 'ice-candidate';
  candidate: RTCIceCandidateInit;
  callId: string;
}

export interface SignalHangup {
  type: 'hangup';
  callId: string;
  from: CallParticipant;
}

export interface SignalReject {
  type: 'reject';
  callId: string;
  from: CallParticipant;
}

export type SignalMessage =
  | SignalOffer
  | SignalAnswer
  | SignalIceCandidate
  | SignalHangup
  | SignalReject;

// ── Initial state ───────────────────────────────────────────

export const INITIAL_CALL_STATE: CallState = {
  status: 'idle',
  callId: null,
  direction: null,
  mediaType: 'audio',
  localStream: null,
  remoteStream: null,
  screenStream: null,
  isMuted: false,
  isCameraOff: false,
  isScreenSharing: false,
  videoEffect: 'none',
  isApplyingEffect: false,
  localParticipant: null,
  remoteParticipant: null,
  context: null,
  error: null,
};
