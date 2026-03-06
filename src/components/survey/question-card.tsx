import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  GripVertical,
  Trash2,
  Copy,
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
import type { Question, QuestionType, QuestionOption } from '@/types/survey'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { cn, generateId } from '@/lib/utils'

interface QuestionCardProps {
  question: Question
  onUpdate: (question: Question) => void
  onDelete: () => void
  onDuplicate: () => void
}

export const questionTypeConfig: Record<QuestionType, { icon: React.ReactNode; label: string; color: string }> = {
  multiple_choice: { icon: <Circle className="w-4 h-4" />, label: 'Multiple Choice', color: 'text-primary' },
  checkbox: { icon: <CheckSquare className="w-4 h-4" />, label: 'Checkboxes', color: 'text-accent' },
  text: { icon: <Type className="w-4 h-4" />, label: 'Short Text', color: 'text-success' },
  long_text: { icon: <AlignLeft className="w-4 h-4" />, label: 'Long Text', color: 'text-warning' },
  rating: { icon: <Star className="w-4 h-4" />, label: 'Rating', color: 'text-yellow-500' },
  scale: { icon: <Sliders className="w-4 h-4" />, label: 'Linear Scale', color: 'text-indigo-500' },
  dropdown: { icon: <ChevronDown className="w-4 h-4" />, label: 'Dropdown', color: 'text-purple-500' },
  date: { icon: <Calendar className="w-4 h-4" />, label: 'Date', color: 'text-pink-500' },
  email: { icon: <Mail className="w-4 h-4" />, label: 'Email', color: 'text-cyan-500' },
  number: { icon: <Hash className="w-4 h-4" />, label: 'Number', color: 'text-orange-500' },
}

export function QuestionCard({ question, onUpdate, onDelete, onDuplicate }: QuestionCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: question.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  const typeConfig = questionTypeConfig[question.type]

  const handleTitleChange = (title: string) => {
    onUpdate({ ...question, title })
  }

  const handleDescriptionChange = (description: string) => {
    onUpdate({ ...question, description })
  }

  const handleRequiredChange = (required: boolean) => {
    onUpdate({ ...question, required })
  }

  const handleAddOption = () => {
    const newOption: QuestionOption = {
      id: generateId(),
      text: `Option ${(question.options?.length || 0) + 1}`,
    }
    onUpdate({
      ...question,
      options: [...(question.options || []), newOption],
    })
  }

  const handleUpdateOption = (optionId: string, text: string) => {
    onUpdate({
      ...question,
      options: question.options?.map(opt =>
        opt.id === optionId ? { ...opt, text } : opt
      ),
    })
  }

  const handleDeleteOption = (optionId: string) => {
    onUpdate({
      ...question,
      options: question.options?.filter(opt => opt.id !== optionId),
    })
  }

  const renderQuestionPreview = () => {
    switch (question.type) {
      case 'multiple_choice':
      case 'checkbox':
      case 'dropdown':
        return (
          <div className="space-y-2 mt-4">
            {question.options?.map((option) => (
              <div key={option.id} className="flex items-center gap-2">
                {question.type === 'checkbox' ? (
                  <CheckSquare className="w-4 h-4 text-muted-foreground" />
                ) : (
                  <Circle className="w-4 h-4 text-muted-foreground" />
                )}
                <Input
                  value={option.text}
                  onChange={(e) => handleUpdateOption(option.id, e.target.value)}
                  className="flex-1 h-9"
                  placeholder="Option text"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 text-muted-foreground hover:text-destructive"
                  onClick={() => handleDeleteOption(option.id)}
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            ))}
            <Button
              variant="ghost"
              size="sm"
              onClick={handleAddOption}
              className="text-primary"
            >
              + Add option
            </Button>
          </div>
        )
      case 'rating':
        return (
          <div className="flex gap-1 mt-4">
            {[1, 2, 3, 4, 5].map((star) => (
              <Star
                key={star}
                className="w-6 h-6 text-muted-foreground hover:text-yellow-500 cursor-pointer transition-colors"
              />
            ))}
          </div>
        )
      case 'scale':
        return (
          <div className="mt-4 space-y-3">
            <div className="flex justify-between items-center">
              <Input
                value={question.minLabel || ''}
                onChange={(e) => onUpdate({ ...question, minLabel: e.target.value })}
                placeholder="Min label"
                className="w-32 h-8 text-sm"
              />
              <Input
                value={question.maxLabel || ''}
                onChange={(e) => onUpdate({ ...question, maxLabel: e.target.value })}
                placeholder="Max label"
                className="w-32 h-8 text-sm"
              />
            </div>
            <div className="flex justify-between">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((num) => (
                <div
                  key={num}
                  className="w-8 h-8 rounded-full border border-input flex items-center justify-center text-sm text-muted-foreground hover:border-primary hover:text-primary transition-colors cursor-pointer"
                >
                  {num}
                </div>
              ))}
            </div>
          </div>
        )
      case 'text':
      case 'email':
      case 'number':
        return (
          <div className="mt-4">
            <Input
              placeholder={question.type === 'email' ? 'email@example.com' : question.type === 'number' ? '0' : 'Short answer text'}
              disabled
              className="bg-secondary/50"
            />
          </div>
        )
      case 'long_text':
        return (
          <div className="mt-4">
            <div className="w-full h-24 rounded-lg border border-input bg-secondary/50 p-3 text-sm text-muted-foreground">
              Long answer text
            </div>
          </div>
        )
      case 'date':
        return (
          <div className="mt-4">
            <Input
              type="date"
              disabled
              className="bg-secondary/50 w-48"
            />
          </div>
        )
      default:
        return null
    }
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'question-card animate-fade-in',
        isDragging && 'opacity-50 shadow-glow'
      )}
    >
      <div className="flex items-start gap-3">
        <button
          {...attributes}
          {...listeners}
          className="drag-handle mt-1"
        >
          <GripVertical className="w-5 h-5" />
        </button>

        <div className="flex-1 space-y-3">
          <div className="flex items-center gap-2">
            <span className={cn('p-1.5 rounded-md bg-secondary', typeConfig.color)}>
              {typeConfig.icon}
            </span>
            <span className="text-xs text-muted-foreground font-medium">
              {typeConfig.label}
            </span>
          </div>

          <Input
            value={question.title}
            onChange={(e) => handleTitleChange(e.target.value)}
            placeholder="Enter your question"
            className="text-lg font-medium border-none shadow-none px-0 focus-visible:ring-0 h-auto"
          />

          <Input
            value={question.description || ''}
            onChange={(e) => handleDescriptionChange(e.target.value)}
            placeholder="Add description (optional)"
            className="text-sm text-muted-foreground border-none shadow-none px-0 focus-visible:ring-0 h-auto"
          />

          {renderQuestionPreview()}
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2">
            <Switch
              id={`required-${question.id}`}
              checked={question.required}
              onCheckedChange={handleRequiredChange}
            />
            <Label htmlFor={`required-${question.id}`} className="text-sm text-muted-foreground">
              Required
            </Label>
          </div>
          
          <Button
            variant="ghost"
            size="icon"
            onClick={onDuplicate}
            className="text-muted-foreground hover:text-foreground"
          >
            <Copy className="w-4 h-4" />
          </Button>
          
          <Button
            variant="ghost"
            size="icon"
            onClick={onDelete}
            className="text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}
