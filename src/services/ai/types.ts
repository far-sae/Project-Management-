import { TaskPriority } from '@/types/task';

export interface TitleGenerationInput {
  description: string;
  projectContext?: string;
}

export interface TitleGenerationResponse {
  title: string;
  confidence: number;
}

export interface DescriptionExpansionInput {
  title: string;
  projectContext?: string;
}

export interface DescriptionExpansionResponse {
  description: string;
  confidence: number;
}

export interface DescriptionRefineInput {
  title: string;
  description: string;
  projectContext?: string;
}

export interface DescriptionRefineResponse {
  description: string;
  confidence: number;
}

export interface SmartSuggestionInput {
  title: string;
  description?: string;
  projectContext?: string;
}

export interface SmartSuggestionResponse {
  priority: TaskPriority;
  dueDate: Date | null;
  reasoning: string;
}

export interface SubtaskDecompositionInput {
  title: string;
  description: string;
  projectContext?: string;
}

export interface Subtask {
  title: string;
  description: string;
  estimatedDuration?: string;
  priority?: TaskPriority;
}

export interface SubtaskDecompositionResponse {
  subtasks: Subtask[];
  reasoning: string;
}

export interface AIError {
  code: 'RATE_LIMIT' | 'API_ERROR' | 'INVALID_INPUT' | 'NO_API_KEY';
  message: string;
  retryAfter?: number;
  /** Original error when message wraps a downstream failure */
  originalError?: unknown;
  /** Snippet of raw model output when parsing fails */
  responseSnippet?: string;
}
