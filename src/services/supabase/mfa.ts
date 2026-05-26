import {
  generateSecret as totpGenerateSecret,
  generateURI as totpGenerateURI,
  verifySync as totpVerifySync,
} from "otplib";
import QRCode from "qrcode";
import { supabase } from "./config";
import { logger } from "@/lib/logger";

export interface MfaStatus {
  enabled: boolean;
  enrolledAt: Date | null;
  lastVerifiedAt: Date | null;
}

export interface EnrolmentDraft {
  secret: string;     // base32, shown to the user once during enrol
  otpauthUrl: string; // for QR code
  qrDataUrl: string;  // PNG data: url, ready to drop into <img src>
  recoveryCodes: string[];
}

const ISSUER = "TaskCalendar";

const randomRecoveryCodes = (count = 10): string[] => {
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const buf = new Uint8Array(8);
    crypto.getRandomValues(buf);
    const hex = Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
    out.push(`${hex.slice(0, 4)}-${hex.slice(4, 8)}-${hex.slice(8, 16)}`);
  }
  return out;
};

const sha256 = async (input: string): Promise<string> => {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
};

/**
 * Build an enrolment draft. Caller shows the QR code, the user scans it
 * with Google Authenticator / 1Password / Authy, then confirms by typing
 * a current TOTP — at which point the secret is persisted via confirmEnrol.
 */
export const startEnrolment = async (
  accountLabel: string,
): Promise<EnrolmentDraft> => {
  const secretResult = await totpGenerateSecret();
  const secret = String(secretResult);
  const uriResult = await totpGenerateURI({
    secret,
    label: accountLabel,
    issuer: ISSUER,
  });
  const otpauthUrl = String(uriResult);
  const qrDataUrl = await QRCode.toDataURL(otpauthUrl, { margin: 1, width: 240 });
  const recoveryCodes = randomRecoveryCodes();
  return { secret, otpauthUrl, qrDataUrl, recoveryCodes };
};

/** Verify a TOTP code against a base32 secret. */
export const verifyTotp = (secret: string, code: string): boolean => {
  try {
    const res = totpVerifySync({ secret, token: code.trim() });
    return Boolean((res as { isValid?: boolean })?.isValid ?? res);
  } catch {
    return false;
  }
};

export const confirmEnrolment = async (
  userId: string,
  draft: EnrolmentDraft,
  code: string,
): Promise<void> => {
  if (!verifyTotp(draft.secret, code)) {
    throw new Error("Code didn't match. Try the latest code from your authenticator app.");
  }
  const hashed = await Promise.all(draft.recoveryCodes.map(sha256));
  const { error } = await supabase
    .from("user_mfa")
    .upsert({
      user_id: userId,
      mfa_enabled: true,
      totp_secret_enc: draft.secret, // base32; RLS limits to self
      totp_secret_iv: null,
      recovery_codes_enc: JSON.stringify(hashed),
      enrolled_at: new Date().toISOString(),
      last_verified_at: new Date().toISOString(),
    });
  if (error) {
    logger.error("MFA enrol failed:", error);
    throw error;
  }
};

export const fetchMfaStatus = async (userId: string): Promise<MfaStatus> => {
  const { data, error } = await supabase
    .from("user_mfa")
    .select("mfa_enabled, enrolled_at, last_verified_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    logger.error("failed to fetch MFA status:", error);
    return { enabled: false, enrolledAt: null, lastVerifiedAt: null };
  }
  if (!data) return { enabled: false, enrolledAt: null, lastVerifiedAt: null };
  return {
    enabled: Boolean(data.mfa_enabled),
    enrolledAt: data.enrolled_at ? new Date(data.enrolled_at) : null,
    lastVerifiedAt: data.last_verified_at ? new Date(data.last_verified_at) : null,
  };
};

/** Returns true if the supplied code matches the stored secret (or a
 *  recovery code). On match, the recovery code is invalidated. */
export const verifyForUser = async (
  userId: string,
  code: string,
): Promise<boolean> => {
  const { data } = await supabase
    .from("user_mfa")
    .select("totp_secret_enc, recovery_codes_enc")
    .eq("user_id", userId)
    .maybeSingle();
  if (!data?.totp_secret_enc) return false;

  // TOTP path
  if (verifyTotp(data.totp_secret_enc as string, code)) {
    await supabase
      .from("user_mfa")
      .update({ last_verified_at: new Date().toISOString() })
      .eq("user_id", userId);
    return true;
  }

  // Recovery-code path — consume on use.
  try {
    const codes = JSON.parse((data.recovery_codes_enc as string) ?? "[]") as string[];
    const hashed = await sha256(code.trim());
    const idx = codes.indexOf(hashed);
    if (idx === -1) return false;
    codes.splice(idx, 1);
    await supabase
      .from("user_mfa")
      .update({
        recovery_codes_enc: JSON.stringify(codes),
        last_verified_at: new Date().toISOString(),
      })
      .eq("user_id", userId);
    return true;
  } catch {
    return false;
  }
};

export const disableMfa = async (userId: string): Promise<void> => {
  const { error } = await supabase
    .from("user_mfa")
    .update({
      mfa_enabled: false,
      totp_secret_enc: null,
      recovery_codes_enc: null,
    })
    .eq("user_id", userId);
  if (error) throw error;
};
