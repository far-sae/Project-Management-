// src/services/supabase/dupDetection.ts
import { supabase } from "./config";
import { logger } from "@/lib/logger";

export const normalizeEmail = (e: string | null | undefined): string | null => {
  if (!e) return null;
  const trimmed = e.trim().toLowerCase();
  if (!trimmed) return null;
  return trimmed.replace(/\+[^@]*(?=@)/, "");
};

const SUFFIX_RE = /\b(inc|llc|ltd|gmbh|s\.a\.|pty|co|corp|corporation)\b\.?/g;

export const normalizeCompanyName = (n: string | null | undefined): string | null => {
  if (!n) return null;
  const lowered = n.toLowerCase().replace(SUFFIX_RE, "").replace(/\s+/g, " ").trim();
  return lowered.length ? lowered : null;
};

const normalizePhone = (phone: string | null | undefined): string | null => {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 7 ? digits : null;
};

const normalizeDomain = (websiteOrEmail: string | null | undefined): string | null => {
  if (!websiteOrEmail) return null;
  const raw = websiteOrEmail.trim().toLowerCase();
  if (!raw) return null;
  const fromEmail = raw.includes("@") ? raw.split("@").pop() ?? "" : raw;
  const withoutProtocol = fromEmail.replace(/^https?:\/\//, "");
  const host = withoutProtocol.split(/[/?#]/)[0]?.replace(/^www\./, "") ?? "";
  return host.includes(".") ? host : null;
};

type MatchReason =
  | "Same email"
  | "Same website"
  | "Same phone"
  | "Same legal name"
  | "Same company + country"
  | "Similar company name"
  | "Same company + city/state";

export interface DuplicateMatch {
  clientId: string;
  name: string;
  email: string | null;
  website?: string | null;
  phone?: string | null;
  country?: string | null;
  city?: string | null;
  state?: string | null;
  matchedOn: "email" | "website" | "phone" | "legal_name" | "name_country" | "name";
  reasons: MatchReason[];
  score: number;
}

export const findDuplicates = async (
  organizationId: string,
  input: {
    name: string;
    legalName?: string | null;
    email?: string | null;
    website?: string | null;
    phone?: string | null;
    country?: string | null;
    city?: string | null;
    state?: string | null;
  },
): Promise<DuplicateMatch[]> => {
  const matches = new Map<string, DuplicateMatch>();
  const normEmail = normalizeEmail(input.email ?? null);
  const normWebsite = normalizeDomain(input.website ?? null);
  const normPhone = normalizePhone(input.phone ?? null);
  const normName = normalizeCompanyName(input.name);
  const normLegalName = normalizeCompanyName(input.legalName ?? null);
  const normCountry = (input.country ?? "").trim().toLowerCase();
  const normCity = (input.city ?? "").trim().toLowerCase();
  const normState = (input.state ?? "").trim().toLowerCase();

  const addMatch = (
    row: Record<string, string | null>,
    matchedOn: DuplicateMatch["matchedOn"],
    reason: MatchReason,
    score: number,
  ) => {
    const clientId = row.client_id;
    if (!clientId) return;
    const existing = matches.get(clientId);
    if (existing) {
      if (!existing.reasons.includes(reason)) existing.reasons.push(reason);
      if (score > existing.score) {
        existing.score = score;
        existing.matchedOn = matchedOn;
      }
      return;
    }
    matches.set(clientId, {
      clientId,
      name: row.name ?? "Untitled client",
      email: row.email ?? null,
      website: row.website ?? null,
      phone: row.phone ?? null,
      country: row.country ?? null,
      city: row.city ?? null,
      state: row.state ?? null,
      matchedOn,
      reasons: [reason],
      score,
    });
  };

  const { data, error } = await supabase
    .from("clients")
    .select("client_id, name, legal_name, email, website, phone, country, city, state")
    .eq("organization_id", organizationId)
    .limit(2000);

  if (error) {
    logger.warn("Duplicate detection failed:", error);
    return [];
  }

  for (const row of (data ?? []) as Record<string, string | null>[]) {
    const rowName = normalizeCompanyName(row.name);
    const rowLegalName = normalizeCompanyName(row.legal_name);
    const rowEmail = normalizeEmail(row.email);
    const rowWebsite = normalizeDomain(row.website);
    const rowEmailDomain = normalizeDomain(row.email);
    const rowPhone = normalizePhone(row.phone);
    const rowCountry = (row.country ?? "").trim().toLowerCase();
    const rowCity = (row.city ?? "").trim().toLowerCase();
    const rowState = (row.state ?? "").trim().toLowerCase();

    if (normEmail && rowEmail === normEmail) {
      addMatch(row, "email", "Same email", 100);
    }
    if (normWebsite && (rowWebsite === normWebsite || rowEmailDomain === normWebsite)) {
      addMatch(row, "website", "Same website", 95);
    }
    if (normPhone && rowPhone === normPhone) {
      addMatch(row, "phone", "Same phone", 90);
    }
    if (
      normLegalName &&
      (rowLegalName === normLegalName || rowName === normLegalName)
    ) {
      addMatch(row, "legal_name", "Same legal name", 88);
    }
    if (normName && (rowName === normName || rowLegalName === normName)) {
      if (normCountry && rowCountry === normCountry) {
        addMatch(row, "name_country", "Same company + country", 82);
      } else if (
        normCity &&
        rowCity === normCity &&
        (!normState || !rowState || rowState === normState)
      ) {
        addMatch(row, "name_country", "Same company + city/state", 78);
      } else {
        addMatch(row, "name", "Similar company name", 70);
      }
    }
  }

  return Array.from(matches.values()).sort(
    (a, b) => b.score - a.score || a.name.localeCompare(b.name),
  );
};

export const recordOverride = async (
  organizationId: string,
  clientId: string,
  matchedExistingId: string,
  reason: string | null,
): Promise<void> => {
  const { error } = await supabase.from("client_dup_overrides").insert({
    organization_id: organizationId,
    client_id: clientId,
    matched_existing_id: matchedExistingId,
    overridden_by: (await supabase.auth.getUser()).data.user?.id ?? null,
    reason,
  });
  if (error) logger.warn("Failed to record dup override:", error);
};
