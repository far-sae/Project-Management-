import AccessToken from "twilio/lib/jwt/AccessToken";
import type { VoiceConfig } from "./config.js";

/**
 * The short-lived pass a browser places one call with. It can only start a
 * call through our own TwiML app (which asks this server what to ring), it
 * cannot receive calls, and it stops working after ten minutes; a call already
 * in progress is not cut off when it runs out.
 */
export const TOKEN_SECONDS = 600;

/** A person's id as the provider accepts it: letters, digits and underscores only. */
export const identityOf = (userId: string): string => "u_" + userId.replace(/[^A-Za-z0-9]/g, "_");

/** The `From` of a call placed from a browser is "client:<identity>". */
export const isIdentity = (from: unknown, userId: string): boolean => from === "client:" + identityOf(userId);

export function callToken(config: VoiceConfig, userId: string): string {
  const token = new AccessToken(config.accountSid, config.apiKeySid, config.apiKeySecret, { identity: identityOf(userId), ttl: TOKEN_SECONDS });
  token.addGrant(new AccessToken.VoiceGrant({ outgoingApplicationSid: config.appSid, incomingAllow: false }));
  return token.toJwt();
}
