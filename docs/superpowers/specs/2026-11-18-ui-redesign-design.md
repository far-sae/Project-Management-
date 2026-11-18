# UI redesign (approved 2026-11-18)

The owner approved a full visual redesign: a neutral, tight, border-led look
(Geist font, grey surfaces, one orange brand colour for primary buttons) with
loud colour reserved for task urgency and priority.

Approved mockups (HTML, one per screen) are in
`docs/superpowers/specs/2026-11-18-ui-redesign-mocks/`. Each file's markup uses
inline styles with exact values; read the one for your screen and map its hex
values to the Tailwind tokens below. The mock is the target for layout,
hierarchy and density. It is not a list of features: never remove a feature,
control, label or state the real screen has just because the mock is simpler.

| Mock file | Screen |
| --- | --- |
| `Main.dc.html` | Project page + Kanban board (built) |
| `Workspace.dc.html` | `/dashboard` workspace home |
| `TaskForm.dc.html` | Task dialog |
| `HR.dc.html` | HR attendance |
| `Components.dc.html` | Buttons, fields, badges, type, colour |
| `Chat.dc.html` | Project chat panel, Team tab, one-to-one chat dock |
| `Call.dc.html` | In-call screen, incoming call, mini call |
| `MyTasks.dc.html` | My Tasks |
| `Team.dc.html` | Team |
| `Calendar.dc.html` | Calendar |

## Already built (do not redo, do not edit)

- Tokens in `src/index.css`, `tailwind.config.ts` (font, shadows).
- Primitives in `src/components/ui/*` (button, input, textarea, select, tabs,
  card, badge, dialog, switch).
- `Sidebar`, `QuickMenu`, `WorkspaceSwitcher`, `AppHeader`.
- `ProjectView` header/toolbar, `KanbanColumn`, `TaskCard`, `InlineAddCard`.
- Shared pieces in `src/components/common/`: `PageHeader`, `StatStrip`,
  `StatusPill`, `TaskBadges` (`PriorityPill`, `UrgentBadge`, `taskLevel`,
  `TASK_LEVEL_SURFACE`, `TASK_PILL`).

## Tokens (mock hex → Tailwind)

| Mock | Use | Tailwind |
| --- | --- | --- |
| `#ffffff` | page, cards | `bg-background`, `bg-card` |
| `#fafafa` | sidebar, table head, side panels | `bg-surface-2` |
| `#f5f5f5` / `#f2f2f2` / `#ededed` | lanes, bubbles, hover | `bg-secondary`, `hover:bg-secondary`, `bg-foreground/[0.05]` |
| `#eaeaea` / `#e0e0e0` / `#e5e5e5` | borders | `border-border` (controls: `border-input`) |
| `#171717` | text | `text-foreground` |
| `#666666` / `#4d4d4d` | secondary text, icons | `text-muted-foreground` |
| `var(--primary-bg)` (orange) | primary buttons, own chat bubbles | `bg-primary text-primary-foreground` |
| `#d92d20` / `#b42318` / `#fef3f2` / `#f5c2bd` | danger, urgent, overdue | `bg-destructive`, `text-destructive`, `bg-destructive-soft`, `text-destructive-soft-foreground`, `border-destructive/30` |
| `#d97706` / `#8a4b0b` / `#fffaeb` / `#f3d488` | warning, medium | `bg-warning`, `bg-warning-soft`, `text-warning-soft-foreground`, `border-warning/40` |
| `#16a34a` / `#166534` / `#f0fdf4` | success, online | `bg-success`, `bg-success-soft`, `text-success-soft-foreground` |
| project/avatar tints | data colours | keep data-driven inline `style` |

Never use raw palette classes (`text-orange-600`, `bg-emerald-500`,
`text-red-600`, `bg-blue-500`, `text-gray-400`, `violet-*`, `sky-*`,
`amber-*`): use the tokens. Theme accents (blue, violet, …) and dark mode only
work through tokens.

## Rules

- **No** gradients, `backdrop-blur`, coloured shadows/glows, translucent
  surfaces (`bg-card/80`), hover lifts (`-translate-y`), `shadow-lg/xl` on
  in-page cards. Borders separate things; shadows are only for floating layers
  (menus, dialogs, docked chat, toasts).
- **Radii:** `rounded-md` (6px) controls; `rounded-lg` (8px) cards, tables,
  panels; `rounded-xl` (12px) dialogs and floating panels; `rounded-full`
  pills, avatars, switches; `rounded` (4px) tags.
- **Control heights (desktop):** Button default 32px, `size="sm"` 28px,
  `size="lg"` 40px, `size="icon"` 32px; Input/Select 32px. Do not pass `h-*`
  overrides to Button/Input/SelectTrigger: the size prop already decides, and
  a call-site `h-10` does not win at `md+` anyway. Controls in one row must be
  the same height. Icon-only buttons need `aria-label`.
- Icons inside buttons: no `mr-2`; Button already has `gap-1.5`. Icons are
  `h-4 w-4` (14px `h-3.5` only inside 28px controls and meta rows).
- **Type:** page title `text-2xl font-semibold tracking-tight` (via
  `PageHeader`); section title `text-base font-semibold`; card title
  `text-sm font-semibold`; body `text-sm`; controls and table cells
  `text-[13px]`; small/meta `text-xs text-muted-foreground`. No `font-bold`,
  no uppercase tracking-wider labels (use sentence-case `text-xs font-medium
  text-muted-foreground`). Numbers use `tabular-nums`.
- **Page pattern:** `<AppHeader left={<span className="text-sm font-semibold">Page</span>} />`
  (or a breadcrumb), then a body container
  `mx-auto w-full max-w-6xl px-4 py-6 lg:px-6` with `flex flex-col gap-6`,
  starting with `<PageHeader title description actions />`. No page-level
  gradient backgrounds.
- **Figures:** `<StatStrip items={[{label, value, note, tone}]} />` instead of
  a grid of stat cards.
- **Lists/tables:** wrapper `overflow-hidden rounded-lg border border-border`
  (+ `overflow-x-auto` inner when wide); header row `h-10 bg-surface-2 text-xs
  font-medium text-muted-foreground` (sentence case, no uppercase); rows
  `min-h-12 border-b border-border/60 last:border-0 text-[13px]
  hover:bg-surface-2`; cell padding `px-4`.
- **Section card with list:** bordered `rounded-lg` box, header row `h-11 px-4
  border-b` with `text-sm font-semibold` title and muted meta on the right.
- **Status:** `<StatusPill tone="success|warning|danger|info|neutral|muted">`.
- **Tasks:** `<UrgentBadge />`, `<PriorityPill priority color muted />`,
  `taskLevel(task)` and `TASK_LEVEL_SURFACE[level]` for card/row surfaces.
  Urgent = red tinted surface + solid red badge; high = red pill + red-tinted
  border; medium = amber pill; low = grey pill; done = muted.
- **Progress bars:** track `h-1 rounded-full bg-foreground/10`, fill
  `bg-foreground/70` (no gradients, no glow).
- **Tabs:** use `Tabs/TabsList/TabsTrigger` defaults (underline). Remove
  call-site pill overrides (`bg-secondary/50 p-1`, `rounded-xl`,
  `data-[state=active]:bg-*`, `shadow-sm`).
- **Empty states:** centred, one `h-5 w-5 text-muted-foreground` icon, a
  `text-[13px] font-medium` line, a `text-xs text-muted-foreground` hint, at
  most one button.
- **Mobile:** every row of controls wraps (`flex-wrap`); wide tables scroll
  inside their box; nothing overflows the viewport at 360px.
- **Accessibility:** keep every existing `aria-label`, role, visible label and
  test id. Text contrast 4.5:1.

## Behaviour changes approved with the mockups

- Project header "New task" button (built).
- My Tasks: urgent tasks listed first within each group.
- Team page and the project chat's Team tab: per-person message / voice /
  video buttons that reach only that person (project-level call buttons still
  ring everyone).
- Primary buttons use the brand orange, slightly deeper than before
  (`--primary: 17 88% 40%`) so white text stays readable.

Everything else must behave exactly as before.
