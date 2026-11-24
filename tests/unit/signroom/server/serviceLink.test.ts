// @vitest-environment node
// An invoice can be made for a client service (the lead's Accounts tab). It
// remembers the service and the month it bills, so that a payment recorded on
// it is written on the service too (the database does that, migration 210).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { billingAction } from "../../../../api/_signroom/billing";
import { SERVICE_NOT_FOUND } from "../../../../api/_signroom/crmLinks";
import { SERVICE_LINK_MISSING_MESSAGE, setupSentence } from "../../../../api/_signroom/setupMessages";
import type { Invoice } from "../../../../api/_signroom/shared/types";
import { companyClient, seededStore, WS } from "./helpers";

const owner = { id: "u1", email: "owner@example.com", workspaceId: WS };
const ACCOUNT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ELSEWHERE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

async function setUp() {
  const store = seededStore(owner) as ReturnType<typeof seededStore> & { seedAccount(a: { id: string; workspaceId: string }): void };
  store.seedAccount({ id: ACCOUNT, workspaceId: WS });
  store.seedAccount({ id: ELSEWHERE, workspaceId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" });
  const client = await companyClient(store, owner);
  const create = (body: Record<string, unknown>) => billingAction(store, owner, "POST", undefined, undefined, { clientId: client.id, ...body }) as Promise<Invoice>;
  return { store, client, create };
}

describe("an invoice made for a client service", () => {
  it("remembers the service and the month it bills", async () => {
    const { store, create } = await setUp();
    const invoice = await create({ accountId: ACCOUNT, billingMonth: "2026-11" });
    expect(invoice).toMatchObject({ status: "Draft", accountId: ACCOUNT, billingMonth: "2026-11" });
    // It is still there when the invoice is read again.
    const again = (await billingAction(store, owner, "GET", invoice.id, undefined, {})) as Invoice;
    expect(again).toMatchObject({ accountId: ACCOUNT, billingMonth: "2026-11" });
  });

  it("keeps the service without a month when the month is missing or not a month", async () => {
    const { create } = await setUp();
    expect(await create({ accountId: ACCOUNT })).toMatchObject({ accountId: ACCOUNT, billingMonth: null });
    expect(await create({ accountId: ACCOUNT, billingMonth: "November" })).toMatchObject({ accountId: ACCOUNT, billingMonth: null });
  });

  it("is an ordinary invoice when no service is named", async () => {
    const { create } = await setUp();
    const invoice = await create({});
    expect(invoice.accountId ?? null).toBeNull();
  });

  it("refuses a service of another workspace, an unknown one and a malformed id alike, and uses no number up", async () => {
    const { store, create } = await setUp();
    for (const bad of [ELSEWHERE, "dddddddd-dddd-4ddd-8ddd-dddddddddddd", "1 or 1=1"]) {
      await expect(create({ accountId: bad })).rejects.toMatchObject({ message: SERVICE_NOT_FOUND, status: 404 });
    }
    const first = await create({ accountId: ACCOUNT });
    const second = await create({});
    // The refused tries took no invoice number: these two follow one another.
    const n = (invoice: Invoice) => Number(invoice.number.replace(/\D/g, "").slice(-4));
    expect(n(second) - n(first)).toBe(1);
    expect((await store.listInvoices(WS)).length).toBe(2);
  });
});

describe("a database that cannot keep the tie yet", () => {
  it("is told to run the SQL, in the sentence for the people who run the site", () => {
    expect(setupSentence("Could not find the 'crm_account_id' column of 'sr_invoices' in the schema cache")).toBe(SERVICE_LINK_MISSING_MESSAGE);
    expect(setupSentence("column sr_invoices.crm_account_id does not exist")).toBe(SERVICE_LINK_MISSING_MESSAGE);
    expect(SERVICE_LINK_MISSING_MESSAGE).toContain("supabase/crm_setup.sql");
    // Other missing pieces keep their own sentences.
    expect(setupSentence("relation \"public.sr_projects\" does not exist")).not.toBe(SERVICE_LINK_MISSING_MESSAGE);
  });
});

describe("the database's part (210)", () => {
  const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/210_crm_accounts_collections.sql"), "utf8");

  it("writes a payment of such an invoice on the service, once, and can never stop the payment", () => {
    expect(sql).toContain("after insert on public.sr_payments");
    expect(sql).toContain("source_payment_id");
    expect(sql).toMatch(/create unique index if not exists crm_account_payments_source_idx/);
    expect(sql).toContain("on conflict do nothing");
    expect(sql).toMatch(/exception when others then\s+-- Writing it on the service must never be the reason a payment is not recorded\.\s+null;/);
  });

  it("is safe to run more than once, and does nothing where a table is missing", () => {
    expect(sql).toContain("Safe to run more than once.");
    expect(sql).toContain("add column if not exists");
    expect(sql).toMatch(/to_regclass\('public\.sr_invoices'\) is null/);
  });
});
