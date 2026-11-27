import { callTool, INSTRUCTIONS, TOOLS, type ToolDeps, type ToolPerson } from "./tools.js";

/**
 * The connector's messages (Model Context Protocol, JSON-RPC 2.0), one per
 * request and nothing kept in between: a new connection, the list of tools,
 * and a call to one tool. Claude has already shown whose token it holds
 * before a message gets here.
 */

/** Newest first. Claude names the one it speaks; an unknown one gets our newest. */
export const PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"] as const;
export const SERVER_INFO = { name: "taskcalendar-email", title: "TaskCalendar Email", version: "1.0.0" };
export const FAILED_MESSAGE = "Something went wrong in TaskCalendar. Nothing was sent. Try again in a minute.";

export type RpcReply = { status: number; json?: unknown };

const fail = (id: unknown, code: number, message: string): RpcReply => ({ status: 200, json: { jsonrpc: "2.0", id: id ?? null, error: { code, message } } });
const done = (id: unknown, result: unknown): RpcReply => ({ status: 200, json: { jsonrpc: "2.0", id, result } });

export async function handleRpc(d: ToolDeps, who: ToolPerson, message: unknown, onFault: (e: unknown) => void = () => {}): Promise<RpcReply> {
  if (!message || typeof message !== "object" || Array.isArray(message)) return { ...fail(null, -32600, "One JSON-RPC message is expected."), status: 400 };
  const m = message as { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown };
  if (m.jsonrpc !== "2.0") return { ...fail(m.id, -32600, "One JSON-RPC 2.0 message is expected."), status: 400 };
  // A note, or an answer to something we never asked: taken, and nothing to say back.
  if (typeof m.method !== "string" || m.id === undefined || m.id === null) return { status: 202 };

  const params = (m.params && typeof m.params === "object" && !Array.isArray(m.params) ? m.params : {}) as Record<string, unknown>;
  switch (m.method) {
    case "initialize": {
      const asked = String(params.protocolVersion ?? "");
      const version = (PROTOCOL_VERSIONS as readonly string[]).includes(asked) ? asked : PROTOCOL_VERSIONS[0];
      return done(m.id, { protocolVersion: version, capabilities: { tools: { listChanged: false } }, serverInfo: SERVER_INFO, instructions: INSTRUCTIONS });
    }
    case "ping":
      return done(m.id, {});
    case "tools/list":
      return done(m.id, { tools: TOOLS.map(({ name, title, description, inputSchema, annotations }) => ({ name, title, description, inputSchema, annotations: { title, ...annotations } })) });
    case "tools/call": {
      const name = typeof params.name === "string" ? params.name : "";
      if (!TOOLS.some((t) => t.name === name)) return fail(m.id, -32602, `Unknown tool: ${name.slice(0, 60)}`);
      try {
        const out = await callTool(d, who, name, params.arguments);
        if (!out.ok) return done(m.id, { content: [{ type: "text", text: out.message }], isError: true });
        return done(m.id, { content: [{ type: "text", text: JSON.stringify(out.data, null, 1) }], isError: false });
      } catch (e) {
        // What went wrong stays in the server's log; Claude gets a sentence it can pass on.
        onFault(e);
        return done(m.id, { content: [{ type: "text", text: FAILED_MESSAGE }], isError: true });
      }
    }
    default:
      return fail(m.id, -32601, `Method not found: ${m.method.slice(0, 60)}`);
  }
}
