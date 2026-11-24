/**
 * The picture and video maker (Runway).
 *
 * Making something is two steps there: ask for it (the answer is a task's id),
 * then ask how the task is doing until it has succeeded or failed. A finished
 * task gives an address of the file that stops working after a day or two, so
 * the file is fetched and kept in our own storage straight away.
 *
 * Pictures: `muse_image`, as a JPEG (Instagram takes no other kind), upright.
 * Videos:   `veo3.1_fast`, upright, eight seconds, with or without sound. With
 *           sound the model speaks the line it is given in the prompt.
 *
 * What the maker answers is never passed on as it is: a failure becomes one
 * plain sentence, and a log line carries a status only.
 */
import { VIDEO_SECONDS } from "../shared/autopilot.js";

type Env = Record<string, string | undefined>;
export type MakerDeps = { fetch: typeof fetch; env: Env };

const key = (env: Env): string => (env.RUNWAYML_API_SECRET ?? "").trim();
const base = (env: Env): string => ((env.RUNWAY_BASE_URL ?? "").trim() || "https://api.dev.runwayml.com").replace(/\/+$/, "");
export const API_VERSION = "2024-11-06";

export const makerOn = (env: Env): boolean => Boolean(key(env));

export const IMAGE_MODEL = "muse_image";
export const VIDEO_MODEL = "veo3.1_fast";
/** Upright, three by four: the shape Instagram and Facebook show largest in a feed. */
export const IMAGE_RATIO = "1344:1792";
/** Upright, nine by sixteen: a reel, a short, a TikTok. */
export const VIDEO_RATIO = "1080:1920";
export const IMAGE_PROMPT_MAX = 4000;
export const VIDEO_PROMPT_MAX = 1000;

const cut = (value: string, max: number): string => (value.length > max ? value.slice(0, max) : value);

export type MakeRequest = { path: string; body: Record<string, unknown> };

/** What is sent to have a picture made. */
export const imageRequest = (prompt: string): MakeRequest => ({
  path: "/v1/text_to_image",
  body: { model: IMAGE_MODEL, promptText: cut(prompt.trim(), IMAGE_PROMPT_MAX), ratio: IMAGE_RATIO, outputFormat: "jpeg" },
});

/**
 * The words of a video's prompt: what is seen, then what is said. Without a
 * voice the model is told so in words too, or it makes people talk anyway.
 */
export function videoPrompt(visual: string, spoken: string): string {
  const said = spoken.trim().replace(/["“”]/g, "'");
  const tail = said ? ` A clear voice says: "${said}"` : " No speech and no voice-over.";
  return cut(visual.trim(), VIDEO_PROMPT_MAX - tail.length) + tail;
}

/** What is sent to have a video made. `prompt` is the whole prompt (see `videoPrompt`). */
export const videoRequest = (prompt: string, withVoice: boolean): MakeRequest => ({
  path: "/v1/text_to_video",
  body: { model: VIDEO_MODEL, promptText: cut(prompt.trim(), VIDEO_PROMPT_MAX), ratio: VIDEO_RATIO, duration: VIDEO_SECONDS, audio: withVoice },
});

/** Why the maker gave nothing. `refused`: it will not make this (its own rules). `failed`: anything else. */
export class MakerError extends Error {
  constructor(public kind: "off" | "refused" | "failed") {
    super(kind);
    this.name = "MakerError";
  }
}

const obj = (value: unknown): Record<string, unknown> => (value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {});
const TASK_ID = /^[A-Za-z0-9-]{8,80}$/;

async function call(d: MakerDeps, method: "GET" | "POST", path: string, body?: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const response = await d.fetch(`${base(d.env)}${path}`, {
    method,
    headers: { Authorization: `Bearer ${key(d.env)}`, "X-Runway-Version": API_VERSION, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  let json: Record<string, unknown> = {};
  try { json = obj(await response.json()); } catch { /* not JSON: only the status counts */ }
  return { status: response.status, json };
}

/** Asks for a picture or a video. Returns the id of the task that makes it. */
export async function startMaking(d: MakerDeps, request: MakeRequest): Promise<string> {
  if (!makerOn(d.env)) throw new MakerError("off");
  let answer: { status: number; json: Record<string, unknown> };
  try {
    answer = await call(d, "POST", request.path, request.body);
  } catch {
    throw new MakerError("failed");
  }
  const id = typeof answer.json.id === "string" ? answer.json.id : "";
  if (answer.status >= 200 && answer.status < 300 && TASK_ID.test(id)) return id;
  console.error("[autopilot] the maker did not start", answer.status);
  // A request it will never take (its rules, a bad prompt) is not worth asking again.
  throw new MakerError(answer.status === 400 || answer.status === 422 ? "refused" : "failed");
}

export type TaskState =
  | { state: "working" }
  | { state: "done"; url: string; credits: number }
  | { state: "failed"; refused: boolean };

/** How a task is doing. */
export async function taskState(d: MakerDeps, taskId: string): Promise<TaskState> {
  if (!makerOn(d.env)) throw new MakerError("off");
  if (!TASK_ID.test(taskId)) return { state: "failed", refused: false };
  let answer: { status: number; json: Record<string, unknown> };
  try {
    answer = await call(d, "GET", `/v1/tasks/${taskId}`);
  } catch {
    throw new MakerError("failed");
  }
  // The task is not known any more: it will never finish.
  if (answer.status === 404) return { state: "failed", refused: false };
  if (answer.status < 200 || answer.status >= 300) throw new MakerError("failed");
  const status = String(answer.json.status ?? "");
  if (status === "SUCCEEDED") {
    const output = Array.isArray(answer.json.output) ? answer.json.output : [];
    const url = typeof output[0] === "string" && /^https:\/\/[^\s]+$/.test(output[0]) ? output[0] : "";
    if (!url) return { state: "failed", refused: false };
    const credits = Number(obj(answer.json.cost).credits);
    return { state: "done", url, credits: Number.isFinite(credits) && credits > 0 ? Math.ceil(credits) : 0 };
  }
  if (status === "FAILED" || status === "CANCELLED") {
    return { state: "failed", refused: /^(SAFETY|INPUT_PREPROCESSING\.SAFETY)/.test(String(answer.json.failureCode ?? "")) };
  }
  return { state: "working" };
}

export type MadeFile = { bytes: Uint8Array; mime: string };

/** The largest file that is fetched: an eight-second video is a few megabytes. */
export const MADE_FILE_MAX = 80 * 1024 * 1024;

/** Fetches the finished file from the maker's own address (the only kind of address `taskState` returns). */
export async function fetchMade(d: MakerDeps, url: string, kind: "image" | "video"): Promise<MadeFile> {
  let response: Response;
  try {
    response = await d.fetch(url);
  } catch {
    throw new MakerError("failed");
  }
  if (!response.ok) throw new MakerError("failed");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length === 0 || bytes.length > MADE_FILE_MAX) throw new MakerError("failed");
  return { bytes, mime: kind === "video" ? "video/mp4" : "image/jpeg" };
}
