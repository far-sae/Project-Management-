import type { MailDeps } from "../_signroom/mail.js";
import type { AutoClaude } from "./ai.js";
import type { AutoStore } from "./store.js";

/**
 * Everything the automation server needs from outside, in one object, so a
 * test can hand it a store in memory, a fake Claude and a fixed clock.
 */
export type AutoDeps = {
  store: AutoStore;
  /** The documents server's mail deps: agents' emails go out through its sendMail, with its limits and delivery log. Null when email cannot be sent at all. */
  mail: MailDeps | null;
  /** Null when ANTHROPIC_API_KEY is not set: everything that needs the AI then says so. */
  claude: AutoClaude | null;
  /**
   * The address a lead opens to stop all email from the organisation, or null
   * when one cannot be made (the unsubscribe secret or the site address is not
   * set). An agent's email then asks the lead to reply instead.
   */
  unsubscribeUrl?: (contactId: string) => Promise<string | null>;
  now?: () => Date;
  /** Keeps the function alive for work that goes on after the reply (Vercel's waitUntil when omitted). */
  keepAlive?: (work: Promise<unknown>) => void;
};

export const nowOf = (deps: Pick<AutoDeps, "now">): Date => (deps.now ? deps.now() : new Date());
