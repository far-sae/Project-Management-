import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Check, ChevronRight, Star, Send } from 'lucide-react';
import { useSurvey } from '@/store/survey-context';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Progress } from '@/components/ui/progress';
import { toast } from 'sonner';
import type { Question, Answer, SurveyResponse } from '@/types/survey';
import { cn, generateId } from '@/lib/utils';

export function TakeSurvey() {
  const { id } = useParams<{ id: string; }>();
  const navigate = useNavigate();
  const { getSurveyById, addResponse } = useSurvey();

  const survey = getSurveyById(id || '');
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string | string[] | number>>({});
  const [email, setEmail] = useState('');
  const [isSubmitted, setIsSubmitted] = useState(false);

  if (!survey) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-hero">
        <div className="text-center">
          <h2 className="text-xl font-semibold mb-2">Survey not found</h2>
          <Button onClick={() => navigate('/')}>Go back home</Button>
        </div>
      </div>
    );
  }

  const questions = survey.questions;
  const currentQuestion = questions[currentIndex];
  const progress = questions.length > 0 ? ((currentIndex + 1) / questions.length) * 100 : 0;

  const handleAnswer = (value: string | string[] | number) => {
    setAnswers((prev) => ({ ...prev, [currentQuestion.id]: value }));
  };

  const handleNext = () => {
    if (currentQuestion.required && !answers[currentQuestion.id]) {
      toast.error('Required question', {
        description: 'Please answer this question before continuing.',
      });
      return;
    }
    if (currentIndex < questions.length - 1) {
      setCurrentIndex((prev) => prev + 1);
    }
  };

  const handlePrevious = () => {
    if (currentIndex > 0) {
      setCurrentIndex((prev) => prev - 1);
    }
  };

  const handleSubmit = () => {
    if (currentQuestion?.required && !answers[currentQuestion.id]) {
      toast.error('Required question', {
        description: 'Please answer this question before submitting.',
      });
      return;
    }

    if (survey.collectEmail && !email) {
      toast.error('Email required', {
        description: 'Please enter your email address.',
      });
      return;
    }

    const responseAnswers: Answer[] = Object.entries(answers).map(([questionId, value]) => ({
      questionId,
      value,
    }));

    const response: SurveyResponse = {
      id: generateId(),
      surveyId: survey.id,
      answers: responseAnswers,
      submittedAt: new Date(),
      email: email || undefined,
    };

    addResponse(response);
    setIsSubmitted(true);
    toast.success('Response submitted', {
      description: 'Thank you for completing the survey!',
    });
  };

  if (isSubmitted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-hero">
        <div className="text-center max-w-md animate-scale-in">
          <div className="w-20 h-20 rounded-full bg-success mx-auto mb-6 flex items-center justify-center">
            <Check className="w-10 h-10 text-success-foreground" />
          </div>
          <h1 className="text-3xl font-bold mb-4">Thank you!</h1>
          <p className="text-muted-foreground mb-8">
            Your response has been recorded successfully.
          </p>
          <Button onClick={() => navigate('/')}>Back to home</Button>
        </div>
      </div>
    );
  }

  if (questions.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-hero">
        <div className="text-center">
          <h2 className="text-xl font-semibold mb-2">No questions in this survey</h2>
          <Button onClick={() => navigate('/')}>Go back home</Button>
        </div>
      </div>
    );
  }

  const renderQuestion = (question: Question) => {
    const currentAnswer = answers[question.id];

    switch (question.type) {
      case 'multiple_choice':
      case 'dropdown':
        return (
          <div className="space-y-3">
            {question.options?.map((option) => (
              <button
                key={option.id}
                onClick={() => handleAnswer(option.text)}
                className={cn(
                  'survey-option w-full text-left',
                  currentAnswer === option.text && 'survey-option-selected'
                )}
              >
                <div
                  className={cn(
                    'w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors',
                    currentAnswer === option.text
                      ? 'border-primary bg-primary'
                      : 'border-muted-foreground'
                  )}
                >
                  {currentAnswer === option.text && (
                    <Check className="w-3 h-3 text-primary-foreground" />
                  )}
                </div>
                <span className="flex-1">{option.text}</span>
              </button>
            ))}
          </div>
        );

      case 'checkbox':
        const selectedOptions = (currentAnswer as string[]) || [];
        return (
          <div className="space-y-3">
            {question.options?.map((option) => {
              const isSelected = selectedOptions.includes(option.text);
              return (
                <button
                  key={option.id}
                  onClick={() => {
                    const newSelected = isSelected
                      ? selectedOptions.filter((o) => o !== option.text)
                      : [...selectedOptions, option.text];
                    handleAnswer(newSelected);
                  }}
                  className={cn(
                    'survey-option w-full text-left',
                    isSelected && 'survey-option-selected'
                  )}
                >
                  <div
                    className={cn(
                      'w-5 h-5 rounded border-2 flex items-center justify-center transition-colors',
                      isSelected
                        ? 'border-primary bg-primary'
                        : 'border-muted-foreground'
                    )}
                  >
                    {isSelected && (
                      <Check className="w-3 h-3 text-primary-foreground" />
                    )}
                  </div>
                  <span className="flex-1">{option.text}</span>
                </button>
              );
            })}
          </div>
        );

      case 'text':
      case 'email':
      case 'number':
        return (
          <Input
            type={question.type === 'email' ? 'email' : question.type === 'number' ? 'number' : 'text'}
            value={(currentAnswer as string) || ''}
            onChange={(e) => handleAnswer(e.target.value)}
            placeholder={
              question.type === 'email'
                ? 'your@email.com'
                : question.type === 'number'
                  ? 'Enter a number'
                  : 'Type your answer here...'
            }
            className="text-lg h-14"
          />
        );

      case 'long_text':
        return (
          <Textarea
            value={(currentAnswer as string) || ''}
            onChange={(e) => handleAnswer(e.target.value)}
            placeholder="Type your answer here..."
            className="text-lg min-h-[150px]"
          />
        );

      case 'rating':
        const rating = (currentAnswer as number) || 0;
        return (
          <div className="flex gap-2 justify-center">
            {[1, 2, 3, 4, 5].map((star) => (
              <button
                key={star}
                onClick={() => handleAnswer(star)}
                className="p-2 transition-transform hover:scale-110"
              >
                <Star
                  className={cn(
                    'w-10 h-10 transition-colors',
                    star <= rating
                      ? 'fill-yellow-500 text-yellow-500'
                      : 'text-muted-foreground'
                  )}
                />
              </button>
            ))}
          </div>
        );

      case 'scale':
        const scaleValue = currentAnswer as number;
        return (
          <div className="space-y-4">
            <div className="flex justify-between text-sm text-muted-foreground">
              <span>{question.minLabel || 'Not at all'}</span>
              <span>{question.maxLabel || 'Extremely'}</span>
            </div>
            <div className="flex justify-between gap-2">
              {Array.from({ length: 10 }, (_, i) => i + 1).map((num) => (
                <button
                  key={num}
                  onClick={() => handleAnswer(num)}
                  className={cn(
                    'w-10 h-10 rounded-full border-2 flex items-center justify-center text-sm font-medium transition-all hover:scale-105',
                    scaleValue === num
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border hover:border-primary'
                  )}
                >
                  {num}
                </button>
              ))}
            </div>
          </div>
        );

      case 'date':
        return (
          <Input
            type="date"
            value={(currentAnswer as string) || ''}
            onChange={(e) => handleAnswer(e.target.value)}
            className="text-lg h-14 w-auto"
          />
        );

      default:
        return null;
    }
  };

  const isLastQuestion = currentIndex === questions.length - 1;

  return (
    <div className="min-h-screen bg-gradient-hero">
      <div className="fixed top-0 left-0 right-0 z-50">
        <Progress value={progress} className="h-1 rounded-none" />
      </div>

      <div className="container max-w-2xl py-16 px-4">
        <div className="mb-8">
          <h1 className="text-2xl font-bold mb-2">{survey.title}</h1>
          {survey.description && (
            <p className="text-muted-foreground">{survey.description}</p>
          )}
        </div>

        <div className="space-y-8 animate-fade-in" key={currentQuestion.id}>
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <span className="w-8 h-8 rounded-full bg-primary text-primary-foreground text-sm font-medium flex items-center justify-center shrink-0">
                {currentIndex + 1}
              </span>
              <div className="flex-1">
                <h2 className="text-xl font-semibold">
                  {currentQuestion.title || 'Untitled Question'}
                  {currentQuestion.required && (
                    <span className="text-destructive ml-1">*</span>
                  )}
                </h2>
                {currentQuestion.description && (
                  <p className="text-muted-foreground mt-1">
                    {currentQuestion.description}
                  </p>
                )}
              </div>
            </div>

            <div className="pl-11">{renderQuestion(currentQuestion)}</div>
          </div>

          {isLastQuestion && survey.collectEmail && (
            <div className="space-y-2 pl-11 pt-4 border-t border-border">
              <label className="text-sm font-medium">
                Email address
                <span className="text-destructive ml-1">*</span>
              </label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="your@email.com"
                className="h-12"
              />
            </div>
          )}
        </div>

        <div className="flex justify-between items-center mt-12 pt-8 border-t border-border">
          <Button
            variant="outline"
            onClick={handlePrevious}
            disabled={currentIndex === 0}
          >
            Previous
          </Button>

          <span className="text-sm text-muted-foreground">
            {currentIndex + 1} of {questions.length}
          </span>

          {isLastQuestion ? (
            <Button onClick={handleSubmit} size="lg">
              <Send className="w-4 h-4 mr-2" />
              Submit
            </Button>
          ) : (
            <Button onClick={handleNext}>
              Next
              <ChevronRight className="w-4 h-4 ml-2" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
