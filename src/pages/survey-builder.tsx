import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import {
  ArrowLeft,
  Eye,
  Share2,
  Settings,
  Plus,
  FileText,
  BarChart3,
  Link as LinkIcon,
  Check,
} from 'lucide-react';
import { useSurvey } from '@/store/survey-context';
import { QuestionCard } from '@/components/survey/question-card';
import { QuestionTypeSelector } from '@/components/survey/question-type-selector';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import type { Question } from '@/types/survey';
import { generateId, copyToClipboard } from '@/lib/utils';

export function SurveyBuilder() {
  const { id } = useParams<{ id: string; }>();
  const navigate = useNavigate();
  const {
    getSurveyById,
    updateSurvey,
    addQuestion,
    updateQuestion,
    deleteQuestion,
    reorderQuestions,
  } = useSurvey();

  const survey = getSurveyById(id || '');
  const [showShareDialog, setShowShareDialog] = useState(false);
  const [copied, setCopied] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  if (!survey) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-xl font-semibold mb-2">Survey not found</h2>
          <Button onClick={() => navigate('/')}>Go back home</Button>
        </div>
      </div>
    );
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = survey.questions.findIndex((q) => q.id === active.id);
      const newIndex = survey.questions.findIndex((q) => q.id === over.id);
      const newQuestions = arrayMove(survey.questions, oldIndex, newIndex);
      reorderQuestions(survey.id, newQuestions);
    }
  };

  const handleAddQuestion = (question: Question) => {
    addQuestion(survey.id, question);
  };

  const handleUpdateQuestion = (question: Question) => {
    updateQuestion(survey.id, question);
  };

  const handleDeleteQuestion = (questionId: string) => {
    deleteQuestion(survey.id, questionId);
  };

  const handleDuplicateQuestion = (question: Question) => {
    const duplicated: Question = {
      ...question,
      id: generateId(),
      options: question.options?.map((opt) => ({ ...opt, id: generateId() })),
    };
    addQuestion(survey.id, duplicated);
  };

  const handlePublish = () => {
    if (survey.questions.length === 0) {
      toast.error('Cannot publish', {
        description: 'Add at least one question before publishing.',
      });
      return;
    }
    updateSurvey({ ...survey, isPublished: true });
    setShowShareDialog(true);
    toast.success('Survey published', {
      description: 'Your survey is now live and ready to collect responses.',
    });
  };

  const surveyUrl = `${window.location.origin}/survey/${survey.id}`;

  const handleCopyLink = async () => {
    await copyToClipboard(surveyUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast('Link copied', {
      description: 'Survey link has been copied to clipboard.',
    });
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container flex h-16 items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => navigate('/')}>
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <div>
              <Input
                value={survey.title}
                onChange={(e) => updateSurvey({ ...survey, title: e.target.value })}
                className="text-lg font-semibold border-none shadow-none px-0 focus-visible:ring-0 h-auto bg-transparent"
                placeholder="Untitled Survey"
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() => navigate(`/survey/${survey.id}`)}
            >
              <Eye className="w-4 h-4 mr-2" />
              Preview
            </Button>
            <Button
              variant="outline"
              onClick={() => navigate(`/results/${survey.id}`)}
            >
              <BarChart3 className="w-4 h-4 mr-2" />
              Results
            </Button>
            {survey.isPublished ? (
              <Button onClick={() => setShowShareDialog(true)}>
                <Share2 className="w-4 h-4 mr-2" />
                Share
              </Button>
            ) : (
              <Button onClick={handlePublish}>
                Publish
              </Button>
            )}
          </div>
        </div>
      </header>

      <main className="container py-8">
        <Tabs defaultValue="questions" className="space-y-6">
          <TabsList>
            <TabsTrigger value="questions">
              <FileText className="w-4 h-4 mr-2" />
              Questions
            </TabsTrigger>
            <TabsTrigger value="settings">
              <Settings className="w-4 h-4 mr-2" />
              Settings
            </TabsTrigger>
          </TabsList>

          <TabsContent value="questions" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Plus className="w-5 h-5" />
                  Add Question
                </CardTitle>
              </CardHeader>
              <CardContent>
                <QuestionTypeSelector onSelect={handleAddQuestion} />
              </CardContent>
            </Card>

            {survey.questions.length === 0 ? (
              <div className="text-center py-16 border-2 border-dashed border-border rounded-xl">
                <FileText className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                <h3 className="text-lg font-medium mb-2">No questions yet</h3>
                <p className="text-muted-foreground">
                  Select a question type above to get started
                </p>
              </div>
            ) : (
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={survey.questions.map((q) => q.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <div className="space-y-4">
                    {survey.questions.map((question, index) => (
                      <div key={question.id} className="relative">
                        <div className="absolute -left-8 top-6 w-6 h-6 rounded-full bg-primary text-primary-foreground text-sm font-medium flex items-center justify-center">
                          {index + 1}
                        </div>
                        <QuestionCard
                          question={question}
                          onUpdate={handleUpdateQuestion}
                          onDelete={() => handleDeleteQuestion(question.id)}
                          onDuplicate={() => handleDuplicateQuestion(question)}
                        />
                      </div>
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            )}
          </TabsContent>

          <TabsContent value="settings" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Survey Details</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>Survey Title</Label>
                  <Input
                    value={survey.title}
                    onChange={(e) => updateSurvey({ ...survey, title: e.target.value })}
                    placeholder="Enter survey title"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Description</Label>
                  <Textarea
                    value={survey.description || ''}
                    onChange={(e) => updateSurvey({ ...survey, description: e.target.value })}
                    placeholder="Enter survey description"
                    rows={3}
                  />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Response Settings</CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>Collect email addresses</Label>
                    <p className="text-sm text-muted-foreground">
                      Ask respondents for their email before submitting
                    </p>
                  </div>
                  <Switch
                    checked={survey.collectEmail}
                    onCheckedChange={(checked) =>
                      updateSurvey({ ...survey, collectEmail: checked })
                    }
                  />
                </div>
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>Anonymous responses</Label>
                    <p className="text-sm text-muted-foreground">
                      Allow respondents to submit without identification
                    </p>
                  </div>
                  <Switch
                    checked={survey.isAnonymous}
                    onCheckedChange={(checked) =>
                      updateSurvey({ ...survey, isAnonymous: checked })
                    }
                  />
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>

      <Dialog open={showShareDialog} onOpenChange={setShowShareDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Share your survey</DialogTitle>
            <DialogDescription>
              Copy the link below to share your survey with respondents.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex gap-2">
              <Input value={surveyUrl} readOnly className="flex-1" />
              <Button onClick={handleCopyLink}>
                {copied ? (
                  <Check className="w-4 h-4" />
                ) : (
                  <LinkIcon className="w-4 h-4" />
                )}
              </Button>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowShareDialog(false)}>
                Close
              </Button>
              <Button onClick={() => navigate(`/survey/${survey.id}`)}>
                <Eye className="w-4 h-4 mr-2" />
                Preview Survey
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
