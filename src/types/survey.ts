export type QuestionType = 
  | 'multiple_choice'
  | 'checkbox'
  | 'text'
  | 'long_text'
  | 'rating'
  | 'scale'
  | 'dropdown'
  | 'date'
  | 'email'
  | 'number'

export interface QuestionOption {
  id: string
  text: string
}

export interface Question {
  id: string
  type: QuestionType
  title: string
  description?: string
  required: boolean
  options?: QuestionOption[]
  minRating?: number
  maxRating?: number
  minScale?: number
  maxScale?: number
  minLabel?: string
  maxLabel?: string
}

export interface Survey {
  id: string
  title: string
  description?: string
  questions: Question[]
  createdAt: Date
  updatedAt: Date
  isPublished: boolean
  collectEmail: boolean
  isAnonymous: boolean
  responseCount: number
}

export interface SurveyResponse {
  id: string
  surveyId: string
  answers: Answer[]
  submittedAt: Date
  email?: string
}

export interface Answer {
  questionId: string
  value: string | string[] | number
}
