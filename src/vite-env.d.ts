/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_FIREBASE_API_KEY: string
  readonly VITE_FIREBASE_AUTH_DOMAIN: string
  readonly VITE_FIREBASE_PROJECT_ID: string
  readonly VITE_FIREBASE_STORAGE_BUCKET: string
  readonly VITE_FIREBASE_MESSAGING_SENDER_ID: string
  readonly VITE_FIREBASE_APP_ID: string
  readonly VITE_STRIPE_PUBLISHABLE_KEY: string
  /** Comma-separated Supabase user IDs for app/product owners (builders); they get full access everywhere. */
  readonly VITE_APP_OWNER_USER_IDS?: string
  /** Optional EmailJS keys for transactional emails (see services/email). */
  readonly VITE_EMAILJS_SERVICE_ID?: string
  readonly VITE_EMAILJS_PUBLIC_KEY?: string
  /** Template used for project invitations (sendInvitationEmail). */
  readonly VITE_EMAILJS_TEMPLATE_ID?: string
  /** Template used for in-app notification emails — assignments, due-soon, overdue, comments. Falls back to VITE_EMAILJS_TEMPLATE_ID. */
  readonly VITE_EMAILJS_NOTIFICATION_TEMPLATE_ID?: string
  /** Legacy fallback: dedicated assignment-only template. */
  readonly VITE_EMAILJS_TASK_ASSIGNED_TEMPLATE_ID?: string
  /** Set to "true" after migration 021 is deployed to use verify_task_lock_pin RPC; default is client-only PIN check (no RPC). */
  readonly VITE_VERIFY_TASK_LOCK_PIN_RPC?: string
  /** Comma-separated TURN URIs (e.g. turn:host:3478?transport=udp). With username + credential enables relay. */
  readonly VITE_WEBRTC_TURN_URLS?: string
  readonly VITE_WEBRTC_TURN_USERNAME?: string
  readonly VITE_WEBRTC_TURN_CREDENTIAL?: string
  /** Optional full RTCIceServer[] JSON; when valid, replaces default STUN+TURN env merge. */
  readonly VITE_WEBRTC_ICE_SERVERS_JSON?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
