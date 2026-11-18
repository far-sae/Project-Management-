// Dev-only page (/__preview) that renders the shared UI pieces with fixture
// data, so the look can be checked in a browser without signing in. It is
// only routed when `import.meta.env.DEV` is true and is not part of the
// production bundle.
import React from 'react';
import { DndContext } from '@dnd-kit/core';
import { Download, Filter, MoreHorizontal, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { PageHeader } from '@/components/common/PageHeader';
import { StatStrip } from '@/components/common/StatStrip';
import { StatusPill } from '@/components/common/StatusPill';
import { PriorityPill, UrgentBadge } from '@/components/common/TaskBadges';
import { KanbanColumn } from '@/components/kanban/KanbanColumn';
import { AppHeader } from '@/components/layout/AppHeader';
import type { Task } from '@/types';

const person = (id: string, name: string) => ({ userId: id, displayName: name, email: `${id}@example.com` });

const task = (id: string, title: string, o: Record<string, unknown> = {}): Task =>
  ({
    taskId: id,
    projectId: 'p1',
    organizationId: 'o1',
    title,
    description: '',
    status: 'todo',
    priority: 'medium',
    dueDate: null,
    assignees: [],
    position: 0,
    attachments: [],
    commentsCount: 0,
    createdBy: 'me',
    createdAt: new Date(),
    updatedAt: new Date(),
    completedAt: null,
    ...o,
  }) as unknown as Task;

const day = (offset: number) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d;
};

const COLUMNS = [
  {
    id: 'todo',
    title: 'To-do',
    color: '#8f8f8f',
    tasks: [
      task('t1', 'Write homepage copy', {
        urgent: true,
        priority: 'high',
        dueDate: day(1),
        commentsCount: 4,
        tags: ['Content'],
        assignees: [person('a', 'Aisha'), person('s', 'Sara')],
      }),
      task('t2', 'Plan the pricing page layout', {
        priority: 'medium',
        subtasks: [
          { id: '1', title: 'a', completed: true },
          { id: '2', title: 'b', completed: false },
          { id: '3', title: 'c', completed: false },
        ],
        assignees: [person('s', 'Sara')],
      }),
      task('t3', 'Collect client logos for the footer', {
        priority: 'low',
        dueDate: day(3),
        assignees: [person('m', 'Mo')],
      }),
    ],
  },
  {
    id: 'inprogress',
    title: 'In progress',
    color: '#2563eb',
    tasks: [
      task('t4', 'Build the new navigation menu', {
        status: 'inprogress',
        urgent: true,
        priority: 'high',
        dueDate: day(0),
        commentsCount: 6,
        tags: ['Frontend'],
        description: 'Replace the old dropdown with the new top bar from the design file.',
        assignees: [person('f', 'Faye'), person('m', 'Mo')],
      }),
      task('t5', 'Set up the contact form', {
        status: 'inprogress',
        priority: 'high',
        dueDate: day(-1),
        commentsCount: 2,
        assignees: [person('m', 'Mo')],
      }),
      task('t6', 'Design the blog post template', {
        status: 'inprogress',
        priority: 'low',
        isLocked: true,
        createdBy: 'me',
        tags: ['Design'],
      }),
    ],
  },
  { id: 'review', title: 'In review', color: '#9333ea', tasks: [] },
  {
    id: 'done',
    title: 'Done',
    color: '#16a34a',
    tasks: [
      task('t7', 'Move the domain to the new host', {
        status: 'done',
        urgent: true,
        priority: 'high',
        commentsCount: 5,
        assignees: [person('f', 'Faye')],
      }),
    ],
  },
];

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <section className="flex flex-col gap-3">
    <h2 className="text-base font-semibold">{title}</h2>
    {children}
  </section>
);

const DesignPreview: React.FC = () => {
  const [dark, setDark] = React.useState(() => new URLSearchParams(window.location.search).has('dark'));
  React.useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    return () => document.documentElement.classList.remove('dark');
  }, [dark]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <AppHeader
        left={<span className="text-sm font-semibold">Design preview</span>}
        right={
          <Button variant="outline" onClick={() => setDark((d) => !d)}>
            {dark ? 'Light' : 'Dark'}
          </Button>
        }
      />
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-6 lg:px-6">
        <PageHeader
          title="Attendance"
          description="When your team clocked in and out. Anyone still clocked in after 9 hours is clocked out automatically."
          actions={
            <>
              <Button variant="ghost">Today</Button>
              <Button variant="outline">New workspace</Button>
              <Button>
                <Plus />
                New project
              </Button>
            </>
          }
        />

        <StatStrip
          items={[
            { label: 'Due today', value: 4, note: 'In this workspace' },
            { label: 'My tasks', value: 12, note: 'Assigned to you' },
            { label: 'Upcoming', value: 8, note: 'Next deadlines' },
            { label: 'Overdue', value: 2, note: 'Needs attention', tone: 'danger' },
          ]}
        />

        <Section title="Buttons">
          <div className="flex flex-wrap items-center gap-2">
            <Button>
              <Plus />
              New task
            </Button>
            <Button variant="outline">Cancel</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="ghost">Today</Button>
            <Button variant="destructive">Delete task</Button>
            <Button disabled>Disabled</Button>
            <Button variant="link">Link</Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm">Comment</Button>
            <Button>Save changes</Button>
            <Button size="lg">Create project</Button>
            <Button variant="outline">
              <Filter />
              Filter
            </Button>
            <Button variant="outline" size="icon" aria-label="Export">
              <Download />
            </Button>
            <Button variant="ghost" size="icon" aria-label="More">
              <MoreHorizontal />
            </Button>
            <Button variant="ghost" size="icon" aria-label="Close">
              <X />
            </Button>
          </div>
        </Section>

        <Section title="Fields">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              Project name
              <Input defaultValue="Website relaunch" />
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              Workspace
              <Select defaultValue="all">
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All workspaces</SelectItem>
                  <SelectItem value="one">Design team</SelectItem>
                </SelectContent>
              </Select>
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-medium sm:col-span-2">
              Description
              <Textarea placeholder="Add a description, link, or note…" />
            </label>
            <div className="flex items-center gap-6 text-sm">
              <label className="flex items-center gap-2">
                <Switch defaultChecked /> Lock with PIN
              </label>
              <label className="flex items-center gap-2">
                <Switch /> Urgent
              </label>
            </div>
          </div>
        </Section>

        <Section title="Badges and tabs">
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill tone="success" pulse>
              On the clock
            </StatusPill>
            <StatusPill tone="neutral">Clocked out</StatusPill>
            <StatusPill tone="warning">Auto clocked out (9h)</StatusPill>
            <StatusPill tone="danger">Overdue</StatusPill>
            <StatusPill tone="info">Finalized</StatusPill>
            <StatusPill tone="muted">Not clocked in</StatusPill>
            <UrgentBadge />
            <PriorityPill priority="high" />
            <PriorityPill priority="medium" />
            <PriorityPill priority="low" />
            <Badge>Default</Badge>
            <Badge variant="secondary">Secondary</Badge>
            <Badge variant="outline">Outline</Badge>
          </div>
          <Tabs defaultValue="overview">
            <TabsList>
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="activity">Activity</TabsTrigger>
              <TabsTrigger value="expenses">Expenses</TabsTrigger>
            </TabsList>
            <TabsContent value="overview">
              <Card>
                <CardHeader>
                  <CardTitle>Card title</CardTitle>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground">
                  Cards use a border, 8px corners and no shadow.
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </Section>

        <Section title="Kanban">
          <DndContext>
            <div className="flex h-[30rem] gap-3 overflow-x-auto">
              {COLUMNS.map((c) => (
                <KanbanColumn
                  key={c.id}
                  id={c.id}
                  title={c.title}
                  color={c.color}
                  tasks={c.tasks}
                  onAddTask={() => undefined}
                  onEditColumn={() => undefined}
                  onInlineAdd={() => undefined}
                  onMarkDone={() => undefined}
                />
              ))}
            </div>
          </DndContext>
        </Section>
      </div>
    </div>
  );
};

export default DesignPreview;
