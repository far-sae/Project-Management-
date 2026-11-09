// Supabase Edge Function: transcribe a recorded call with OpenAI Whisper.
// Deploy: supabase functions deploy transcribe-audio
//
// Secrets: OPENAI_API_KEY (already used by ai-chat).
//
// Why server-side: the browser's live SpeechRecognition only hears the local
// microphone, only exists in Chrome/Edge/Safari, and silently stops on
// errors — so calls often ended with audio but no transcript. The recorded
// file already contains every participant's voice, so transcribing it gives
// a complete transcript in any browser.
//
// Request: multipart/form-data with a `file` field (audio/webm, ≤ 25 MB —
// OpenAI's limit). Response: { text } or { error }.

import { json, preflight } from "../_shared/cors.ts";
import { verifyUser } from "../_shared/auth.ts";

const MAX_BYTES = 25 * 1024 * 1024;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return preflight();
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  // Signed-in users only — protects the OpenAI bill.
  try {
    await verifyUser(req);
  } catch (r) {
    if (r instanceof Response) return json({ error: "Unauthorized" }, r.status);
    return json({ error: "Unauthorized" }, 401);
  }

  const apiKey = (Deno.env.get("OPENAI_API_KEY") ?? "").trim();
  if (!apiKey) {
    return json(
      { error: "OPENAI_API_KEY is not set on this Edge Function.", code: "MISSING_OPENAI_KEY" },
      503,
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return json({ error: "Expected multipart/form-data with a 'file' field" }, 400);
  }
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return json({ error: "Missing audio file" }, 400);
  }
  if (file.size > MAX_BYTES) {
    return json({ error: "Recording is too long to transcribe (max 25 MB)." }, 413);
  }

  const upstream = new FormData();
  upstream.append("file", file, file.name || "call.webm");
  upstream.append("model", "whisper-1");
  upstream.append("response_format", "json");

  try {
    const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: upstream,
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = body?.error?.message || `Transcription failed (${res.status})`;
      console.error("transcribe-audio upstream error:", res.status, msg);
      return json({ error: msg }, 502);
    }
    return json({ text: typeof body.text === "string" ? body.text : "" });
  } catch (err) {
    console.error("transcribe-audio error:", err);
    return json({ error: "Could not reach the transcription service" }, 502);
  }
});
