// Shared color palette for dashboard charts.
// Monochrome + 1 accent (orange) per design decision 2026-05-19.
// Most charts use shades of slate; the accent is reserved for the focal
// series (current period, primary KPI, "won" stage, etc.).

// Colors chosen to be readable on BOTH light and dark themes. The original
// palette used slate-900 (#0f172a) for default bars which disappeared on the
// dark theme — replaced with mid-tones (slate-400/500) that contrast against
// either background.

export const palette = {
  accent: '#f97316',          // orange-500 — focal series only
  accentSoft: '#fed7aa',      // orange-200 — accent fill/background
  accentMuted: '#fff7ed',     // orange-50 — KPI tile background
  primary: '#94a3b8',          // slate-400 — default bar / line color
  muted: '#64748b',            // slate-500 — secondary series
  light: '#475569',            // slate-600 — grid lines (just contrast on both themes)
  surface: '#ffffff',
  // For categorical series — light to dark on a dark background reads more
  // naturally than the inverse, so the first shade is the brightest.
  shades: ['#cbd5e1', '#94a3b8', '#64748b', '#475569', '#334155'],
  status: {
    todo: '#94a3b8',
    inProgress: '#60a5fa',
    review: '#f97316',
    done: '#22c55e',
    overdue: '#ef4444',
  },
  // Pipeline stage progression — 4 cool shades + accent on the "Won" stage.
  pipeline: ['#cbd5e1', '#94a3b8', '#64748b', '#475569', '#f97316'],
} as const;
