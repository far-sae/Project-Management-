import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Download,
  Users,
  BarChart3,
  Clock,
  FileText,
} from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import { useSurvey } from '@/store/survey-context';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import type { Question, Answer } from '@/types/survey';
import { formatDate, formatNumber } from '@/lib/utils';

const CHART_COLORS = [
  'hsl(251, 91%, 60%)',
  'hsl(172, 66%, 50%)',
  'hsl(142, 76%, 36%)',
  'hsl(38, 92%, 50%)',
  'hsl(0, 84%, 60%)',
  'hsl(280, 65%, 60%)',
  'hsl(200, 65%, 50%)',
  'hsl(330, 65%, 50%)',
];

export function SurveyResults() {
  const { id } = useParams<{ id: string; }>();
  const navigate = useNavigate();
  const { getSurveyById, getResponsesBySurveyId } = useSurvey();

  const survey = getSurveyById(id || '');
  const responses = getResponsesBySurveyId(id || '');

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

  const getAnswersForQuestion = (questionId: string): Answer[] => {
    return responses.flatMap((r) =>
      r.answers.filter((a) => a.questionId === questionId)
    );
  };

  const getChartData = (question: Question) => {
    const answers = getAnswersForQuestion(question.id);

    if (['multiple_choice', 'checkbox', 'dropdown'].includes(question.type)) {
      const counts: Record<string, number> = {};
      question.options?.forEach((opt) => {
        counts[opt.text] = 0;
      });

      answers.forEach((answer) => {
        if (Array.isArray(answer.value)) {
          answer.value.forEach((v) => {
            if (counts[v] !== undefined) counts[v]++;
          });
        } else if (typeof answer.value === 'string' && counts[answer.value] !== undefined) {
          counts[answer.value]++;
        }
      });

      return Object.entries(counts).map(([name, value]) => ({ name, value }));
    }

    if (question.type === 'rating') {
      const counts: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
      answers.forEach((answer) => {
        const val = answer.value as number;
        if (counts[val] !== undefined) counts[val]++;
      });
      return Object.entries(counts).map(([stars, value]) => ({
        name: `${stars} Star${stars !== '1' ? 's' : ''}`,
        value,
      }));
    }

    if (question.type === 'scale') {
      const counts: Record<number, number> = {};
      for (let i = 1; i <= 10; i++) counts[i] = 0;
      answers.forEach((answer) => {
        const val = answer.value as number;
        if (counts[val] !== undefined) counts[val]++;
      });
      return Object.entries(counts).map(([num, value]) => ({ name: num, value }));
    }

    return [];
  };

  const getTextResponses = (questionId: string): string[] => {
    const answers = getAnswersForQuestion(questionId);
    return answers
      .map((a) => a.value as string)
      .filter((v) => v && typeof v === 'string');
  };

  const getAverageRating = (questionId: string): number => {
    const answers = getAnswersForQuestion(questionId);
    const values = answers
      .map((a) => a.value as number)
      .filter((v) => typeof v === 'number');
    if (values.length === 0) return 0;
    return values.reduce((a, b) => a + b, 0) / values.length;
  };

  const exportToCSV = () => {
    const headers = ['Response ID', 'Submitted At', 'Email', ...survey.questions.map((q) => q.title || 'Untitled')];
    const rows = responses.map((response) => {
      const row: string[] = [
        response.id,
        formatDate(response.submittedAt),
        response.email || 'Anonymous',
      ];
      survey.questions.forEach((question) => {
        const answer = response.answers.find((a) => a.questionId === question.id);
        if (!answer) {
          row.push('');
        } else if (Array.isArray(answer.value)) {
          row.push(answer.value.join('; '));
        } else {
          row.push(String(answer.value));
        }
      });
      return row;
    });

    const csvContent = [headers, ...rows]
      .map((row) => row.map((cell) => `"${cell}"`).join(','))
      .join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${survey.title.replace(/[^a-z0-9]/gi, '_')}_responses.csv`;
    link.click();

    toast.success('Export successful', {
      description: 'Survey responses have been exported to CSV.',
    });
  };

  const renderQuestionResults = (question: Question, index: number) => {
    const chartData = getChartData(question);
    const answers = getAnswersForQuestion(question.id);

    return (
      <Card key={question.id} className="animate-fade-in" style={{ animationDelay: `${index * 0.1}s` }}>
        <CardHeader>
          <div className="flex items-start justify-between">
            <div className="flex items-start gap-3">
              <span className="w-8 h-8 rounded-full bg-primary text-primary-foreground text-sm font-medium flex items-center justify-center shrink-0">
                {index + 1}
              </span>
              <div>
                <CardTitle className="text-lg">
                  {question.title || 'Untitled Question'}
                </CardTitle>
                <p className="text-sm text-muted-foreground mt-1">
                  {answers.length} response{answers.length !== 1 ? 's' : ''}
                </p>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {['multiple_choice', 'dropdown'].includes(question.type) && chartData.length > 0 && (
            <div className="grid md:grid-cols-2 gap-6">
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                    <YAxis allowDecimals={false} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'hsl(var(--card))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '8px',
                      }}
                    />
                    <Bar dataKey="value" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={chartData.filter((d) => d.value > 0)}
                      cx="50%"
                      cy="50%"
                      innerRadius={40}
                      outerRadius={80}
                      paddingAngle={2}
                      dataKey="value"
                      label={({ name, percent }) => `${name} (${(percent * 100).toFixed(0)}%)`}
                      labelLine={false}
                    >
                      {chartData.map((_, idx) => (
                        <Cell key={idx} fill={CHART_COLORS[idx % CHART_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {question.type === 'checkbox' && chartData.length > 0 && (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis type="number" allowDecimals={false} />
                  <YAxis type="category" dataKey="name" width={150} tick={{ fontSize: 12 }} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'hsl(var(--card))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '8px',
                    }}
                  />
                  <Bar dataKey="value" fill="hsl(var(--accent))" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {(question.type === 'rating' || question.type === 'scale') && (
            <div className="space-y-4">
              <div className="text-center p-6 bg-secondary rounded-xl">
                <p className="text-sm text-muted-foreground mb-1">Average</p>
                <p className="text-4xl font-bold text-primary">
                  {getAverageRating(question.id).toFixed(1)}
                </p>
                <p className="text-sm text-muted-foreground">
                  out of {question.type === 'rating' ? 5 : 10}
                </p>
              </div>
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="name" />
                    <YAxis allowDecimals={false} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'hsl(var(--card))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '8px',
                      }}
                    />
                    <Bar dataKey="value" fill="hsl(var(--warning))" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {['text', 'long_text', 'email', 'number', 'date'].includes(question.type) && (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {getTextResponses(question.id).length === 0 ? (
                <p className="text-muted-foreground text-center py-8">No responses yet</p>
              ) : (
                getTextResponses(question.id).map((response, idx) => (
                  <div
                    key={idx}
                    className="p-3 bg-secondary rounded-lg text-sm"
                  >
                    {response}
                  </div>
                ))
              )}
            </div>
          )}
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container flex h-16 items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => navigate(`/builder/${survey.id}`)}>
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <div>
              <h1 className="font-semibold">{survey.title}</h1>
              <p className="text-sm text-muted-foreground">Results & Analytics</p>
            </div>
          </div>

          <Button onClick={exportToCSV} disabled={responses.length === 0}>
            <Download className="w-4 h-4 mr-2" />
            Export CSV
          </Button>
        </div>
      </header>

      <main className="container py-8">
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <Card className="stat-card">
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <div className="p-3 rounded-xl bg-primary/10">
                  <Users className="w-6 h-6 text-primary" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{formatNumber(responses.length)}</p>
                  <p className="text-sm text-muted-foreground">Total Responses</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="stat-card">
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <div className="p-3 rounded-xl bg-accent/10">
                  <FileText className="w-6 h-6 text-accent" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{survey.questions.length}</p>
                  <p className="text-sm text-muted-foreground">Questions</p>
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
                  <p className="text-2xl font-bold">
                    {responses.length > 0
                      ? Math.round(
                        (responses.reduce(
                          (acc, r) => acc + r.answers.length,
                          0
                        ) /
                          (responses.length * survey.questions.length)) *
                        100
                      )
                      : 0}
                    %
                  </p>
                  <p className="text-sm text-muted-foreground">Completion Rate</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="stat-card">
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <div className="p-3 rounded-xl bg-warning/10">
                  <Clock className="w-6 h-6 text-warning" />
                </div>
                <div>
                  <p className="text-2xl font-bold">
                    {responses.length > 0
                      ? formatDate(responses[responses.length - 1].submittedAt)
                      : 'N/A'}
                  </p>
                  <p className="text-sm text-muted-foreground">Last Response</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <Tabs defaultValue="summary">
          <TabsList>
            <TabsTrigger value="summary">Summary</TabsTrigger>
            <TabsTrigger value="individual">Individual Responses</TabsTrigger>
          </TabsList>

          <TabsContent value="summary" className="space-y-6 mt-6">
            {survey.questions.length === 0 ? (
              <div className="text-center py-16 border-2 border-dashed border-border rounded-xl">
                <FileText className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                <h3 className="text-lg font-medium mb-2">No questions yet</h3>
                <p className="text-muted-foreground mb-4">
                  Add questions to your survey to see results
                </p>
                <Button onClick={() => navigate(`/builder/${survey.id}`)}>
                  Go to Survey Builder
                </Button>
              </div>
            ) : (
              survey.questions.map((question, index) =>
                renderQuestionResults(question, index)
              )
            )}
          </TabsContent>

          <TabsContent value="individual" className="mt-6">
            {responses.length === 0 ? (
              <div className="text-center py-16 border-2 border-dashed border-border rounded-xl">
                <Users className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                <h3 className="text-lg font-medium mb-2">No responses yet</h3>
                <p className="text-muted-foreground">
                  Share your survey to start collecting responses
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {responses.map((response, idx) => (
                  <Card key={response.id}>
                    <CardHeader>
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-base">
                          Response #{idx + 1}
                        </CardTitle>
                        <div className="text-sm text-muted-foreground">
                          {formatDate(response.submittedAt)}
                          {response.email && ` • ${response.email}`}
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-4">
                        {survey.questions.map((question) => {
                          const answer = response.answers.find(
                            (a) => a.questionId === question.id
                          );
                          return (
                            <div key={question.id}>
                              <p className="text-sm font-medium text-muted-foreground">
                                {question.title || 'Untitled Question'}
                              </p>
                              <p className="mt-1">
                                {answer
                                  ? Array.isArray(answer.value)
                                    ? answer.value.join(', ')
                                    : String(answer.value)
                                  : '-'}
                              </p>
                            </div>
                          );
                        })}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
