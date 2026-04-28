import { supabase } from '@/services/supabase/config';
import { AI_CONFIG } from './openai';
import type { AIError } from './types';

/**
 * Proxies prompts through Supabase Edge Function `ai-chat`.
 * Surfaces `{ error }` bodies when the Functions client omits readable details on non-OK HTTP.
 */
export async function invokeAiChatEdge(opts: {
  prompt: string;
  model?: string;
  temperature?: number;
  max_tokens?: number;
}): Promise<string> {
  const body = {
    prompt: opts.prompt,
    model: opts.model ?? AI_CONFIG.model,
    temperature:
      opts.temperature !== undefined
        ? opts.temperature
        : AI_CONFIG.temperature,
    max_tokens: opts.max_tokens ?? AI_CONFIG.maxTokens,
  };

  const { data, error } = await supabase.functions.invoke('ai-chat', {
    body,
  });

  const payload = data as {
    content?: string;
    error?: string;
    code?: string;
  } | null;

  const errFromPayload =
    payload && typeof payload.error === 'string' && payload.error.trim().length > 0
      ? payload.error.trim()
      : null;

  const content =
    typeof payload?.content === 'string' && payload.content.trim().length > 0
      ? payload.content
      : null;

  if (errFromPayload) {
    throw {
      code: 'API_ERROR',
      message: errFromPayload,
    } as AIError;
  }

  if (content) {
    return content;
  }

  throw {
    code: 'API_ERROR',
    message:
      typeof error?.message === 'string' && error.message.length > 0
        ? error.message
        : 'AI request failed. If this persists, check Supabase ai-chat logs and OPENAI_API_KEY.',
  } as AIError;
}
