/**
 * The autopilot's routes. /api/social/autopilot/<route> arrives at
 * api/social/publish.ts as ?autopilot=<route> (see vercel.json).
 *
 *   GET  ready   signed-in: which parts are switched on (no names, no values)
 *   POST run     owner or admin: one run for one workspace, now
 *   POST remake  owner or admin: make the picture or video of one idea again
 *   POST improve owner or admin: a second try for a post that is out
 *   POST learn   owner or admin: read the business's website and propose the brief
 *   *    tick    the timer, with the worker secret: the workspaces that are due
 *
 * The switch and the brief are saved by the screen straight to the database,
 * which lets only the owner and admins do so.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { AiError } from "../../_automation/ai.js";
import { CHANGE_MAX, SPOKEN_MAX, siteOf, type AutopilotReady, type RunReport, type SiteReading } from "../shared/autopilot.js";
import { briefFromSite, readSite } from "./brain.js";
import { serviceOn } from "../service.js";
import { makerOn } from "./runway.js";
import { improvePost, remake, runMedia, tick, type EngineDeps, type PilotStore } from "./engine.js";

export type PilotRouterDeps = {
  engine: EngineDeps;
  store: PilotStore;
  isWorker: (req: VercelRequest) => boolean;
  /** The signed-in person's id, or null. */
  userOf: (req: VercelRequest) => Promise<string | null>;
  /** The organisation a workspace belongs to, or null when there is no such workspace. */
  organizationOf: (workspaceId: string) => Promise<string | null>;
  isAdmin: (organizationId: string, userId: string) => Promise<boolean>;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const readyOf = (d: EngineDeps): AutopilotReady => ({ writing: d.claude !== null, media: makerOn(d.env), posting: serviceOn(d.env) });

export const NOTHING_DUE = "Nothing was due just now. The autopilot looks again every five minutes.";
export const BUSY = "The autopilot is already working on this workspace. Look again in a minute.";
export const SWITCH_ON_FIRST = "Switch the autopilot on first.";
export const DONE_BEFORE = "A second try was already made for this post.";
export const SITE_UNREADABLE = "That website could not be read. Check the address, or write about your business yourself.";
const ID = /^[A-Za-z0-9-]{1,64}$/;

export function pilotHandler(d: PilotRouterDeps) {
  return async function handler(req: VercelRequest, res: VercelResponse, route: string): Promise<void> {
    res.setHeader("Cache-Control", "private, no-store");

    if (route === "tick") {
      if (!d.isWorker(req)) { res.status(401).json({ error: "Unauthorized" }); return; }
      const result = await tick(d.store, d.engine);
      res.status(200).json({ workspaces: result.workspaces });
      return;
    }

    const userId = await d.userOf(req);
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

    if (route === "ready" && req.method === "GET") {
      res.status(200).json(readyOf(d.engine));
      return;
    }

    if (route === "run" && req.method === "POST") {
      const workspaceId = String((req.body ?? {}).workspaceId ?? "");
      const organizationId = UUID.test(workspaceId) ? await d.organizationOf(workspaceId) : null;
      // The same answer for "no such workspace" and "not yours": nothing is told about other organisations.
      if (!organizationId || !(await d.isAdmin(organizationId, userId))) { res.status(403).json({ error: "Only the owner or an admin can run the autopilot." }); return; }
      const result = await tick(d.store, d.engine, workspaceId);
      const report: RunReport = { did: result.did, next: result.workspaces === 0 ? BUSY : result.did.length === 0 ? NOTHING_DUE : "" };
      res.status(200).json(report);
      return;
    }

    if (route === "learn" && req.method === "POST") {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const workspaceId = String(body.workspaceId ?? "");
      const organizationId = UUID.test(workspaceId) ? await d.organizationOf(workspaceId) : null;
      if (!organizationId || !(await d.isAdmin(organizationId, userId))) { res.status(403).json({ error: "Only the owner or an admin can do this." }); return; }
      const site = siteOf(typeof body.website === "string" ? body.website : "");
      if (!site) { res.status(400).json({ error: "The website address does not look right. It should look like yourbusiness.com." }); return; }
      if (!d.engine.claude) { res.status(503).json({ error: "Writing is not switched on yet." }); return; }
      const ai = { claude: d.engine.claude, store: { insertUsage: async () => undefined } };
      try {
        const notes = await readSite(ai, { workspaceId, feature: "web" }, site);
        if (!notes) { res.status(422).json({ error: SITE_UNREADABLE }); return; }
        const reading: SiteReading = { ...(await briefFromSite(ai, { workspaceId, feature: "step" }, notes)), notes };
        res.status(200).json(reading);
      } catch (e) {
        if (!(e instanceof AiError)) throw e;
        res.status(503).json({ error: "The website could not be read just now. Please try again." });
      }
      return;
    }

    if ((route === "remake" || route === "improve") && req.method === "POST") {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const workspaceId = String(body.workspaceId ?? "");
      const organizationId = UUID.test(workspaceId) ? await d.organizationOf(workspaceId) : null;
      if (!organizationId || !(await d.isAdmin(organizationId, userId))) { res.status(403).json({ error: "Only the owner or an admin can do this." }); return; }
      const row = await d.store.get(workspaceId);
      if (!row || row.settings.mode === "off") { res.status(409).json({ error: SWITCH_ON_FIRST }); return; }

      if (route === "remake") {
        const groupId = String(body.groupId ?? "");
        const change = typeof body.change === "string" ? body.change : "";
        const spoken = typeof body.spoken === "string" ? body.spoken : undefined;
        if (!ID.test(groupId) || change.length > CHANGE_MAX || (spoken ?? "").length > SPOKEN_MAX) { res.status(400).json({ error: "That text is too long. Make it shorter." }); return; }
        if (!makerOn(d.engine.env)) { res.status(503).json({ error: "Making pictures and videos is not switched on yet." }); return; }
        if ((await remake(d.store, d.engine, row, groupId, { change, spoken })) === "gone") { res.status(404).json({ error: "This post can no longer be changed." }); return; }
      } else {
        const contentId = String(body.contentId ?? "");
        if (!ID.test(contentId)) { res.status(404).json({ error: "This post was not found." }); return; }
        if (!d.engine.claude) { res.status(503).json({ error: "Writing is not switched on yet." }); return; }
        let result: Awaited<ReturnType<typeof improvePost>>;
        try {
          result = await improvePost(d.store, d.engine, row, contentId);
        } catch (e) {
          if (!(e instanceof AiError)) throw e;
          res.status(503).json({ error: "The autopilot could not write just now. Please try again." });
          return;
        }
        if (result === "done before") { res.status(409).json({ error: DONE_BEFORE }); return; }
        if (result === "gone") { res.status(404).json({ error: "This post was not found, or there is no account left to post it to." }); return; }
      }

      // Start on the picture or video at once. When a timed run has the workspace just now, that run starts it.
      const claimed = await d.store.claim(1, new Date(d.engine.now()), workspaceId);
      if (claimed.length > 0) {
        try { await runMedia(d.store, d.engine, claimed[0]); }
        finally { await d.store.release(workspaceId, null).catch(() => undefined); }
      }
      res.status(200).json({ ok: true });
      return;
    }

    res.status(404).json({ error: "Not found" });
  };
}
