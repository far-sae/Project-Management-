import type { SupabaseClient } from "@supabase/supabase-js";
import { StoreError } from "../errors.js";
import type { MailboxPort, ProviderId, Security } from "./settings.js";

/**
 * Database access for a workspace's own SMTP mailbox (sr_mailboxes, one row
 * per workspace), always with the service role and always filtered by the
 * workspace id. A failed query throws StoreError: its text goes only to the
 * server log, or, when the table is not there yet, becomes the sentence that
 * names migration 186.
 *
 * The Supabase store (store.ts) exposes these four as getMailbox,
 * upsertMailbox, markMailbox and deleteMailbox; fakeStore.ts keeps the same
 * rows in memory.
 */
export const MAILBOX_TABLE = "sr_mailboxes";
const MAILBOX_COLUMNS = "workspace_id, provider, host, port, security, username, from_email, password_enc, verified_at, last_error";

/** One sr_mailboxes row, in the table's own column names. `password_enc` is v1 ciphertext bound to the workspace id. */
export type MailboxRow = {
  workspace_id: string;
  provider: ProviderId;
  host: string;
  port: MailboxPort;
  security: Security;
  username: string;
  from_email: string;
  password_enc: string;
  verified_at: string | null;
  last_error: string | null;
};

export async function loadMailbox(sb: SupabaseClient, workspaceId: string): Promise<MailboxRow | null> {
  const r = await sb.from(MAILBOX_TABLE).select(MAILBOX_COLUMNS).eq("workspace_id", workspaceId).maybeSingle();
  if (r.error) throw new StoreError(r.error.message);
  return (r.data as unknown as MailboxRow | null) ?? null;
}

/** Inserts or replaces the workspace's one row (workspace_id is the primary key). */
export async function upsertMailbox(sb: SupabaseClient, row: MailboxRow & { updated_at: string }): Promise<void> {
  const r = await sb.from(MAILBOX_TABLE).upsert(row, { onConflict: "workspace_id" });
  if (r.error) throw new StoreError(r.error.message);
}

/**
 * Records a login result on the row that was checked: verified now with no
 * error, or not verified with a plain sentence. Matches every setting of
 * `checked` (password_enc included, which every newly typed password changes: a
 * fresh IV per write), so a save, verify or disconnect that overlapped the
 * check is left alone. False when that row is no longer there as it was.
 */
export async function markMailbox(
  sb: SupabaseClient,
  checked: MailboxRow,
  patch: { verified_at: string | null; last_error: string | null },
): Promise<boolean> {
  const r = await sb.from(MAILBOX_TABLE).update(patch)
    .eq("workspace_id", checked.workspace_id).eq("provider", checked.provider).eq("host", checked.host).eq("port", checked.port)
    .eq("security", checked.security).eq("username", checked.username).eq("from_email", checked.from_email)
    .eq("password_enc", checked.password_enc)
    .select("workspace_id");
  if (r.error) throw new StoreError(r.error.message);
  return (r.data?.length ?? 0) > 0;
}

export async function deleteMailbox(sb: SupabaseClient, workspaceId: string): Promise<void> {
  const r = await sb.from(MAILBOX_TABLE).delete().eq("workspace_id", workspaceId);
  if (r.error) throw new StoreError(r.error.message);
}
