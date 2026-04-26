import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type ThemeMode = "light" | "dark" | "system";
export type ThemeDensity = "comfortable" | "compact";
export type ThemeAccent =
  | "orange"
  | "blue"
  | "violet"
  | "green"
  | "pink"
  | "slate";

export interface ThemePreferences {
  mode: ThemeMode;
  density: ThemeDensity;
  accent: ThemeAccent;
  reducedMotion: boolean;
}

interface ThemeContextValue extends ThemePreferences {
  resolvedMode: "light" | "dark";
  setMode: (mode: ThemeMode) => void;
  setDensity: (density: ThemeDensity) => void;
  setAccent: (accent: ThemeAccent) => void;
  setReducedMotion: (reduced: boolean) => void;
  reset: () => void;
}

const STORAGE_KEY = "app_appearance_v1";

const DEFAULTS: ThemePreferences = {
  mode: "system",
  density: "comfortable",
  accent: "orange",
  reducedMotion: false,
};

const ACCENTS: ThemeAccent[] = [
  "orange",
  "blue",
  "violet",
  "green",
  "pink",
  "slate",
];

const ThemeContext = createContext<ThemeContextValue | null>(null);

const readPrefs = (): ThemePreferences => {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<ThemePreferences>;
    return {
      mode:
        parsed.mode === "light" ||
        parsed.mode === "dark" ||
        parsed.mode === "system"
          ? parsed.mode
          : DEFAULTS.mode,
      density:
        parsed.density === "compact" ? "compact" : DEFAULTS.density,
      accent: ACCENTS.includes(parsed.accent as ThemeAccent)
        ? (parsed.accent as ThemeAccent)
        : DEFAULTS.accent,
      reducedMotion: !!parsed.reducedMotion,
    };
  } catch {
    return DEFAULTS;
  }
};

const writePrefs = (prefs: ThemePreferences) => {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // ignore storage failures (private mode, etc.)
  }
};

const getSystemMode = (): "light" | "dark" => {
  if (typeof window === "undefined" || !window.matchMedia) return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
};

const getSystemReducedMotion = (): boolean => {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
};

const applyDocumentClasses = (
  resolvedMode: "light" | "dark",
  prefs: ThemePreferences,
  systemReducedMotion: boolean,
) => {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.classList.toggle("dark", resolvedMode === "dark");
  root.classList.toggle("dense", prefs.density === "compact");
  root.classList.toggle(
    "motion-reduced",
    prefs.reducedMotion || systemReducedMotion,
  );
  root.dataset.accent = prefs.accent;
  root.style.colorScheme = resolvedMode;
};

interface ThemeProviderProps {
  children: ReactNode;
}

export const ThemeProvider: React.FC<ThemeProviderProps> = ({ children }) => {
  const [prefs, setPrefs] = useState<ThemePreferences>(() => readPrefs());
  const [systemMode, setSystemMode] = useState<"light" | "dark">(() =>
    getSystemMode(),
  );
  const [systemReducedMotion, setSystemReducedMotion] = useState<boolean>(() =>
    getSystemReducedMotion(),
  );

  // Track system color scheme
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const dark = window.matchMedia("(prefers-color-scheme: dark)");
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onDarkChange = (e: MediaQueryListEvent) =>
      setSystemMode(e.matches ? "dark" : "light");
    const onMotionChange = (e: MediaQueryListEvent) =>
      setSystemReducedMotion(e.matches);
    dark.addEventListener?.("change", onDarkChange);
    motion.addEventListener?.("change", onMotionChange);
    return () => {
      dark.removeEventListener?.("change", onDarkChange);
      motion.removeEventListener?.("change", onMotionChange);
    };
  }, []);

  const resolvedMode: "light" | "dark" =
    prefs.mode === "system" ? systemMode : prefs.mode;

  // Apply document classes whenever something changes
  useEffect(() => {
    applyDocumentClasses(resolvedMode, prefs, systemReducedMotion);
  }, [resolvedMode, prefs, systemReducedMotion]);

  // Persist
  useEffect(() => {
    writePrefs(prefs);
  }, [prefs]);

  const setMode = useCallback((mode: ThemeMode) => {
    setPrefs((p) => ({ ...p, mode }));
  }, []);

  const setDensity = useCallback((density: ThemeDensity) => {
    setPrefs((p) => ({ ...p, density }));
  }, []);

  const setAccent = useCallback((accent: ThemeAccent) => {
    setPrefs((p) => ({ ...p, accent }));
  }, []);

  const setReducedMotion = useCallback((reducedMotion: boolean) => {
    setPrefs((p) => ({ ...p, reducedMotion }));
  }, []);

  const reset = useCallback(() => {
    setPrefs(DEFAULTS);
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({
      ...prefs,
      resolvedMode,
      setMode,
      setDensity,
      setAccent,
      setReducedMotion,
      reset,
    }),
    [prefs, resolvedMode, setMode, setDensity, setAccent, setReducedMotion, reset],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
};

export const useTheme = (): ThemeContextValue => {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme must be used inside a ThemeProvider");
  }
  return ctx;
};

export const ACCENT_OPTIONS: { id: ThemeAccent; label: string; swatch: string }[] = [
  { id: "orange", label: "Sunset", swatch: "hsl(24 95% 53%)" },
  { id: "blue", label: "Ocean", swatch: "hsl(217 91% 60%)" },
  { id: "violet", label: "Violet", swatch: "hsl(262 83% 62%)" },
  { id: "green", label: "Forest", swatch: "hsl(152 70% 42%)" },
  { id: "pink", label: "Berry", swatch: "hsl(330 81% 60%)" },
  { id: "slate", label: "Slate", swatch: "hsl(220 14% 35%)" },
];
