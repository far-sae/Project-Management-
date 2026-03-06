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
import { supabase } from "@/services/supabase";

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

    if (subscriptionRef.current) {
      console.log("⏭️ Already subscribed, skipping");
      return;
    }

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
        console.log("🔐 Validating session before creating project...");
        const isValid = await ensureValidSession();

        if (!isValid) {
          console.error("❌ Session validation failed");
          setError("Session expired. Please sign in again.");
          return null;
        }

        console.log("✅ Session validated, proceeding with project creation");

        if (!input) throw new Error("Input is required");

        // Fetch default workspace if not provided
        let workspaceId = input.workspaceId;
        if (!workspaceId) {
          console.log("📡 Fetching default workspace for org:", effectiveOrgId);

          const { data: workspace, error: wsError } = await supabase
            .from("workspaces")
            .select("workspace_id")
            .eq("organization_id", effectiveOrgId)
            .eq("is_default", true)
            .single();

          if (wsError || !workspace) {
            throw new Error(
              "No default workspace found. Please create a workspace first.",
            );
          }

          workspaceId = workspace.workspace_id;
          console.log("✅ Found default workspace:", workspaceId);
        }

        console.log("🚀 Creating project with valid session...");
        const newProject = await createProject(
          user.userId,
          user.email,
          user.displayName,
          user.photoURL,
          { ...input, workspaceId },
          effectiveOrgId,
        );

        console.log("✅ Project created successfully:", newProject?.projectId);
        return newProject;
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to create project";
        console.error("❌ Project creation error:", message);

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
        return true;
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to delete project";
        setError(message);
        return false;
      }
    },
    [user],
  );

  const refreshProjects = useCallback(async () => {
    if (!user || !effectiveOrgId) return;
    setLoading(true);
    setError(null);
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
      setLoading(false);
    }
  }, [user, effectiveOrgId]);

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
