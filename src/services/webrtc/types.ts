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
  /**
   * For project-wide "ring all" calls, every teammate the caller dialed at
   * once. While ringing, `remoteParticipant` holds a placeholder (project
   * label) and this list shows who's being rung. Once someone answers,
   * `remoteParticipant` is updated to the actual answerer.
   */
  remoteParticipants: CallParticipant[];
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
  /**
   * Caller dialed multiple teammates at once ("ring all" project call). Tells
   * the callee to reject locally without broadcasting on the call channel —
   * one teammate's reject must not end the call for the others still ringing.
   */
  isMultiParty?: boolean;
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

/**
 * Sent by the caller to a teammate's inbox when another teammate has already
 * picked up a "ring all" project call. The remaining inboxes stop ringing on
 * receipt instead of timing out 30 s later.
 */
export interface SignalCancel {
  type: 'cancel';
  callId: string;
  from: CallParticipant;
}

export type SignalMessage =
  | SignalOffer
  | SignalAnswer
  | SignalIceCandidate
  | SignalHangup
  | SignalReject
  | SignalCancel;

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
  remoteParticipants: [],
  context: null,
  error: null,
};
