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

export interface DuplicateMatch {
  clientId: string;
  name: string;
  email: string | null;
  matchedOn: "email" | "name_country";
}

export const findDuplicates = async (
  organizationId: string,
  input: { name: string; email?: string | null; country?: string | null },
): Promise<DuplicateMatch[]> => {
  const out: DuplicateMatch[] = [];
  const normEmail = normalizeEmail(input.email ?? null);
  const normName = normalizeCompanyName(input.name);

  if (normEmail) {
    const { data } = await supabase
      .from("clients")
      .select("client_id, name, email")
      .eq("organization_id", organizationId)
      .filter("email", "ilike", normEmail.replace(/[%_]/g, "\\$&"));
    for (const row of data ?? []) {
      if (normalizeEmail((row as Record<string, string>).email) === normEmail) {
        out.push({
          clientId: (row as Record<string, string>).client_id,
          name: (row as Record<string, string>).name,
          email: (row as Record<string, string>).email,
          matchedOn: "email",
        });
      }
    }
  }

  if (normName) {
    const { data } = await supabase
      .from("clients")
      .select("client_id, name, email, country")
      .eq("organization_id", organizationId);
    for (const row of data ?? []) {
      const r = row as Record<string, string>;
      if (
        normalizeCompanyName(r.name) === normName &&
        (r.country ?? "") === (input.country ?? "")
      ) {
        if (!out.some((m) => m.clientId === r.client_id)) {
          out.push({
            clientId: r.client_id,
            name: r.name,
            email: r.email,
            matchedOn: "name_country",
          });
        }
      }
    }
  }

  return out;
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
