// Shared color palette for dashboard charts.
// Monochrome + 1 accent (orange) per design decision 2026-05-19.
// Most charts use shades of slate; the accent is reserved for the focal
// series (current period, primary KPI, "won" stage, etc.).

export const palette = {
  accent: '#f97316',          // orange-500 — focal series only
  accentSoft: '#fed7aa',      // orange-200 — accent fill/background
  accentMuted: '#fff7ed',     // orange-50 — KPI tile background
  primary: '#0f172a',          // slate-900 — primary bars / text
  muted: '#94a3b8',            // slate-400 — secondary bars
  light: '#e2e8f0',            // slate-200 — grid lines, empty fill
  surface: '#ffffff',
  // For categorical series (status, stage): use shades top-down.
  shades: ['#0f172a', '#334155', '#64748b', '#94a3b8', '#cbd5e1'],
  // Semantic status — used sparingly; falls back to shades.
  status: {
    todo: '#94a3b8',
    inProgress: '#0f172a',
    review: '#f97316',
    done: '#22c55e',
    overdue: '#ef4444',
  },
  // Pipeline stage progression (5 stages from cold to won).
  pipeline: ['#cbd5e1', '#94a3b8', '#64748b', '#334155', '#f97316'],
} as const;
