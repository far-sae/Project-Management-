import React, { createContext, useContext, useReducer, useEffect } from 'react'
import type { Survey, SurveyResponse, Question } from '@/types/survey'
import { generateId } from '@/lib/utils'

interface SurveyState {
  surveys: Survey[]
  responses: SurveyResponse[]
  currentSurvey: Survey | null
}

type SurveyAction =
  | { type: 'CREATE_SURVEY'; payload: Survey }
  | { type: 'UPDATE_SURVEY'; payload: Survey }
  | { type: 'DELETE_SURVEY'; payload: string }
  | { type: 'SET_CURRENT_SURVEY'; payload: Survey | null }
  | { type: 'ADD_QUESTION'; payload: { surveyId: string; question: Question } }
  | { type: 'UPDATE_QUESTION'; payload: { surveyId: string; question: Question } }
  | { type: 'DELETE_QUESTION'; payload: { surveyId: string; questionId: string } }
  | { type: 'REORDER_QUESTIONS'; payload: { surveyId: string; questions: Question[] } }
  | { type: 'ADD_RESPONSE'; payload: SurveyResponse }
  | { type: 'LOAD_STATE'; payload: SurveyState }

const initialState: SurveyState = {
  surveys: [],
  responses: [],
  currentSurvey: null,
}

function surveyReducer(state: SurveyState, action: SurveyAction): SurveyState {
  switch (action.type) {
    case 'CREATE_SURVEY':
      return { ...state, surveys: [...state.surveys, action.payload] }
    
    case 'UPDATE_SURVEY':
      return {
        ...state,
        surveys: state.surveys.map(s =>
          s.id === action.payload.id ? action.payload : s
        ),
        currentSurvey: state.currentSurvey?.id === action.payload.id 
          ? action.payload 
          : state.currentSurvey,
      }
    
    case 'DELETE_SURVEY':
      return {
        ...state,
        surveys: state.surveys.filter(s => s.id !== action.payload),
        currentSurvey: state.currentSurvey?.id === action.payload 
          ? null 
          : state.currentSurvey,
      }
    
    case 'SET_CURRENT_SURVEY':
      return { ...state, currentSurvey: action.payload }
    
    case 'ADD_QUESTION': {
      const survey = state.surveys.find(s => s.id === action.payload.surveyId)
      if (!survey) return state
      const updatedSurvey = {
        ...survey,
        questions: [...survey.questions, action.payload.question],
        updatedAt: new Date(),
      }
      return {
        ...state,
        surveys: state.surveys.map(s =>
          s.id === action.payload.surveyId ? updatedSurvey : s
        ),
        currentSurvey: state.currentSurvey?.id === action.payload.surveyId
          ? updatedSurvey
          : state.currentSurvey,
      }
    }
    
    case 'UPDATE_QUESTION': {
      const survey = state.surveys.find(s => s.id === action.payload.surveyId)
      if (!survey) return state
      const updatedSurvey = {
        ...survey,
        questions: survey.questions.map(q =>
          q.id === action.payload.question.id ? action.payload.question : q
        ),
        updatedAt: new Date(),
      }
      return {
        ...state,
        surveys: state.surveys.map(s =>
          s.id === action.payload.surveyId ? updatedSurvey : s
        ),
        currentSurvey: state.currentSurvey?.id === action.payload.surveyId
          ? updatedSurvey
          : state.currentSurvey,
      }
    }
    
    case 'DELETE_QUESTION': {
      const survey = state.surveys.find(s => s.id === action.payload.surveyId)
      if (!survey) return state
      const updatedSurvey = {
        ...survey,
        questions: survey.questions.filter(q => q.id !== action.payload.questionId),
        updatedAt: new Date(),
      }
      return {
        ...state,
        surveys: state.surveys.map(s =>
          s.id === action.payload.surveyId ? updatedSurvey : s
        ),
        currentSurvey: state.currentSurvey?.id === action.payload.surveyId
          ? updatedSurvey
          : state.currentSurvey,
      }
    }
    
    case 'REORDER_QUESTIONS': {
      const survey = state.surveys.find(s => s.id === action.payload.surveyId)
      if (!survey) return state
      const updatedSurvey = {
        ...survey,
        questions: action.payload.questions,
        updatedAt: new Date(),
      }
      return {
        ...state,
        surveys: state.surveys.map(s =>
          s.id === action.payload.surveyId ? updatedSurvey : s
        ),
        currentSurvey: state.currentSurvey?.id === action.payload.surveyId
          ? updatedSurvey
          : state.currentSurvey,
      }
    }
    
    case 'ADD_RESPONSE': {
      const survey = state.surveys.find(s => s.id === action.payload.surveyId)
      if (!survey) return state
      const updatedSurvey = {
        ...survey,
        responseCount: survey.responseCount + 1,
      }
      return {
        ...state,
        responses: [...state.responses, action.payload],
        surveys: state.surveys.map(s =>
          s.id === action.payload.surveyId ? updatedSurvey : s
        ),
      }
    }
    
    case 'LOAD_STATE':
      return action.payload

    default:
      return state
  }
}

interface SurveyContextType extends SurveyState {
  createSurvey: (title: string, description?: string) => Survey
  updateSurvey: (survey: Survey) => void
  deleteSurvey: (id: string) => void
  setCurrentSurvey: (survey: Survey | null) => void
  addQuestion: (surveyId: string, question: Question) => void
  updateQuestion: (surveyId: string, question: Question) => void
  deleteQuestion: (surveyId: string, questionId: string) => void
  reorderQuestions: (surveyId: string, questions: Question[]) => void
  addResponse: (response: SurveyResponse) => void
  getSurveyById: (id: string) => Survey | undefined
  getResponsesBySurveyId: (surveyId: string) => SurveyResponse[]
}

const SurveyContext = createContext<SurveyContextType | null>(null)

const STORAGE_KEY = 'formflow_data'

export function SurveyProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(surveyReducer, initialState)

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      try {
        const parsed = JSON.parse(stored)
        parsed.surveys = parsed.surveys.map((s: Survey) => ({
          ...s,
          createdAt: new Date(s.createdAt),
          updatedAt: new Date(s.updatedAt),
        }))
        parsed.responses = parsed.responses.map((r: SurveyResponse) => ({
          ...r,
          submittedAt: new Date(r.submittedAt),
        }))
        dispatch({ type: 'LOAD_STATE', payload: parsed })
      } catch (e) {
        console.error('Failed to load stored data:', e)
      }
    }
  }, [])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  }, [state])

  const createSurvey = (title: string, description?: string): Survey => {
    const survey: Survey = {
      id: generateId(),
      title,
      description,
      questions: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      isPublished: false,
      collectEmail: false,
      isAnonymous: true,
      responseCount: 0,
    }
    dispatch({ type: 'CREATE_SURVEY', payload: survey })
    return survey
  }

  const updateSurvey = (survey: Survey) => {
    dispatch({ type: 'UPDATE_SURVEY', payload: survey })
  }

  const deleteSurvey = (id: string) => {
    dispatch({ type: 'DELETE_SURVEY', payload: id })
  }

  const setCurrentSurvey = (survey: Survey | null) => {
    dispatch({ type: 'SET_CURRENT_SURVEY', payload: survey })
  }

  const addQuestion = (surveyId: string, question: Question) => {
    dispatch({ type: 'ADD_QUESTION', payload: { surveyId, question } })
  }

  const updateQuestion = (surveyId: string, question: Question) => {
    dispatch({ type: 'UPDATE_QUESTION', payload: { surveyId, question } })
  }

  const deleteQuestion = (surveyId: string, questionId: string) => {
    dispatch({ type: 'DELETE_QUESTION', payload: { surveyId, questionId } })
  }

  const reorderQuestions = (surveyId: string, questions: Question[]) => {
    dispatch({ type: 'REORDER_QUESTIONS', payload: { surveyId, questions } })
  }

  const addResponse = (response: SurveyResponse) => {
    dispatch({ type: 'ADD_RESPONSE', payload: response })
  }

  const getSurveyById = (id: string) => {
    return state.surveys.find(s => s.id === id)
  }

  const getResponsesBySurveyId = (surveyId: string) => {
    return state.responses.filter(r => r.surveyId === surveyId)
  }

  return (
    <SurveyContext.Provider
      value={{
        ...state,
        createSurvey,
        updateSurvey,
        deleteSurvey,
        setCurrentSurvey,
        addQuestion,
        updateQuestion,
        deleteQuestion,
        reorderQuestions,
        addResponse,
        getSurveyById,
        getResponsesBySurveyId,
      }}
    >
      {children}
    </SurveyContext.Provider>
  )
}

export function useSurvey() {
  const context = useContext(SurveyContext)
  if (!context) {
    throw new Error('useSurvey must be used within a SurveyProvider')
  }
  return context
}
