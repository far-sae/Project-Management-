// supabase/functions/_shared/apollo.ts
// Apollo.io enrichment client with 30-day SHA-256-keyed cache.

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const APOLLO_API_KEY = Deno.env.get("APOLLO_API_KEY") ?? "";
const APOLLO_BASE = "https://api.apollo.io/v1";
const CACHE_TTL_DAYS = 30;

export const hashLookupKey = async (raw: string): Promise<string> => {
  const normalized = raw.trim().toLowerCase();
  const buf = new TextEncoder().encode(normalized);
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
};

export const isCacheFresh = (fetchedAt: string | null | undefined): boolean => {
  if (!fetchedAt) return false;
  const ageMs = Date.now() - new Date(fetchedAt).getTime();
  if (!Number.isFinite(ageMs) || ageMs < 0) return false;
  return ageMs < CACHE_TTL_DAYS * 24 * 60 * 60 * 1000;
};

export interface EnrichmentSnapshot {
  name?: string;
  title?: string;
  linkedinUrl?: string;
  organization?: {
    name?: string;
    employees?: number;
    industry?: string;
    description?: string;
    websiteUrl?: string;
    lastFundingAmount?: number;
  };
  location?: {
    city?: string;
    state?: string;
    country?: string;
  };
}

const mapPersonResponse = (j: Record<string, unknown>): EnrichmentSnapshot => {
  const person = (j.person ?? j) as Record<string, unknown>;
  const org = (person.organization ?? j.organization ?? {}) as Record<string, unknown>;
  return {
    name: person.name as string | undefined,
    title: person.title as string | undefined,
    linkedinUrl: person.linkedin_url as string | undefined,
    organization: {
      name: org.name as string | undefined,
      employees: org.estimated_num_employees as number | undefined,
      industry: org.industry as string | undefined,
      description: org.short_description as string | undefined,
      websiteUrl: org.website_url as string | undefined,
      lastFundingAmount: org.last_funding_round_amount as number | undefined,
    },
    location: {
      city: person.city as string | undefined,
      state: person.state as string | undefined,
      country: person.country as string | undefined,
    },
  };
};

const fetchFromApollo = async (
  email: string | null,
  domain: string | null,
): Promise<EnrichmentSnapshot | null> => {
  if (!APOLLO_API_KEY) return null;
  const endpoint = email
    ? `${APOLLO_BASE}/people/match`
    : `${APOLLO_BASE}/organizations/enrich`;
  const body = email ? { email } : { domain };

  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "X-Api-Key": APOLLO_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.status === 200) {
      return mapPersonResponse(await res.json());
    }
    if (res.status === 404) return null;
    if (res.status === 429) {
      const retry = Number(res.headers.get("retry-after") ?? "2");
      await new Promise((r) => setTimeout(r, Math.min(retry, 5) * 1000));
      continue;
    }
    if (res.status >= 500) {
      await new Promise((r) => setTimeout(r, 1000));
      continue;
    }
    return null; // 401 / 403 / other 4xx
  }
  return null;
};

export interface EnrichArgs {
  admin: SupabaseClient;
  email?: string | null;
  domain?: string | null;
}

export interface EnrichResult {
  snapshot: EnrichmentSnapshot | null;
  cacheHit: boolean;
}

export const enrich = async (a: EnrichArgs): Promise<EnrichResult> => {
  const lookupKey = a.email ?? a.domain ?? null;
  if (!lookupKey) return { snapshot: null, cacheHit: false };

  const hash = await hashLookupKey(lookupKey);
  const { data: cached } = await a.admin
    .from("apollo_lookups")
    .select("data, fetched_at")
    .eq("lookup_key_hash", hash)
    .maybeSingle();

  if (cached && isCacheFresh(cached.fetched_at as string)) {
    return {
      snapshot: cached.data as EnrichmentSnapshot | null,
      cacheHit: true,
    };
  }

  const snapshot = await fetchFromApollo(a.email ?? null, a.domain ?? null);

  await a.admin.from("apollo_lookups").upsert({
    lookup_key_hash: hash,
    lookup_key: lookupKey,
    data: snapshot,
    fetched_at: new Date().toISOString(),
  });

  return { snapshot, cacheHit: false };
};
