import React from 'react';
import { LayoutTemplate, Loader2 } from 'lucide-react';

import { cn } from '@/lib/utils';
import type { ProjectTemplate } from '@/types/projectTemplate';

/** Presentational pieces shared by the two "Create New Project" dialogs. */

export const PROJECT_COLORS = [
  '#f97316', '#ef4444', '#22c55e', '#3b82f6',
  '#a855f7', '#ec4899', '#14b8a6', '#f59e0b',
];

/** Field label size used in the workspace dialogs (`Label` adds the weight). */
export const FIELD_LABEL = 'text-sm';

/** Dialog footers stack on phones; this keeps the stacked buttons apart. */
export const DIALOG_FOOTER = 'gap-2 sm:gap-0';

export const FormError: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p
    role="alert"
    className="rounded-md border border-destructive/30 bg-destructive-soft px-3 py-2 text-sm text-destructive-soft-foreground"
  >
    {children}
  </p>
);

interface ColorSwatchRowProps {
  value: string;
  onChange: (color: string) => void;
  colors?: string[];
}

export const ColorSwatchRow: React.FC<ColorSwatchRowProps> = ({ value, onChange, colors = PROJECT_COLORS }) => (
  <div className="flex flex-wrap gap-2">
    {colors.map((color) => (
      <button
        key={color}
        type="button"
        aria-label={`Colour ${color}`}
        aria-pressed={value === color}
        onClick={() => onChange(color)}
        className={cn(
          'h-7 w-7 shrink-0 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card',
          value === color && 'ring-2 ring-foreground ring-offset-2 ring-offset-card',
        )}
        style={{ backgroundColor: color }}
      />
    ))}
  </div>
);

interface TemplatePickerProps {
  templates: ProjectTemplate[];
  loading: boolean;
  selectedId?: string | null;
  onSelect: (template: ProjectTemplate) => void;
}

export const TemplatePicker: React.FC<TemplatePickerProps> = ({ templates, loading, selectedId, onSelect }) => {
  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
        Loading templates...
      </div>
    );
  }
  if (templates.length === 0) {
    return <div className="py-8 text-center text-sm text-muted-foreground">No templates available yet.</div>;
  }
  return (
    <div className="grid max-h-72 grid-cols-1 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
      {templates.map((tpl) => {
        const isSelected = selectedId === tpl.id;
        return (
          <button
            key={tpl.id}
            type="button"
            aria-pressed={isSelected}
            onClick={() => onSelect(tpl)}
            className={cn(
              'rounded-lg border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              isSelected
                ? 'border-foreground/60 bg-secondary'
                : 'border-border bg-card hover:border-foreground/20 hover:bg-surface-2',
            )}
          >
            <div className="flex items-start gap-2">
              <div className="rounded-md bg-foreground/[0.05] p-1.5 text-muted-foreground">
                <LayoutTemplate className="h-4 w-4" aria-hidden />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="truncate text-sm font-medium text-foreground">{tpl.name}</p>
                  {tpl.isBuiltin && (
                    <span className="shrink-0 rounded border border-border px-1.5 text-xs leading-[18px] text-muted-foreground">
                      Built-in
                    </span>
                  )}
                </div>
                {tpl.description && (
                  <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{tpl.description}</p>
                )}
                <p className="mt-1 text-xs tabular-nums text-muted-foreground">
                  {tpl.columns.length} columns · {tpl.tasks.length} starter tasks
                </p>
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
};
