import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "pinned_projects_v1";
const EVENT_NAME = "app:pinned-projects-changed";

const read = (): string[] => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v) => typeof v === "string") : [];
  } catch {
    return [];
  }
};

const write = (ids: string[]) => {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
    window.dispatchEvent(new Event(EVENT_NAME));
  } catch {
    /* ignore */
  }
};

export const usePinnedProjects = () => {
  const [ids, setIds] = useState<string[]>(() => read());

  useEffect(() => {
    const onChange = () => setIds(read());
    window.addEventListener(EVENT_NAME, onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener(EVENT_NAME, onChange);
      window.removeEventListener("storage", onChange);
    };
  }, []);

  const isPinned = useCallback(
    (projectId: string) => ids.includes(projectId),
    [ids],
  );

  const toggle = useCallback(
    (projectId: string) => {
      setIds((prev) => {
        const next = prev.includes(projectId)
          ? prev.filter((id) => id !== projectId)
          : [...prev, projectId];
        write(next);
        return next;
      });
    },
    [],
  );

  const pin = useCallback((projectId: string) => {
    setIds((prev) => {
      if (prev.includes(projectId)) return prev;
      const next = [...prev, projectId];
      write(next);
      return next;
    });
  }, []);

  const unpin = useCallback((projectId: string) => {
    setIds((prev) => {
      if (!prev.includes(projectId)) return prev;
      const next = prev.filter((id) => id !== projectId);
      write(next);
      return next;
    });
  }, []);

  return { pinnedIds: ids, isPinned, toggle, pin, unpin };
};

export default usePinnedProjects;
