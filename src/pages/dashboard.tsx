import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus,
  FileText,
  Users,
  BarChart3,
  Trash2,
  Eye,
  Edit,
  Share2,
  Search,
} from 'lucide-react';
import { useSurvey } from '@/store/survey-context';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import { formatDate, formatNumber, copyToClipboard } from '@/lib/utils';
import { cn } from '@/lib/utils';
import { TaskCalendarLogo } from '@/components/brand/TaskCalendarLogo';

export function Dashboard() {
  const navigate = useNavigate();
  const { surveys, createSurvey, deleteSurvey } = useSurvey();

  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newSurveyTitle, setNewSurveyTitle] = useState('');
  const [newSurveyDescription, setNewSurveyDescription] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [surveyToDelete, setSurveyToDelete] = useState<string | null>(null);

  const filteredSurveys = surveys.filter(
    (survey) =>
      survey.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      survey.description?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleCreateSurvey = () => {
    if (!newSurveyTitle.trim()) {
      toast.error('Title required', {
        description: 'Please enter a title for your survey.',
      });
      return;
    }

    const survey = createSurvey(newSurveyTitle.trim(), newSurveyDescription.trim() || undefined);
    setShowCreateDialog(false);
    setNewSurveyTitle('');
    setNewSurveyDescription('');
    navigate(`/builder/${survey.id}`);

    toast.success('Survey created', {
      description: 'Start adding questions to your new survey.',
    });
  };

  const handleDeleteSurvey = () => {
    if (surveyToDelete) {
      deleteSurvey(surveyToDelete);
      setSurveyToDelete(null);
      toast('Survey deleted', {
        description: 'The survey has been permanently deleted.',
      });
    }
  };

  const handleShareSurvey = async (surveyId: string) => {
    const url = `${window.location.origin}/survey/${surveyId}`;
    await copyToClipboard(url);
    toast('Link copied', {
      description: 'Survey link has been copied to clipboard.',
    });
  };

  const totalResponses = surveys.reduce((acc, s) => acc + s.responseCount, 0);
  const publishedCount = surveys.filter((s) => s.isPublished).length;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="container py-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <TaskCalendarLogo sizeClass="h-10 w-10" />
              <div>
                <h1 className="text-2xl font-bold">TaskCalendar</h1>
                <p className="text-sm text-muted-foreground">Tasks and surveys made simple</p>
              </div>
            </div>
            <Button onClick={() => setShowCreateDialog(true)} size="lg">
              <Plus className="w-5 h-5 mr-2" />
              New Survey
            </Button>
          </div>
        </div>
      </header>

      <main className="container py-8">
        <div className="grid sm:grid-cols-3 gap-4 mb-8">
          <Card className="stat-card">
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <div className="p-3 rounded-xl bg-primary/10">
                  <FileText className="w-6 h-6 text-primary" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{formatNumber(surveys.length)}</p>
                  <p className="text-sm text-muted-foreground">Total Surveys</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="stat-card">
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <div className="p-3 rounded-xl bg-accent/10">
                  <Users className="w-6 h-6 text-accent" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{formatNumber(totalResponses)}</p>
                  <p className="text-sm text-muted-foreground">Total Responses</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="stat-card">
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <div className="p-3 rounded-xl bg-success/10">
                  <BarChart3 className="w-6 h-6 text-success" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{formatNumber(publishedCount)}</p>
                  <p className="text-sm text-muted-foreground">Published</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="flex items-center gap-4 mb-6">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search surveys..."
              className="pl-10"
            />
          </div>
        </div>

        {filteredSurveys.length === 0 ? (
          <div className="text-center py-16 border-2 border-dashed border-border rounded-xl">
            <FileText className="w-16 h-16 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-xl font-semibold mb-2">
              {searchQuery ? 'No surveys found' : 'No surveys yet'}
            </h3>
            <p className="text-muted-foreground mb-6 max-w-md mx-auto">
              {searchQuery
                ? 'Try a different search term'
                : 'Create your first survey to start collecting responses and insights from your audience.'}
            </p>
            {!searchQuery && (
              <Button onClick={() => setShowCreateDialog(true)} size="lg">
                <Plus className="w-5 h-5 mr-2" />
                Create your first survey
              </Button>
            )}
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredSurveys.map((survey, index) => (
              <Card
                key={survey.id}
                className="group hover:shadow-card-hover hover:border-primary/20 transition-all duration-300 animate-fade-in"
                style={{ animationDelay: `${index * 0.05}s` }}
              >
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold truncate group-hover:text-primary transition-colors">
                        {survey.title || 'Untitled Survey'}
                      </h3>
                      <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                        {survey.description || 'No description'}
                      </p>
                    </div>
                    <div
                      className={cn(
                        'px-2 py-1 rounded-full text-xs font-medium',
                        survey.isPublished
                          ? 'bg-success/10 text-success'
                          : 'bg-secondary text-muted-foreground'
                      )}
                    >
                      {survey.isPublished ? 'Published' : 'Draft'}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="pb-3">
                  <div className="flex items-center gap-4 text-sm text-muted-foreground">
                    <div className="flex items-center gap-1">
                      <FileText className="w-4 h-4" />
                      <span>{survey.questions.length} questions</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Users className="w-4 h-4" />
                      <span>{survey.responseCount} responses</span>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground mt-3">
                    Updated {formatDate(survey.updatedAt)}
                  </p>
                </CardContent>
                <CardFooter className="pt-3 border-t border-border">
                  <div className="flex items-center gap-2 w-full">
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1"
                      onClick={() => navigate(`/builder/${survey.id}`)}
                    >
                      <Edit className="w-4 h-4 mr-1" />
                      Edit
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => navigate(`/survey/${survey.id}`)}
                    >
                      <Eye className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => navigate(`/results/${survey.id}`)}
                    >
                      <BarChart3 className="w-4 h-4" />
                    </Button>
                    {survey.isPublished && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleShareSurvey(survey.id)}
                      >
                        <Share2 className="w-4 h-4" />
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      onClick={() => setSurveyToDelete(survey.id)}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </CardFooter>
              </Card>
            ))}
          </div>
        )}
      </main>

      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create new survey</DialogTitle>
            <DialogDescription>
              Give your survey a title and description to get started.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Title</label>
              <Input
                value={newSurveyTitle}
                onChange={(e) => setNewSurveyTitle(e.target.value)}
                placeholder="e.g., Customer Feedback Survey"
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Description (optional)</label>
              <Input
                value={newSurveyDescription}
                onChange={(e) => setNewSurveyDescription(e.target.value)}
                placeholder="Brief description of your survey"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreateSurvey}>Create Survey</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!surveyToDelete} onOpenChange={() => setSurveyToDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete survey?</DialogTitle>
            <DialogDescription>
              This action cannot be undone. All questions and responses will be permanently deleted.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSurveyToDelete(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDeleteSurvey}>
              Delete Survey
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
