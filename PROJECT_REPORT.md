# HomeApp – Project Report & Requirements Analysis

**Date:** February 1, 2025  
**Version:** Based on codebase analysis

---

## 1. Project Overview

### 1.1 What Is This Project?

**HomeApp** (package name: `survey-platform`) is a **project management and collaboration application** built with React, Firebase, and modern web technologies. It functions as a Redbooth/Trello-style workspace with Kanban boards, task management, team collaboration, and subscription billing.

### 1.2 Technology Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 18, Vite, TypeScript |
| UI | Tailwind CSS, Radix UI, Lucide icons |
| Backend / Data | Firebase (Firestore, Auth, Storage, Cloud Functions) |
| Payments | Stripe (subscription checkout) |
| Charts | Recharts |
| Drag & Drop | @dnd-kit |

### 1.3 Core Features (Current Capabilities)

| Feature | Description |
|---------|-------------|
| **Authentication** | Login, Signup, Firebase Auth |
| **Organizations** | Multi-tenancy with organization context, members, roles (owner/admin/member) |
| **Workspaces** | Group projects by workspace (Default + custom workspaces). Edit and delete workspaces supported. |
| **Projects** | Create, delete projects; Kanban boards with custom columns |
| **Tasks** | Create, edit, delete tasks; status columns (To-do, In Progress, Done, Need Review); assignees, priority, due dates, subtasks, tags, attachments |
| **Comments** | Add comments on tasks with attachments; time spent tracking |
| **My Tasks** | Personal task list, filter by status |
| **Team** | Invite members to projects, manage invitations |
| **Calendar** | Task due dates in calendar view |
| **Files** | Upload/download project files; Firebase Storage |
| **Contracts** | Create, edit, delete contracts (title, client, status, value, dates) |
| **Reports** | Workspace-filtered analytics: project/task counts, completion rate, status breakdown, workload by user, time tracking, workspace stats |
| **Timeline** | Gantt-style timeline of tasks by due date |
| **Settings** | User profile, organization settings, subscription management |
| **Subscription** | 7-day trial, Economy/Standard/Premium tiers, Stripe checkout, cancel-at-period-end |

### 1.4 Routes & Access

- **Protected routes** (require subscription): Dashboard, Project, My Tasks, Team, Calendar, Files, Comments, Contracts, Reports, Timeline, Settings  
- **Public:** Login, Signup, Pricing  
- **Admin:** `/admin` for trial tracking, user analytics, revenue metrics  

---

## 2. Requirements Analysis – Your 11 Points

### 2.1 Workspace Button to View All Workspaces at Once

**Status:** ❌ **Not Implemented**

**Current behavior:**  
- Dashboard shows a **Workspace** dropdown that filters projects by selected workspace.  
- There is no dedicated “View All Workspaces” page or modal that lists all workspaces in one view (cards, grid, or list).

**Recommendation:**  
- Add a **“All Workspaces”** or **“Workspaces”** button/link that opens a modal or navigates to a page.  
- Show all workspaces with: name, project count, task count, quick actions (Edit, Delete, Open).  
- Consider reusing the `ALL_WORKSPACES_ID` pattern from Reports for aggregation.

---

### 2.2 Project Names Need to Be Editable

**Status:** ⚠️ **Backend Ready, UI Missing**

**Current behavior:**  
- `updateProject` exists in Firestore and `editProject` in `useProjects`.  
- Project names are displayed in Dashboard, ProjectView, Team, Files, etc., but there is **no inline edit or Edit Project modal** in the UI.  
- Projects can only be created or deleted, not renamed in the app.

**Recommendation:**  
- Add an **Edit** option in the project dropdown (Dashboard) and in ProjectView header.  
- Open a simple modal or inline field to edit `name` and `description`, then call `editProject`.

---

### 2.3 UI Needs to Be More User Friendly

**Status:** ⚠️ **Subjective – Room for Improvement**

**Current behavior:**  
- Functional UI with cards, modals, dropdowns, and consistent styling.  
- Some areas could be clearer: empty states, loading states, error feedback, mobile layout.

**Recommendations:**  
- **Empty states:** Clear “Get started” messages and CTAs where lists are empty.  
- **Feedback:** Toasts for success/error on create/update/delete.  
- **Loading:** Skeletons or spinners for lists and heavy views.  
- **Navigation:** Clearer sidebar labels, breadcrumbs where helpful.  
- **Accessibility:** ARIA labels, keyboard shortcuts for frequent actions.  
- **Mobile:** Responsive grids and touch targets.  
- **Onboarding:** Optional first-time walkthrough or tips.

---

### 2.4 Assign Task Is Not Working

**Status:** ⚠️ **Likely Data / Configuration Issue**

**Current behavior:**  
- Task modal has an **“+ Assign”** dropdown using `project?.members || organization?.members`.  
- If both are empty, it falls back to `[user]` (current user only).  
- Assignees are saved with `updateTask` and notifications are created when assignees change.

**Possible causes:**  
1. **Project members empty:** Projects get members when users accept invitations. Solo users may have no project members beyond the owner.  
2. **Organization members empty:** For local workspace (`local-{userId}`) or new orgs, `organization.members` may be minimal.  
3. **Invitation flow:** Members must be invited via Team page and accept invites before they appear in the assignee list.  
4. **Data structure:** `Project.members` and `Organization.members` use `userId`, `displayName`, `photoURL` – must be populated correctly.

**Recommendations:**  
- Ensure the owner is always included in `project.members` when creating/loading projects.  
- Add org-level members to the assignee pool when project members are empty.  
- Improve fallback: if no members, show “Invite team members first” with a link to Team page.  
- Add logging or debug info to confirm which members list is used and why it’s empty.

---

### 2.5 Comment Attachments – Image/PDF Preview Inside Comment Box

**Status:** ❌ **Not Implemented**

**Current behavior:**  
- Comments with attachments show a link (`<a href={fileUrl}>`) with a paperclip icon and filename.  
- Clicking opens the file in a new tab. No inline preview for images or PDFs.

**Recommendation:**  
- Detect file type from `fileName` or MIME (e.g. `image/*`, `.pdf`).  
- **Images:** Render an `<img>` thumbnail (e.g. 120×120px) inside the comment box; click to enlarge.  
- **PDFs:** Option A: Show first-page preview via canvas or an embedded viewer. Option B: Small PDF icon + “View PDF” button that opens in modal.  
- Keep the existing download link for non-previewable files.

---

### 2.6 Contracts System Not Creating Contracts

**Status:** ⚠️ **Needs Investigation**

**Current behavior:**  
- Contracts service supports create/update/delete with Firestore and localStorage fallback.  
- Creation requires `orgId`, `title`, `client`, and optional status, value, dates.  
- Protected route requires an active subscription.

**Possible causes:**  
1. **Subscription blocking:** If trial/plan is expired, user is redirected to `/pricing` before reaching Contracts.  
2. **`orgId` resolution:** `orgId` from `organization?.organizationId || user?.organizationId || local-{userId}` may be empty or wrong.  
3. **Firestore rules:** Rules may block writes to the `contracts` collection.  
4. **`checkConnection()`:** If it fails or times out, the service falls back to localStorage; if localStorage key differs or is cleared, contracts may appear missing.  
5. **Form validation:** Create form requires `title` and `client`; other fields can be empty.

**Recommendations:**  
- Log `orgId` and `createContract` result/errors in the UI.  
- Check Firestore rules for `contracts` and `organizationId`.  
- Skip or shorten `checkConnection()` for contracts (as done for workspaces) to avoid slow creation.  
- Verify localStorage key `pm_contracts` and fallback behavior.

---

### 2.7 PDF/Image View as Popup on One Click

**Status:** ❌ **Not Implemented**

**Current behavior:**  
- Files page shows file cards with Download and Delete on hover.  
- Clicking a file does not open a viewer; users must use Download.  
- Images get a small thumbnail in grid view, but no full-size or modal view.

**Recommendation:**  
- Add a **lightbox/modal viewer** for images and PDFs.  
- On file click:  
  - **Images:** Open modal with full-size image, optional zoom/pan.  
  - **PDFs:** Use an in-browser PDF viewer (e.g. `react-pdf` or `<embed>`) in a modal.  
- Keep Download and Delete as secondary actions in the modal or on the card.

---

### 2.8 Upgrade Plan System Needs to Work Properly

**Status:** ⚠️ **Partially Implemented – Depends on Setup**

**Current behavior:**  
- Pricing page with Economy/Standard/Premium; monthly/yearly billing.  
- Checkout flow uses Stripe: calls `createCheckoutSessionHttp` (HTTP) or `createCheckoutSession` (callable).  
- If both fail, it can fall back to a simulated activation (direct Firestore update).  
- Trial banner, subscription status, and “cancel at period end” exist in Settings.

**Known issues (from prior work):**  
- CORS errors when calling Cloud Functions from the frontend.  
- Stripe Price IDs must be configured in Firebase config / environment.  
- Cloud Functions must be built and deployed.

**Recommendations:**  
- Ensure `STRIPE_SECRET_KEY` and price IDs are set in Firebase Functions environment.  
- Deploy the HTTP function with correct CORS headers.  
- Test with Stripe test mode before going live.  
- Add clear error messages when checkout fails (e.g. “Payment unavailable – please try again or contact support”).

---

### 2.9 Mindmap Per Project (New Feature)

**Status:** ❌ **Not Implemented**

**Current behavior:**  
- No mindmap exists in the project.  
- Tasks are shown as Kanban cards, list views, calendar, and timeline.

**Requirements (from your description):**  
- A mindmap view per project.  
- Live updates when tasks are created/updated.  
- Tasks visible as nodes; clicking opens a task popup.  
- Zoom in/out with scroll.  
- Functional and navigable.

**Recommendation:**  
- Add a **“Mindmap”** tab or view in ProjectView.  
- Use a library such as:  
  - **React Flow** (nodes/edges, zoom, pan)  
  - **D3.js** (custom layouts)  
  - **react-mindmap** or similar  
- Model: nodes = tasks; edges = parent/subtask or project→task.  
- Subscribe to task changes for live updates.  
- Implement zoom (scroll wheel) and a modal/drawer for task details on node click.

---

### 2.10 Workspace Name Editable or Deletable

**Status:** ✅ **Implemented**

**Current behavior:**  
- Workspaces can be edited and deleted from the Dashboard.  
- When a non-default workspace is selected, a **⋮** menu appears with **Edit workspace** and **Delete workspace**.  
- Edit opens a modal to change the name.  
- Delete asks for confirmation and switches to Default if needed.  
- The Default workspace cannot be deleted.

---

### 2.11 Business Reporting System

**Status:** ⚠️ **Partial – Task/Project Analytics Only**

**Current behavior:**  
- Reports page includes:  
  - Total projects, tasks, completed tasks, completion rate  
  - Status breakdown (Undefined, To-do, In Progress, Done, Need Review)  
  - Workload by user  
  - Time tracking (from comments)  
  - Workspace stats (projects, tasks per workspace)  
  - Recent tasks  
- Workspace filter: All workspaces or a specific workspace.

**Missing for “business” reporting:**  
- Contract value and status  
- Client/revenue metrics  
- Budget vs. actual  
- Profit/loss, invoicing  
- Export (PDF, Excel, CSV)

**Recommendations:**  
- Add a **Business Reports** section or tab with:  
  - Contract summary (count, total value, by status/client)  
  - Revenue or value over time  
  - Optional: client/project profitability  
- Add export (e.g. CSV/Excel for raw data, PDF for summaries).  
- Optionally integrate with external tools (e.g. accounting software) later.

---

## 3. Summary Table

| # | Requirement | Status | Effort |
|---|-------------|--------|--------|
| 1 | Workspace button – view all workspaces | ❌ Not done | Medium |
| 2 | Editable project names | ⚠️ Backend ready | Low |
| 3 | More user-friendly UI | ⚠️ Partial | Medium–High |
| 4 | Assign task working | ⚠️ Debug/fix | Low–Medium |
| 5 | Image/PDF preview in comments | ❌ Not done | Medium |
| 6 | Contracts creating properly | ⚠️ Debug/fix | Low–Medium |
| 7 | PDF/image popup on file click | ❌ Not done | Medium |
| 8 | Upgrade plan working | ⚠️ Config/deploy | Low–Medium |
| 9 | Mindmap per project | ❌ Not done | High |
| 10 | Workspace editable/deletable | ✅ Done | – |
| 11 | Business reporting | ⚠️ Partial | Medium |

---

## 4. Suggested Implementation Order

1. **Quick wins:** Project name editing (#2), Workspace “View All” button (#1)  
2. **Bug fixes:** Assign task (#4), Contracts creation (#6), Upgrade system (#8)  
3. **UX:** Comment attachment preview (#5), File popup viewer (#7), UI polish (#3)  
4. **Features:** Business reporting (#11), Mindmap (#9)  

---

*Report generated from codebase analysis. For implementation details, refer to the referenced source files.*





                         ┌─────────────────────────┐
                         │        AUTH (Supabase)  │
                         │        auth.users       │
                         └─────────────┬───────────┘
                                       │
                                       ▼
                         ┌─────────────────────────┐
                         │      user_profiles      │
                         │  (displayName, photo)   │
                         └─────────────┬───────────┘
                                       │
                                       ▼
┌────────────────────────────────────────────────────────────┐
│                     ORGANIZATION                           │
│                                                            │
│  organizations                                             │
│  - organization_id                                         │
│  - name                                                    │
│  - owner_id                                                │
│  - members (JSONB)  ← SOURCE OF TRUTH                     │
│                                                            │
│  members = [                                               │
│    { userId, email, role, status, joinedAt }               │
│  ]                                                         │
└───────────────┬────────────────────────────────────────────┘
                │
                ▼
     ┌──────────────────────┐
     │      WORKSPACES      │
     │  - workspace_id      │
     │  - organization_id   │
     │  - name              │
     └──────────┬───────────┘
                │
                ▼
        ┌──────────────────┐
        │     PROJECTS     │
        │  - project_id    │
        │  - workspace_id  │
        │  - organization_id
        │  - owner_id      │
        │  - columns (JSON)│
        └────────┬─────────┘
                 │
                 ▼
        ┌──────────────────┐
        │       TASKS      │
        │  - task_id       │
        │  - project_id    │
        │  - organization_id
        │  - assignees(JSON)◄─── uses org members
        │  - attachments   │
        │  - tags          │
        │  - subtasks      │
        └────────┬─────────┘
                 │
                 ▼
        ┌──────────────────┐
        │     COMMENTS     │
        │  - task_id       │
        │  - attachments   │
        │  - time_spent    │
        └──────────────────┘