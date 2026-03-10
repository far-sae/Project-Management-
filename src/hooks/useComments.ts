import { useState, useEffect, useCallback } from "react";
import { useOrganization } from "@/context/OrganizationContext";
import { GlobalComment } from "@/types/task";
import { subscribeToGlobalUserComments, getUserComments } from "@/services/supabase/database";

export const useUserComments = (userId: string | null) => {
  const { organization } = useOrganization();
  const [comments, setComments] = useState<GlobalComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(() => {
    if (!userId || !organization?.organizationId) return;
    getUserComments(userId, organization.organizationId)
      .then((fetched) => {
        setComments(fetched);
        setLoading(false);
        setError(null);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Failed to load comments");
        setLoading(false);
      });
  }, [userId, organization?.organizationId]);

  useEffect(() => {
    if (!userId || !organization?.organizationId) {
      setComments([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    const unsubscribe = subscribeToGlobalUserComments(
      userId,
      organization.organizationId,
      (fetchedComments) => {
        setComments(fetchedComments);
        setLoading(false);
      },
    );

    const onVisibility = () => {
      if (document.visibilityState === "visible") refetch();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      unsubscribe();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [userId, organization?.organizationId, refetch]);

  return { comments, loading, error, refetch };
};

export default useUserComments;
