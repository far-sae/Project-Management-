// src/services/supabase/email.ts — the parts that decide what reaches the
// database, and what is read back out of it.
//
// The Supabase client is mocked, as it is in emailRecipients.test.ts: these
// tests are about the payload and the validation in front of it, not about
// PostgREST.

import { describe, it, expect, vi, beforeEach } from "vitest";

const { fromMock, upserts, inserts } = vi.hoisted(() => ({
  fromMock: vi.fn(),
  upserts: [] as Record<string, unknown>[],
  inserts: [] as Record<string, unknown>[],
}));

vi.mock("@/services/supabase/config", () => ({
  supabase: { from: fromMock },
}));

import {
  saveEmailSettings,
  createCampaign,
  mapMailboxStatusRow,
} from "@/services/supabase/email";
import { MAX_JITTER_MS } from "@/lib/email/sendWindow";
import type { EmailSettings } from "@/lib/email/types";

const settings = (over: Partial<EmailSettings> = {}): EmailSettings => ({
  organizationId: "org-1",
  window: {
    enabled: true,
    startHour: 8,
    endHour: 18,
    days: [1, 2, 3, 4, 5],
    timezone: "Europe/London",
    ...(over.window ?? {}),
  },
  jitterMinMs: 8000,
  jitterMaxMs: 25000,
  ...over,
});

beforeEach(() => {
  upserts.length = 0;
  inserts.length = 0;
  fromMock.mockReset();
  fromMock.mockImplementation((table: string) => {
    if (table === "email_settings") {
      return {
        upsert: (row: Record<string, unknown>) => {
          upserts.push(row);
          return Promise.resolve({ error: null });
        },
      };
    }
    if (table === "email_campaigns") {
      const builder = {
        insert: (row: Record<string, unknown>) => {
          inserts.push(row);
          return builder;
        },
        select: () => builder,
        single: () =>
          Promise.resolve({
            data: {
              id: "camp-1",
              organization_id: "org-1",
              workspace_id: null,
              created_by: null,
              account_id: null,
              kind: "bulk",
              name: "n",
              subject: "s",
              body_html: "<p>b</p>",
              status: "draft",
              scheduled_at: null,
              queued_count: 0,
              sent_count: 0,
              failed_count: 0,
              suppressed_count: 0,
              created_at: "2026-09-18T00:00:00Z",
            },
            error: null,
          }),
      };
      return builder;
    }
    throw new Error(`Unexpected table in test: ${table}`);
  });
});

describe("saveEmailSettings", () => {
  it("writes a valid row", async () => {
    await saveEmailSettings("org-1", settings());
    expect(upserts).toHaveLength(1);
    expect(upserts[0]).toMatchObject({
      organization_id: "org-1",
      send_window_start: 8,
      send_window_end: 18,
      send_days: [1, 2, 3, 4, 5],
      send_timezone: "Europe/London",
    });
  });

  it("refuses an empty day list rather than silently stopping all sending", async () => {
    // An empty array satisfies the column, and then isWithinSendWindow()
    // matches no day of the week: the organization stops sending with a
    // screen that looks saved and nothing anywhere saying why.
    await expect(saveEmailSettings("org-1", settings({ window: { ...settings().window, days: [] } })))
      .rejects.toThrow(/at least one day/i);
    expect(upserts).toHaveLength(0);
  });

  it("refuses a pause longer than the ceiling the database also enforces", async () => {
    await expect(
      saveEmailSettings("org-1", settings({ jitterMaxMs: MAX_JITTER_MS + 1000 })),
    ).rejects.toThrow(new RegExp(String(MAX_JITTER_MS / 1000)));
    expect(upserts).toHaveLength(0);
  });

  it("still refuses a window and a jitter range that are out of order", async () => {
    await expect(
      saveEmailSettings("org-1", settings({ window: { ...settings().window, startHour: 18, endHour: 8 } })),
    ).rejects.toThrow(/before the end hour/i);
    await expect(
      saveEmailSettings("org-1", settings({ jitterMinMs: 20000, jitterMaxMs: 10000 })),
    ).rejects.toThrow(/not be greater/i);
    expect(upserts).toHaveLength(0);
  });
});

describe("createCampaign", () => {
  const base = {
    organizationId: "org-1",
    workspaceId: null,
    createdBy: null,
    kind: "bulk" as const,
    name: "September",
    subject: "Hello",
    bodyHtml: "<p>Hi</p>",
  };

  it("writes a null account_id for a campaign that uses the whole pool", async () => {
    const campaign = await createCampaign({ ...base, accountId: null });
    expect(inserts[0].account_id).toBeNull();
    expect(campaign.accountId).toBeNull();
  });

  it("still pins a campaign to a named mailbox when one is chosen", async () => {
    await createCampaign({ ...base, accountId: "mbx-1" });
    expect(inserts[0].account_id).toBe("mbx-1");
  });

  it("never writes rate_per_hour, because nothing honours it", async () => {
    // Migration 156 removed the claim's hourly arithmetic and the worker has
    // no hourly logic, so a value here is pacing the product collects and
    // never applies.
    await createCampaign({ ...base, accountId: null });
    expect(Object.keys(inserts[0])).not.toContain("rate_per_hour");
  });
});

describe("mapMailboxStatusRow", () => {
  const row = {
    id: "mbx-1",
    organization_id: "org-1",
    label: "Ada",
    from_email: "ada@example.com",
    status: "active" as const,
    is_active: true,
    paused_reason: null,
    consecutive_failures: 0,
    last_sent_at: null,
    daily_limit: 40,
    warmup_enabled: true,
    warmup_started_on: "2026-09-18",
    warmup_start_volume: 5,
    warmup_increment: 3,
    effective_limit: 8,
    sent_today: 2,
  };

  it("reads warmup_started_on as the day the column names, in local time", () => {
    // `new Date('2026-09-18')` is UTC midnight, and every reader of this value
    // uses local getters — so west of UTC it reads as the 17th and the
    // mailbox card's "Warmup day N" is off by one.
    const started = mapMailboxStatusRow(row).warmupStartedOn as Date;
    expect(started.getFullYear()).toBe(2026);
    expect(started.getMonth()).toBe(8); // September
    expect(started.getDate()).toBe(18);
  });

  it("leaves a mailbox whose ramp has not started with no date at all", () => {
    expect(mapMailboxStatusRow({ ...row, warmup_started_on: null }).warmupStartedOn).toBeNull();
  });
});
