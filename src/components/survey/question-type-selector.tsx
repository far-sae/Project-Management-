import {
  Circle,
  CheckSquare,
  Type,
  AlignLeft,
  Star,
  Sliders,
  ChevronDown,
  Calendar,
  Mail,
  Hash,
} from 'lucide-react'
import type { QuestionType, Question, QuestionOption } from '@/types/survey'
import { generateId } from '@/lib/utils'

interface QuestionTypeSelectorProps {
  onSelect: (question: Question) => void
}

const questionTypes: { type: QuestionType; icon: React.ReactNode; label: string; description: string }[] = [
  { type: 'multiple_choice', icon: <Circle className="w-5 h-5" />, label: 'Multiple Choice', description: 'Select one option' },
  { type: 'checkbox', icon: <CheckSquare className="w-5 h-5" />, label: 'Checkboxes', description: 'Select multiple options' },
  { type: 'text', icon: <Type className="w-5 h-5" />, label: 'Short Text', description: 'Single line answer' },
  { type: 'long_text', icon: <AlignLeft className="w-5 h-5" />, label: 'Long Text', description: 'Paragraph answer' },
  { type: 'rating', icon: <Star className="w-5 h-5" />, label: 'Rating', description: '5-star rating' },
  { type: 'scale', icon: <Sliders className="w-5 h-5" />, label: 'Linear Scale', description: '1-10 scale' },
  { type: 'dropdown', icon: <ChevronDown className="w-5 h-5" />, label: 'Dropdown', description: 'Select from list' },
  { type: 'date', icon: <Calendar className="w-5 h-5" />, label: 'Date', description: 'Date picker' },
  { type: 'email', icon: <Mail className="w-5 h-5" />, label: 'Email', description: 'Email address' },
  { type: 'number', icon: <Hash className="w-5 h-5" />, label: 'Number', description: 'Numeric input' },
]

function createQuestion(type: QuestionType): Question {
  const baseQuestion: Question = {
    id: generateId(),
    type,
    title: '',
    required: false,
  }

  if (['multiple_choice', 'checkbox', 'dropdown'].includes(type)) {
    const defaultOptions: QuestionOption[] = [
      { id: generateId(), text: 'Option 1' },
      { id: generateId(), text: 'Option 2' },
    ]
    return { ...baseQuestion, options: defaultOptions }
  }

  if (type === 'scale') {
    return {
      ...baseQuestion,
      minScale: 1,
      maxScale: 10,
      minLabel: 'Not at all',
      maxLabel: 'Extremely',
    }
  }

  if (type === 'rating') {
    return {
      ...baseQuestion,
      minRating: 1,
      maxRating: 5,
    }
  }

  return baseQuestion
}

export function QuestionTypeSelector({ onSelect }: QuestionTypeSelectorProps) {
  const handleSelect = (type: QuestionType) => {
    const question = createQuestion(type)
    onSelect(question)
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
      {questionTypes.map(({ type, icon, label, description }) => (
        <button
          key={type}
          onClick={() => handleSelect(type)}
          className="question-type-button group"
        >
          <div className="p-2 rounded-lg bg-secondary text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
            {icon}
          </div>
          <span className="text-sm font-medium text-center">{label}</span>
          <span className="text-xs text-muted-foreground text-center hidden sm:block">
            {description}
          </span>
        </button>
      ))}
    </div>
  )
}
