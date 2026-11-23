/**
 * Connecting a social account by logging in at the platform. Shared by the
 * server and the browser, so both name the same platforms and outcomes.
 *
 * "meta" is one log-in at Facebook that brings the Facebook Pages and the
 * Instagram accounts on them.
 */
export const CONNECT_KINDS = ["youtube", "meta", "x", "tiktok", "linkedin"] as const;
export type DirectKind = (typeof CONNECT_KINDS)[number];

/**
 * What can be connected through the posting service (see service.ts), in the
 * order shown. There Facebook and Instagram are two log-ins of their own.
 */
export const SERVICE_KINDS = ["youtube", "facebook", "instagram", "x", "tiktok", "linkedin"] as const;
export type ServiceKind = (typeof SERVICE_KINDS)[number];

export type ConnectKind = DirectKind | ServiceKind;

export const isConnectKind = (value: unknown): value is DirectKind =>
  typeof value === "string" && (CONNECT_KINDS as readonly string[]).includes(value);
export const isServiceKind = (value: unknown): value is ServiceKind =>
  typeof value === "string" && (SERVICE_KINDS as readonly string[]).includes(value);

export const CONNECT_NAME: Record<ConnectKind, string> = {
  youtube: "YouTube",
  meta: "Facebook and Instagram",
  facebook: "Facebook",
  instagram: "Instagram",
  x: "X",
  tiktok: "TikTok",
  linkedin: "LinkedIn",
};

/** The settings each platform needs on the server. Only the people who set the site up read these names. */
export const CONNECT_SETTINGS: Record<DirectKind, string[]> = {
  youtube: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
  meta: ["META_APP_ID", "META_APP_SECRET"],
  x: ["X_CLIENT_ID", "X_CLIENT_SECRET"],
  tiktok: ["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET"],
  linkedin: ["LINKEDIN_CLIENT_ID", "LINKEDIN_CLIENT_SECRET"],
};

/**
 * Which platforms can be connected here, the settings each one still misses
 * (empty when it is ready), and the address every platform must be told to
 * send people back to.
 */
export type ConnectSetup = {
  /** "service": through the posting service. "direct": through our own app at each platform. */
  via: "service" | "direct";
  /** What can be connected, in the order shown. */
  kinds: ConnectKind[];
  ready: Partial<Record<ConnectKind, boolean>>;
  needs: Partial<Record<ConnectKind, string[]>>;
  /** Direct: the return address every platform must be given. Service: the address its project must send people back to. */
  callback: string | null;
};

/**
 * How a log-in ended. It comes back to the Social page in the address:
 *   done       accounts were connected
 *   cancelled  the person pressed Cancel at the platform
 *   expired    it took too long, or was not started in this browser
 *   none       the log-in has nothing to post to (no Page, no channel)
 *   failed     anything else
 */
export const CONNECT_OUTCOMES = ["done", "cancelled", "expired", "none", "failed"] as const;
export type ConnectOutcome = (typeof CONNECT_OUTCOMES)[number];
