# TaskCalendar

**The all-in-one project management platform that helps your team plan, track, and ship.**

TaskCalendar is a modern web app for teams to manage projects, tasks, and collaboration in one place. It includes Kanban boards, calendars, timelines, file storage, comments, and reports—with optional subscriptions and a 28-day free trial.

---

## Short description (e.g. for GitHub repo or social)

> **TaskCalendar** — Plan, track, and ship with your team. Kanban boards, calendar, timeline, files, comments, and reports in one project management platform. Free trial included.

---

## Product / service description (for landing pages or docs)

**TaskCalendar** is a project and task management service built for teams that want to move fast and stay organized.

- **Projects & Kanban** — Create projects, drag-and-drop columns, and manage tasks from idea to done.
- **My Tasks** — See all tasks assigned to you across projects, add comments, and attach files.
- **Calendar** — View tasks and deadlines in a calendar.
- **Timeline overview** — See all projects on a single timeline with optional start/end dates.
- **Files** — Upload project files and see task comment attachments in one place.
- **Comments** — Discuss work on tasks with @mentions and attachments.
- **Team** — Invite members, manage roles, and see who’s on each project.
- **Reports** — Insights and charts on your work.
- **Contracts** — Central place for contract-related documents.
- **Notifications** — Task assignments, updates, due-date reminders, and comment activity.

The app supports **organizations**, **subscription plans** (with Stripe), and a **28-day free trial**. Authentication is handled via Firebase; data is stored in Supabase.

---

## Tech stack

- **Frontend:** React, TypeScript, Vite, Tailwind CSS, React Router
- **Auth:** Firebase Authentication
- **Backend / DB:** Supabase (PostgreSQL, Storage)
- **Payments:** Stripe
- **UI:** Radix UI, Framer Motion, Recharts, Lucide icons

---

## Getting started

1. Clone the repo and install dependencies: `npm install`
2. Copy `.env.example` to `.env` and add your Firebase and Supabase keys (and Stripe if using payments).
3. Run the dev server: `npm run dev`
4. Build for production: `npm run build`

---

*TaskCalendar — The modern project management platform for teams that move fast.*
