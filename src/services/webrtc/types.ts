import type { CallPeerSnapshot } from '@/services/livekit/LiveKitCallService';

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

export interface CallContext {
  type: 'project' | 'dm';
  /** projectId for project calls, recipientUserId for DM calls. */
  targetId: string;
  /** Human-readable label for the call UI header. */
  label: string;
}

/**
 * Single source of truth for the call UI. Calls now run over a LiveKit
 * room (SFU): every roster, mute and track update flows in as a fresh
 * `participants` snapshot from the LiveKit Room. The other top-level
 * fields are derived shortcuts for the local participant so the existing
 * CallControls + ringing screens don't have to dig through the array.
 */
export interface CallState {
  status: CallStatus;
  /** Stable id assigned by the caller in the ring inbox; survives across reconnects. */
  callId: string | null;
  direction: CallDirection | null;
  mediaType: CallMediaType;
  /** LiveKit room name once we've started joining; null while still ringing. */
  roomName: string | null;
  /**
   * Local + remote participant snapshots from LiveKit. Empty list while
   * pre-connect; once connected, the local user's snapshot is always
   * present (with `isLocal: true`).
   */
  participants: CallPeerSnapshot[];
  localParticipant: CallParticipant | null;
  /**
   * For 1:1 (DM) calls, the other side's CallParticipant. For multi-party
   * project calls while ringing, a placeholder showing the project label;
   * once someone picks up, the answerer's CallParticipant. Used by the
   * outgoing-ring screen + minimised tile to show "who am I calling".
   */
  remoteParticipant: CallParticipant | null;
  /**
   * For project-wide "ring all" calls, every teammate the caller dialed
   * at once. Empty for DM. Drives "Ringing 3 of 5…" style copy in the
   * outgoing ring screen.
   */
  remoteParticipants: CallParticipant[];
  /** Project or DM context so we know which inbox/room to use. */
  context: CallContext | null;
  /** Local mic/camera state — derived from the local snapshot, mirrored at top level for CallControls. */
  isMuted: boolean;
  isCameraOff: boolean;
  isScreenSharing: boolean;
  videoEffect: CallVideoEffect;
  isApplyingEffect: boolean;
  error: string | null;
}

// ── Ring inbox messages ─────────────────────────────────────
//
// LiveKit handles all media + signaling, so the only thing we still send
// peer-to-peer over Supabase Realtime is the ring inbox: "join this room"
// and "stop ringing, someone else got it / I cancelled". No SDP/ICE here.

/**
 * Dial broadcast — the caller sends one of these to each teammate's
 * `call-inbox:<userId>` channel. The callee shows the incoming-call modal
 * and joins the LiveKit room when they accept.
 */
export interface RingOffer {
  type: 'ring';
  callId: string;
  /** LiveKit room to join on accept (e.g. `project:<id>` or `dm:<a>__<b>`). */
  roomName: string;
  mediaType: CallMediaType;
  context: CallContext;
  from: CallParticipant;
  /**
   * Caller dialed multiple teammates at once. Callees use this to reject
   * locally without broadcasting a message that would yank the ring from
   * everyone else still deciding.
   */
  isMultiParty: boolean;
}

/**
 * Cancel broadcast — sent on a teammate's inbox when the caller bailed
 * before anyone picked up, or to remaining ringers once someone else
 * accepted. Stops their ring instead of letting the 30s timeout do it.
 */
export interface RingCancel {
  type: 'ring-cancel';
  callId: string;
  from: CallParticipant;
  /** `taken` = someone in the ring-all already accepted; `cancelled` = caller bailed. */
  reason: 'cancelled' | 'taken';
}

export type RingMessage = RingOffer | RingCancel;

// ── Initial state ───────────────────────────────────────────

export const INITIAL_CALL_STATE: CallState = {
  status: 'idle',
  callId: null,
  direction: null,
  mediaType: 'audio',
  roomName: null,
  participants: [],
  localParticipant: null,
  remoteParticipant: null,
  remoteParticipants: [],
  context: null,
  isMuted: false,
  isCameraOff: false,
  isScreenSharing: false,
  videoEffect: 'none',
  isApplyingEffect: false,
  error: null,
};
