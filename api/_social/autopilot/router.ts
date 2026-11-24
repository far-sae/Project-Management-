/**
 * The autopilot's routes. /api/social/autopilot/<route> arrives at
 * api/social/publish.ts as ?autopilot=<route> (see vercel.json).
 *
 *   GET  ready   signed-in: which parts are switched on (no names, no values)
 *   POST run     owner or admin: one run for one workspace, now
 *   *    tick    the timer, with the worker secret: the workspaces that are due
 *
 * The switch and the brief are saved by the screen straight to the database,
 * which lets only the owner and admins do so.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import type { AutopilotReady, RunReport } from "../shared/autopilot.js";
import { serviceOn } from "../service.js";
import { makerOn } from "./runway.js";
import { tick, type EngineDeps, type PilotStore } from "./engine.js";

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

    res.status(404).json({ error: "Not found" });
  };
}
