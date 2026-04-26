import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

interface UseGlobalShortcutsOptions {
  onOpenPalette: () => void;
  onOpenShortcuts: () => void;
  onCreateTask?: () => void;
}

const isTypingTarget = (target: EventTarget | null) => {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (target.isContentEditable) return true;
  if (target.closest('[contenteditable="true"]')) return true;
  return false;
};

/**
 * Wires global keyboard shortcuts:
 *   ⌘K / Ctrl+K — open palette
 *   /            — focus global search (palette)
 *   c            — create task
 *   ?            — show shortcut cheat sheet
 *   g d/p/i/c/r — go to dashboard / projects (dashboard) / inbox / calendar / reports
 */
export const useGlobalShortcuts = ({
  onOpenPalette,
  onOpenShortcuts,
  onCreateTask,
}: UseGlobalShortcutsOptions) => {
  const navigate = useNavigate();

  useEffect(() => {
    let pendingG = false;
    let pendingTimeout: number | null = null;

    const handler = (e: KeyboardEvent) => {
      // ⌘K / Ctrl+K
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        onOpenPalette();
        return;
      }

      // Ignore other shortcuts when typing
      if (isTypingTarget(e.target)) return;

      if (e.metaKey || e.ctrlKey || e.altKey) return;

      // Two-key sequences starting with "g"
      if (pendingG) {
        const map: Record<string, string> = {
          d: "/dashboard",
          p: "/dashboard",
          i: "/inbox",
          c: "/calendar",
          r: "/reports",
          t: "/tasks",
          m: "/team",
          w: "/workload",
        };
        const dest = map[e.key.toLowerCase()];
        if (dest) {
          e.preventDefault();
          navigate(dest);
        }
        pendingG = false;
        if (pendingTimeout !== null) {
          window.clearTimeout(pendingTimeout);
          pendingTimeout = null;
        }
        return;
      }

      switch (e.key) {
        case "/": {
          e.preventDefault();
          onOpenPalette();
          break;
        }
        case "?": {
          e.preventDefault();
          onOpenShortcuts();
          break;
        }
        case "c":
        case "C": {
          if (onCreateTask) {
            e.preventDefault();
            onCreateTask();
          }
          break;
        }
        case "g":
        case "G": {
          pendingG = true;
          pendingTimeout = window.setTimeout(() => {
            pendingG = false;
            pendingTimeout = null;
          }, 1200);
          break;
        }
        default:
          break;
      }
    };

    window.addEventListener("keydown", handler);
    return () => {
      window.removeEventListener("keydown", handler);
      if (pendingTimeout !== null) window.clearTimeout(pendingTimeout);
    };
  }, [onOpenPalette, onOpenShortcuts, onCreateTask, navigate]);
};

export default useGlobalShortcuts;
