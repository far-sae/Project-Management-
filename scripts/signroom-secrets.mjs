#!/usr/bin/env node
/**
 * Prints fresh Signroom secrets for the owner to paste into Vercel.
 * node:crypto only; nothing is written to disk.
 *
 *   node scripts/signroom-secrets.mjs        both secrets (first set-up)
 *   node scripts/signroom-secrets.mjs 2      only SIGNROOM_EVIDENCE_KEY_V2 (a key rotation)
 *   node scripts/signroom-secrets.mjs cron   a CRON_SECRET, only if Vercel has none yet
 *
 * SIGNROOM_JOB_KEY           32 random bytes (base64): encrypts queued emails at rest.
 * SIGNROOM_EVIDENCE_KEY_V<n> an Ed25519 private key (base64 PKCS#8): signs the
 *                            evidence of a completed agreement as key
 *                            taskcalendar-ed25519-v<n>.
 * CRON_SECRET                Vercel sends it with every scheduled call; the
 *                            scheduled Signroom run accepts nothing else.
 */
import { generateKeyPairSync, randomBytes } from "node:crypto";

const evidenceKey = () => generateKeyPairSync("ed25519").privateKey.export({ format: "der", type: "pkcs8" }).toString("base64");

const arg = process.argv[2];
if (arg === "cron") {
  console.log(`CRON_SECRET=${randomBytes(32).toString("base64url")}`);
  // The guidance goes to stderr, so standard output is only the NAME=value line.
  console.error(
    "Add CRON_SECRET in Vercel (Production) only if the project has none yet: the other scheduled jobs use the same one, so do not replace a value that is already there.",
  );
} else if (arg !== undefined) {
  if (!/^[1-9]\d*$/.test(arg)) {
    console.error("Give the evidence key version as a whole number above zero, for example: node scripts/signroom-secrets.mjs 2");
    process.exit(1);
  }
  console.log(`SIGNROOM_EVIDENCE_KEY_V${arg}=${evidenceKey()}`);
  console.error(
    `Add SIGNROOM_EVIDENCE_KEY_V${arg} in Vercel (Production and Preview) with the value above. Keep every earlier SIGNROOM_EVIDENCE_KEY_V variable: never delete an evidence key.`,
  );
} else {
  console.log(`SIGNROOM_JOB_KEY=${randomBytes(32).toString("base64")}`);
  console.log(`SIGNROOM_EVIDENCE_KEY_V1=${evidenceKey()}`);
  console.log("");
  console.log(
    "Copy each line into Vercel as its own variable (the name before the first =, the value after it), for both Production and Preview. Never delete or replace an evidence key: add a new version instead. The scheduled run also needs CRON_SECRET in Vercel; if the project has none yet, run this script again with the word cron.",
  );
}
