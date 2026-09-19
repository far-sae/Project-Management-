/**
 * The email sending worker.
 *
 * A persistent process that drains the outbox every few seconds: it picks the
 * sendable mailboxes out of each organisation's pool, claims a slice of the
 * queue for each, sends it with a jittered pause between messages, and settles
 * every row through record_send_result().
 *
 * It is the ONLY sender. The Vercel tick it replaces, and the per-minute cron
 * that poked it, are gone (migration 156): two senders claiming from the same
 * outbox is how a recipient gets the same message twice.
 *
 * It also runs a second, much slower loop that reads each mailbox that has an
 * IMAP host and records the replies and bounces it finds (migration 157). The
 * two loops share only the shutdown flag: an inbox that cannot be read must
 * never stop, slow or pause the sending, because at every provider reading a
 * mailbox and sending from it are separate permissions.
 *
 * Run it with `npm run worker` from the repository root — the only supported
 * invocation; this directory has no package.json of its own, since it shares
 * the packages and the src/lib/email helpers declared at the repository
 * root. Keep exactly one instance running in production.
 */

import { env, serviceClient } from './lib/db.js';
import { domainAcceptsMail } from './lib/dns.js';
import { runCycle } from './lib/engine.js';
import { fetchBounceSources, fetchRecentEnvelopes } from './lib/imap.js';
import { runInboxCycle } from './lib/inboxCycle.js';
import { createTransport } from './lib/mailer.js';

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const stamp = (): string => new Date().toISOString().replace('T', ' ').slice(0, 19);

/** How long the inbox loop holds off after start-up. See inboxLoop for why. */
const INBOX_START_DELAY_MS = 10_000;

/**
 * Sleeps in short slices so a shutdown signal is never held for a whole
 * interval. The inbox loop waits five minutes between passes, and a process
 * that only noticed SIGTERM at the end of that wait would be SIGKILLed long
 * before it got there — Railway's redeploy grace period is far shorter.
 */
async function waitFor(ms: number, running: () => boolean): Promise<void> {
  const deadline = Date.now() + ms;
  while (running()) {
    const left = deadline - Date.now();
    if (left <= 0) return;
    await sleep(Math.min(1_000, left));
  }
}

function positiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    console.warn(`[${stamp()}] ${name}="${raw}" is not a positive number; using ${fallback}.`);
    return fallback;
  }
  return Math.floor(value);
}

async function main(): Promise<void> {
  // Every required variable is read before the first claim. A worker that
  // claims a batch and only then finds INTEGRATION_TOKEN_KEY missing has
  // already taken those rows out of the queue.
  const tokenKey = env('INTEGRATION_TOKEN_KEY');
  const unsubscribeSecret = env('EMAIL_UNSUBSCRIBE_SECRET');
  const siteUrl = env('PUBLIC_SITE_URL').replace(/\/+$/, '');
  const db = serviceClient();

  const intervalMs = positiveInt('WORKER_INTERVAL_MS', 15_000);
  const maxPerCycle = positiveInt('WORKER_BATCH', 50);
  // Five minutes, against the send loop's fifteen seconds. A reply noticed four
  // minutes late costs nothing, and an IMAP login per mailbox every fifteen
  // seconds is itself a throttling trigger at most providers.
  const inboxIntervalMs = positiveInt('INBOX_INTERVAL_MS', 300_000);

  if (siteUrl.includes('localhost')) {
    console.warn(
      `[${stamp()}] PUBLIC_SITE_URL is localhost, so unsubscribe links in sent mail will not\n` +
        '           resolve for recipients. Set it to the public origin before real sends.',
    );
  }

  let running = true;
  let stopping = false;
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      if (stopping) {
        // An operator with no way out reaches for kill -9, and THAT is the case
        // that strands rows. A second signal leaves immediately instead.
        console.error(
          `[${stamp()}] second ${signal} — exiting now. Rows this cycle had claimed stay ` +
            "'sending' until the recovery sweep requeues them.",
        );
        process.exit(130);
      }
      stopping = true;
      running = false;
      // The cycle checks this between mailboxes and between messages, so it
      // stops at the next message boundary rather than at the end of a batch
      // that can run for twenty minutes — longer than any shutdown grace
      // period, and on Railway a redeploy sends SIGTERM every single time.
      console.log(`[${stamp()}] ${signal} received — stopping after the message in flight.`);
    });
  }

  console.log(
    `[${stamp()}] email worker started — one cycle every ${Math.round(intervalMs / 1000)}s, ` +
      `up to ${maxPerCycle} messages per organisation per cycle; inbox scan every ` +
      `${Math.round(inboxIntervalMs / 60000)}m.`,
  );

  let lastBlocked: string | null = null;

  const sendLoop = async (): Promise<void> => {
    while (running) {
      try {
        const result = await runCycle({
          db,
          createTransport,
          domainAcceptsMail,
          sleep,
          now: () => new Date(),
          env: { tokenKey, unsubscribeSecret, siteUrl },
          maxPerCycle,
          shouldStop: () => !running,
        });

        // Counts and reasons only: never a password, never a recipient list.
        if (result.claimed > 0 || result.errors.length > 0) {
          lastBlocked = null;
          console.log(
            `[${stamp()}] claimed ${result.claimed}, sent ${result.sent}, ` +
              `failed ${result.failed}, skipped ${result.skipped}`,
          );
        } else if (result.blocked && result.blocked !== lastBlocked) {
          // Logged on change only: an idle worker outside its send window would
          // otherwise write the same line four times a minute, all night.
          lastBlocked = result.blocked;
          console.log(`[${stamp()}] idle — ${result.blocked}`);
        }

        for (const error of result.errors.slice(0, 5)) {
          console.error(`[${stamp()}] ${error}`);
        }
      } catch (err) {
        // Never exit on one bad cycle: the queue outlives any single failure, and
        // a crash loop on Railway would stop sending entirely.
        console.error(`[${stamp()}] cycle failed:`, err instanceof Error ? err.message : err);
      }

      if (running) await sleep(intervalMs);
    }
  };

  /**
   * The inbox scan, on its own interval and in its own loop.
   *
   * It never shares a failure with the send loop: every pass is wrapped here,
   * runInboxCycle wraps each mailbox, and the promise itself is caught where
   * the two are started. An unreadable mailbox — an app password with IMAP
   * left disabled is the ordinary case — must cost the outbox nothing.
   */
  const inboxLoop = async (): Promise<void> => {
    // A few seconds before the first pass, so a restart does not open an IMAP
    // connection for every configured mailbox in the same second as the first
    // send cycle. The point is to spread the logins, not to delay the work: on
    // a five-minute loop this costs nothing, and a burst of simultaneous
    // logins is exactly what providers rate-limit.
    await waitFor(INBOX_START_DELAY_MS, () => running);

    while (running) {
      try {
        const result = await runInboxCycle({
          db,
          connect: { envelopes: fetchRecentEnvelopes, bounces: fetchBounceSources },
          now: () => new Date(),
          env: { tokenKey },
          shouldStop: () => !running,
        });

        // Counts and reasons only: never a subject, never a body, never a
        // recipient list. Silent when there is nothing to scan, so a
        // deployment with no IMAP configured writes no line at all.
        if (result.scanned > 0 || result.errors.length > 0) {
          console.log(
            `[${stamp()}] inbox: scanned ${result.scanned}, replies ${result.replies}, ` +
              `bounces ${result.bounces}`,
          );
        }

        for (const error of result.errors.slice(0, 5)) {
          console.error(`[${stamp()}] inbox ${error}`);
        }
      } catch (err) {
        // Never exit, and never let this reach the send loop.
        console.error(
          `[${stamp()}] inbox cycle failed:`,
          err instanceof Error ? err.message : err,
        );
      }

      await waitFor(inboxIntervalMs, () => running);
    }
  };

  // Both loops run to completion; neither can end the other. `running` is the
  // one shutdown flag, so a signal stops them both at their next boundary.
  await Promise.all([
    sendLoop().catch((err: unknown) => {
      console.error(`[${stamp()}] send loop stopped:`, err instanceof Error ? err.message : err);
    }),
    inboxLoop().catch((err: unknown) => {
      console.error(`[${stamp()}] inbox loop stopped:`, err instanceof Error ? err.message : err);
    }),
  ]);

  console.log(`[${stamp()}] email worker stopped.`);
}

main().catch((err: unknown) => {
  // Configuration errors land here: the message names the missing variable and
  // never its value.
  console.error(`[${stamp()}] worker could not start:`, err instanceof Error ? err.message : err);
  process.exit(1);
});
