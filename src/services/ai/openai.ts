import OpenAI from 'openai';

// Initialize OpenAI client
const apiKey = import.meta.env.VITE_OPENAI_API_KEY;

const isValidApiKey = apiKey && 
  apiKey !== 'sk-your-openai-api-key-here' && 
  apiKey.startsWith('sk-');

if (!isValidApiKey) {
  console.warn('[AI] OpenAI API key not configured. AI features will be disabled.');
}

export const openai = isValidApiKey
  ? new OpenAI({
      apiKey,
      dangerouslyAllowBrowser: true, // Note: For production, use a backend proxy
    })
  : null;

/** AI works in every workspace when API key is set (no per-workspace gate). */
export const isAIEnabled = (): boolean => {
  return openai !== null;
};

// Default model configuration
export const AI_CONFIG = {
  model: 'gpt-4o-mini', // Fast and cost-effective
  temperature: 0.7,
  maxTokens: 500,
};
