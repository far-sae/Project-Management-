import type { SupabaseClient } from "@supabase/supabase-js";
import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import { decryptSecret } from "../_lib/crypto";
import { buildTestEmail } from "../_lib/testEmail";
import type { TestSend } from "./tools.js";

/**
 * One test email, sent straight away from a mailbox of the Email area, the
 * same way the Email page's own "send a test" does it. Who it goes to is
 * decided by the caller (tools.ts: always the person's own address).
 * True when the mail server took it; false for anything else.
 */
export function testSender(sb: SupabaseClient, serverKey: string): (t: TestSend) => Promise<boolean> {
  return async (t) => {
    let transport: Transporter | null = null;
    try {
      const { data: account } = await sb.from("email_accounts").select("from_name, from_email, smtp_host, smtp_port, smtp_secure, smtp_username").eq("id", t.mailboxId).maybeSingle();
      const { data: secret } = await sb.from("email_account_secrets").select("secret_encrypted").eq("account_id", t.mailboxId).maybeSingle();
      if (!account || !secret) return false;
      const password = await decryptSecret(String(secret.secret_encrypted), serverKey);
      transport = nodemailer.createTransport({ host: account.smtp_host, port: account.smtp_port, secure: account.smtp_secure, auth: { user: account.smtp_username, pass: password } });
      await transport.sendMail({
        // Objects, not name-and-address strings: a name holding a quote must not become a second address.
        from: { name: String(account.from_name ?? ""), address: String(account.from_email) },
        to: { name: "", address: t.to },
        ...buildTestEmail({ subject: t.subject, bodyHtml: t.bodyHtml, mergeData: t.mergeData }),
      });
      return true;
    } catch (e) {
      // The name only: a mail server's words can hold an address or a hint of a password.
      console.error("[mcp] test send failed", e instanceof Error ? e.name : "unknown");
      return false;
    } finally {
      try {
        transport?.close();
      } catch {
        /* a transport that never connected has nothing to close */
      }
    }
  };
}
