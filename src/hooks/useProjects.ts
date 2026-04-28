import { useState, useEffect, useCallback, useRef } from "react";
import { useAuth } from "@/context/AuthContext";
import { useOrganization } from "@/context/OrganizationContext";
import {
  createProject,
  getUserProjects,
  updateProject,
  deleteProject,
  subscribeToProjects,
} from "@/services/supabase/database";
import { Project, CreateProjectInput, UpdateProjectInput } from "@/types";
// ── Limit error is identifiable by this prefix ───────────────────────
export const LIMIT_ERROR_PREFIX = "LIMIT_REACHED:";

export const useProjects = () => {
  const { user, ensureValidSession } = useAuth();
  const { organization } = useOrganization();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ✅ Limit modal state — handled here so any caller can use it
  const [limitModal, setLimitModal] = useState<{
    open: boolean;
    message: string;
  }>({ open: false, message: "" });

  const subscriptionRef = useRef<(() => void) | null>(null);

  const effectiveOrgId = (
    organization?.organizationId ||
    user?.organizationId ||
    user?.userId ||
    ""
  ).replace("local-", "");

  useEffect(() => {
    // console.log("🔄 useProjects effect running:", {
    //   user: user?.userId,
    //   effectiveOrgId,
    // });

    if (!user || !effectiveOrgId) {
      setProjects([]);
      setLoading(false);
      return;
    }

    if (subscriptionRef.current) return;

    setLoading(true);
    const unsubscribe = subscribeToProjects(
      user.userId,
      effectiveOrgId,
      user.email,
      (updatedProjects) => {
        // console.log(
        //   "✅ Projects updated via subscription:",
        //   updatedProjects.length,
        // );
        setProjects(updatedProjects);
        setLoading(false);
      },
    );

    subscriptionRef.current = unsubscribe;

    return () => {
      // console.log("❌ Unsubscribing from projects");
      if (subscriptionRef.current) {
        subscriptionRef.current();
        subscriptionRef.current = null;
      }
    };
  }, [user?.userId, effectiveOrgId]);

  const addProject = useCallback(
    async (input: CreateProjectInput): Promise<Project | null> => {
      if (!user) {
        setError("User not authenticated");
        return null;
      }

      setError(null);

      try {
        const isValid = await ensureValidSession();

        if (!isValid) {
          setError("Session expired. Please sign in again.");
          return null;
        }

        if (!input) throw new Error("Input is required");

        const newProject = await createProject(
          user.userId,
          user.email,
          user.displayName,
          user.photoURL,
          input,
          effectiveOrgId,
        );

        if (newProject) {
          const fresh = await getUserProjects(user.userId, effectiveOrgId, user.email);
          setProjects(fresh);
        }
        return newProject;
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to create project";

        // ✅ Check if it's a limit error — show modal instead of inline error
        if (message.includes("limit") || message.includes("reached")) {
          setLimitModal({ open: true, message });
        } else {
          setError(message);
        }

        return null;
      }
    },
    [user, effectiveOrgId, ensureValidSession],
  );

  const editProject = useCallback(
    async (projectId: string, input: UpdateProjectInput): Promise<boolean> => {
      setError(null);
      try {
        if (!user) throw new Error("User not authenticated");
        if (!input) throw new Error("Input is required");
        await updateProject(projectId, input, effectiveOrgId);
        const fresh = await getUserProjects(user.userId, effectiveOrgId, user.email);
        setProjects(fresh);
        return true;
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to update project";
        setError(message);
        return false;
      }
    },
    [user, effectiveOrgId],
  );

  const removeProject = useCallback(
    async (projectId: string): Promise<boolean> => {
      setError(null);
      try {
        await deleteProject(
          projectId,
          (user?.organizationId || user?.userId || "").replace("local-", ""),
        );
        if (user && effectiveOrgId) {
          const fresh = await getUserProjects(user.userId, effectiveOrgId, user.email);
          setProjects(fresh);
        }
        return true;
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to delete project";
        setError(message);
        return false;
      }
    },
    [user, effectiveOrgId],
  );

  const refreshProjects = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent ?? false;
    if (!user || !effectiveOrgId) return;
    if (!silent) {
      setLoading(true);
      setError(null);
    }
    try {
      const fetchedProjects = await getUserProjects(
        user.userId,
        effectiveOrgId,
        user.email,
      );
      setProjects(fetchedProjects);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to fetch projects";
      setError(message);
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  }, [user, effectiveOrgId]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "visible" && user && effectiveOrgId) {
        void refreshProjects({ silent: true });
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [refreshProjects, user, effectiveOrgId]);

  return {
    projects,
    loading,
    error,
    addProject,
    editProject,
    removeProject,
    refreshProjects,
    limitModal,
    closeLimitModal: () => setLimitModal({ open: false, message: "" }),
  };
};

export default useProjects;
