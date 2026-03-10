import { supabase } from '@/services/supabase/config';
import { isAIEnabled, AI_CONFIG } from './openai';
import { PROMPTS } from './prompts';
import { rateLimiter } from './rateLimiter';
import {
  TitleGenerationInput,
  TitleGenerationResponse,
  DescriptionExpansionInput,
  DescriptionExpansionResponse,
  DescriptionRefineInput,
  DescriptionRefineResponse,
  SmartSuggestionInput,
  SmartSuggestionResponse,
  SubtaskDecompositionInput,
  SubtaskDecompositionResponse,
  AIError,
} from './types';

// Helper function to handle API calls
async function makeAIRequest<T>(
  userId: string,
  prompt: string,
  parseResponse: (content: string) => T
): Promise<T> {
  // Check if AI is enabled
  if (!isAIEnabled()) {
    throw {
      code: 'NO_API_KEY',
      message: 'AI features are not configured. Please add your OpenAI API key.',
    } as AIError;
  }

  // Rate limiting
  const rateLimit = rateLimiter.checkLimit(userId);
  if (!rateLimit.allowed) {
    throw {
      code: 'RATE_LIMIT',
      message: `Rate limit exceeded. Please try again in ${rateLimit.retryAfter} seconds.`,
      retryAfter: rateLimit.retryAfter,
    } as AIError;
  }

  try {
    // Use Supabase Edge Function to proxy OpenAI (avoids CORS in production)
    const { data, error } = await supabase.functions.invoke('ai-chat', {
      body: {
        prompt,
        model: AI_CONFIG.model,
        temperature: AI_CONFIG.temperature,
        max_tokens: AI_CONFIG.maxTokens,
      },
    });

    if (error) throw new Error(error.message || 'AI request failed');
    if (data?.error) throw new Error(typeof data.error === 'string' ? data.error : 'AI request failed');
    const content = data?.content;
    if (!content) {
      throw new Error('No response from AI');
    }

    return parseResponse(content);
  } catch (error: unknown) {
    console.error('[AI] Request failed:', error);

    // Check if it's already an AIError
    if (error && typeof error === 'object' && 'code' in error) {
      throw error;
    }

    // Type guard for error object
    const err = error as { status?: number; message?: string };

    if (err.status === 429) {
      throw {
        code: 'RATE_LIMIT',
        message: 'OpenAI rate limit exceeded. Please try again later.',
        retryAfter: 60,
      } as AIError;
    }

    throw {
      code: 'API_ERROR',
      message: err.message || 'Failed to get AI suggestion. Please try again.',
    } as AIError;
  }
}

// 1. Title Generation
export async function generateTitle(
  userId: string,
  input: TitleGenerationInput
): Promise<TitleGenerationResponse> {
  if (!input.description || input.description.trim().length < 10) {
    throw {
      code: 'INVALID_INPUT',
      message: 'Please provide a description with at least 10 characters.',
    } as AIError;
  }

  const prompt = PROMPTS.titleGeneration(input.description, input.projectContext);

  return makeAIRequest(userId, prompt, (content) => ({
    title: content.trim().slice(0, 60), // Ensure max 60 chars
    confidence: 0.85,
  }));
}

// 2. Description Expansion
export async function expandDescription(
  userId: string,
  input: DescriptionExpansionInput
): Promise<DescriptionExpansionResponse> {
  if (!input.title || input.title.trim().length < 3) {
    throw {
      code: 'INVALID_INPUT',
      message: 'Please provide a title with at least 3 characters.',
    } as AIError;
  }

  const prompt = PROMPTS.descriptionExpansion(input.title.trim(), input.projectContext);

  return makeAIRequest(userId, prompt, (content) => ({
    description: content.trim(),
    confidence: 0.85,
  }));
}

// 2b. Description Refine (improve existing description)
export async function refineDescription(
  userId: string,
  input: DescriptionRefineInput
): Promise<DescriptionRefineResponse> {
  if (!input.title?.trim() || !input.description?.trim()) {
    throw {
      code: 'INVALID_INPUT',
      message: 'Title and description are required.',
    } as AIError;
  }

  const prompt = PROMPTS.descriptionRefine(
    input.title,
    input.description,
    input.projectContext
  );

  return makeAIRequest(userId, prompt, (content) => ({
    description: content.trim(),
    confidence: 0.85,
  }));
}

// 3. Smart Priority & Due Date Suggestion
export async function suggestPriorityAndDueDate(
  userId: string,
  input: SmartSuggestionInput
): Promise<SmartSuggestionResponse> {
  if (!input.title || input.title.trim().length < 3) {
    throw {
      code: 'INVALID_INPUT',
      message: 'Please provide a task title.',
    } as AIError;
  }

  const prompt = PROMPTS.smartSuggestion(
    input.title,
    input.description,
    input.projectContext
  );

  return makeAIRequest(userId, prompt, (content) => {
    try {
      // Try to extract JSON from the response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }
      
      const parsed = JSON.parse(jsonMatch[0]);

      return {
        priority: parsed.priority || 'medium',
        dueDate: parsed.daysUntilDue
          ? new Date(Date.now() + parsed.daysUntilDue * 24 * 60 * 60 * 1000)
          : null,
        reasoning: parsed.reasoning || 'AI suggestion based on task analysis.',
      };
    } catch {
      // Default fallback if parsing fails
      return {
        priority: 'medium',
        dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
        reasoning: 'Default suggestion - could not parse AI response.',
      };
    }
  });
}

// 4. Task Decomposition (Subtasks)
export async function decomposeTask(
  userId: string,
  input: SubtaskDecompositionInput
): Promise<SubtaskDecompositionResponse> {
  if (!input.title || input.title.trim().length < 3) {
    throw {
      code: 'INVALID_INPUT',
      message: 'Please provide a task title.',
    } as AIError;
  }

  const prompt = PROMPTS.subtaskDecomposition(
    input.title,
    input.description || input.title,
    input.projectContext
  );

  return makeAIRequest(userId, prompt, (content) => {
    try {
      // Try to extract JSON from the response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }
      
      const parsed = JSON.parse(jsonMatch[0]);
      
      return {
        subtasks: (parsed.subtasks || []).map((s: Record<string, string>) => ({
          title: s.title || 'Untitled subtask',
          description: s.description || '',
          estimatedDuration: s.estimatedDuration,
          priority: s.priority || 'medium',
        })),
        reasoning: parsed.reasoning || 'Task broken down into manageable subtasks.',
      };
    } catch {
      // Default fallback
      return {
        subtasks: [
          { title: 'Research and planning', description: 'Gather requirements', priority: 'high' },
          { title: 'Implementation', description: 'Build the core functionality', priority: 'high' },
          { title: 'Testing and review', description: 'Verify and validate', priority: 'medium' },
        ],
        reasoning: 'Default breakdown - could not parse AI response.',
      };
    }
  });
}
