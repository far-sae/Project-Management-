import type { MailDeps } from "./mail.js";
import type { Workspace } from "./shared/types.js";
import { peek as realPeek, refuseVerdict, spend as realSpend, workspaceLimitKey } from "./host/rateLimit.js";

/**
 * How much email one workspace may send, whichever way it goes out (the
 * platform's address, the workspace's own SMTP mailbox, or its Google or
 * Microsoft connection). Kept in sr_attempts under the workspace's key.
 */
export const MAIL_TOOL = "signroom-mail";
export const MAIL_MINUTE_LIMIT = 20;
export const MAIL_DAY_LIMIT = 300;
/** A workspace that first used Signroom under this many days ago may send only MAIL_NEW_DAY_LIMIT a day. */
export const MAIL_NEW_DAYS = 7;
export const MAIL_NEW_DAY_LIMIT = 100;

/** Created under 7 days ago, or of unknown age (so the stricter limit applies). */
function isNewWorkspace(created: string | undefined, now: Date): boolean {
  const t = created ? Date.parse(created) : NaN;
  return !Number.isFinite(t) || now.getTime() - t < MAIL_NEW_DAYS * 86_400_000;
}

/** Peek the day, then spend the minute; a refusal sends nothing. */
export async function refuseSendLimits(d: MailDeps, ws: Workspace): Promise<void> {
  const key = workspaceLimitKey(ws.id);
  const fresh = isNewWorkspace(ws.created, d.now ? d.now() : new Date());
  const dayLimit = fresh ? MAIL_NEW_DAY_LIMIT : MAIL_DAY_LIMIT;
  refuseVerdict(
    await (d.peek ?? realPeek)(d.sb, MAIL_TOOL, key, dayLimit, 24 * 60),
    () =>
      fresh
        ? `New workspaces can send ${MAIL_NEW_DAY_LIMIT} emails a day for their first week. Try again tomorrow.`
        : `You can send up to ${MAIL_DAY_LIMIT} emails a day. Try again tomorrow.`,
  );
  refuseVerdict(
    await (d.spend ?? realSpend)(d.sb, MAIL_TOOL, key, MAIL_MINUTE_LIMIT, 1),
    () => `You can send up to ${MAIL_MINUTE_LIMIT} emails a minute. Try again in a minute.`,
  );
}
