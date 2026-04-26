import React from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import {
  ACCENT_OPTIONS,
  useTheme,
  type ThemeAccent,
  type ThemeDensity,
  type ThemeMode,
} from "@/context/ThemeContext";
import { Monitor, Sun, Moon, Check } from "lucide-react";

const MODES: { id: ThemeMode; label: string; icon: React.ElementType; desc: string }[] = [
  {
    id: "system",
    label: "System",
    icon: Monitor,
    desc: "Match your device",
  },
  {
    id: "light",
    label: "Light",
    icon: Sun,
    desc: "Always light theme",
  },
  {
    id: "dark",
    label: "Dark",
    icon: Moon,
    desc: "Always dark theme",
  },
];

const DENSITIES: { id: ThemeDensity; label: string; desc: string }[] = [
  {
    id: "comfortable",
    label: "Comfortable",
    desc: "Roomy padding, easier to read",
  },
  {
    id: "compact",
    label: "Compact",
    desc: "Tighter rows, more on screen",
  },
];

export const AppearanceSettings: React.FC = () => {
  const {
    mode,
    setMode,
    density,
    setDensity,
    accent,
    setAccent,
    reducedMotion,
    setReducedMotion,
    reset,
  } = useTheme();

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Theme</CardTitle>
          <CardDescription>
            Pick a global look. We follow your system by default.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {MODES.map((m) => {
              const active = mode === m.id;
              const Icon = m.icon;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setMode(m.id)}
                  className={cn(
                    "rounded-xl border p-4 text-left transition-all",
                    active
                      ? "border-primary bg-primary/5 ring-1 ring-primary"
                      : "border-border hover:border-primary/40 hover:bg-secondary/50"
                  )}
                  aria-pressed={active}
                >
                  <div className="flex items-center justify-between mb-3">
                    <div
                      className={cn(
                        "w-9 h-9 rounded-lg flex items-center justify-center",
                        active
                          ? "bg-primary text-primary-foreground"
                          : "bg-secondary text-foreground"
                      )}
                    >
                      <Icon className="w-4 h-4" />
                    </div>
                    {active && <Check className="w-4 h-4 text-primary" />}
                  </div>
                  <p className="font-medium text-foreground">{m.label}</p>
                  <p className="text-xs text-muted-foreground">{m.desc}</p>
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Accent color</CardTitle>
          <CardDescription>
            Tints buttons, focus rings and charts. Each workspace can also set its
            own accent.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3">
            {ACCENT_OPTIONS.map((opt) => {
              const active = accent === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setAccent(opt.id as ThemeAccent)}
                  className={cn(
                    "group flex items-center gap-2 px-3 py-2 rounded-full border transition-all",
                    active
                      ? "border-foreground/40 shadow-sm"
                      : "border-border hover:border-foreground/30"
                  )}
                  aria-pressed={active}
                  aria-label={`Accent color ${opt.label}`}
                >
                  <span
                    className="w-5 h-5 rounded-full ring-1 ring-border"
                    style={{ background: opt.swatch }}
                  />
                  <span className="text-sm font-medium">{opt.label}</span>
                  {active && <Check className="w-4 h-4 text-foreground" />}
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Density</CardTitle>
          <CardDescription>
            Control row height across the kanban, list and tables.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {DENSITIES.map((d) => {
              const active = density === d.id;
              return (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => setDensity(d.id)}
                  className={cn(
                    "rounded-xl border p-4 text-left transition-all",
                    active
                      ? "border-primary bg-primary/5 ring-1 ring-primary"
                      : "border-border hover:border-primary/40 hover:bg-secondary/50"
                  )}
                  aria-pressed={active}
                >
                  <div className="flex items-center justify-between mb-2">
                    <p className="font-medium">{d.label}</p>
                    {active && <Check className="w-4 h-4 text-primary" />}
                  </div>
                  <p className="text-xs text-muted-foreground">{d.desc}</p>
                  <div className="mt-3 space-y-1">
                    <div
                      className={cn(
                        "rounded-md bg-secondary",
                        d.id === "compact" ? "h-3" : "h-5"
                      )}
                    />
                    <div
                      className={cn(
                        "rounded-md bg-secondary",
                        d.id === "compact" ? "h-3" : "h-5"
                      )}
                    />
                    <div
                      className={cn(
                        "rounded-md bg-secondary",
                        d.id === "compact" ? "h-3" : "h-5"
                      )}
                    />
                  </div>
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Motion & accessibility</CardTitle>
          <CardDescription>
            Tone down animations and transitions across the app.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label htmlFor="reduce-motion" className="font-medium">
                Reduce motion
              </Label>
              <p className="text-sm text-muted-foreground">
                Disables most animations and transitions.
              </p>
            </div>
            <Switch
              id="reduce-motion"
              checked={reducedMotion}
              onCheckedChange={setReducedMotion}
            />
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium">Reset appearance</p>
              <p className="text-sm text-muted-foreground">
                Restore theme defaults (system + Sunset + Comfortable).
              </p>
            </div>
            <button
              onClick={reset}
              className="text-sm text-primary hover:underline"
            >
              Reset
            </button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default AppearanceSettings;
