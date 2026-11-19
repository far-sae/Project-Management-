/**
 * Shared set-up for the documents-server tests: a TaskCalendar workspace inside
 * an organisation, as the server sees it through the fake store.
 */
import { randomUUID } from "node:crypto";
import { clientFromCompany } from "../../../../api/_signroom/clients";
import type { SignedInUser } from "../../../../api/_signroom/context";
import { fakeStore } from "../../../../api/_signroom/fakeStore";
import type { Client } from "../../../../api/_signroom/shared/types";
import type { Store } from "../../../../api/_signroom/store";

export type FakeStore = ReturnType<typeof fakeStore>;

/** TaskCalendar workspace ids (the X-Signroom-Workspace header) and their organisations. */
export const WS = "0a000000-0000-4000-8000-000000000001";
export const WS2 = "0a000000-0000-4000-8000-000000000002";
export const ORG = "0b000000-0000-4000-8000-000000000001";
export const ORG2 = "0b000000-0000-4000-8000-000000000002";

/** The account most tests act as: an admin of ORG, working in WS. */
export const OWNER: SignedInUser = { id: "u1", email: "owner@example.com", workspaceId: WS };

/** A fake store with WS (in ORG) and `owner` as an organisation admin. */
export function seededStore(owner: { id: string } = OWNER, name = "Acme Studio"): FakeStore {
  const store = fakeStore();
  store.seedWorkspace({ id: WS, organizationId: ORG, name });
  store.setOrgMember(WS, owner.id, "admin");
  return store;
}

/** `user` acting in `workspaceId` (WS by default). */
export const inWorkspace = <U extends { id: string; email: string }>(user: U, workspaceId = WS): U & { workspaceId: string } => ({ ...user, workspaceId });

/** The same store, where `userId` is a member (not an admin) of the workspace's organisation: a Signroom Member. */
export function withMemberRole<S>(store: S, userId: string, workspaceId = WS): S {
  (store as unknown as FakeStore).addMember(workspaceId, userId, "Member");
  return store;
}

/** A client made the only way there is: from a CRM company seeded in the user's workspace (no contacts, so the company email is used). */
export async function companyClient(store: Store, user: SignedInUser, name = "Bloom & Co.", email = "pay@bloom.co"): Promise<Client> {
  const companyId = randomUUID();
  (store as FakeStore).seedCompany({ id: companyId, workspaceId: user.workspaceId ?? WS, name, email });
  return clientFromCompany(store, user, { companyId });
}
