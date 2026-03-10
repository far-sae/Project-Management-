// AI requests are proxied via Supabase Edge Function (ai-chat) to avoid CORS.
// Set OPENAI_API_KEY on the Supabase project for the edge function.
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL ?? '';

/** AI enabled when Supabase is configured (edge function will handle the key). */
export const isAIEnabled = (): boolean => {
  return Boolean(supabaseUrl && supabaseUrl !== 'https://placeholder.supabase.co');
};

// Default model configuration
export const AI_CONFIG = {
  model: 'gpt-4o-mini', // Fast and cost-effective
  temperature: 0.7,
  maxTokens: 500,
};
