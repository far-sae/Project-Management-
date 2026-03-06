import { useState, useEffect } from "react";
import { useOrganization } from "@/context/OrganizationContext";
import { GlobalComment } from "@/types/task";
import { subscribeToGlobalUserComments } from "@/services/supabase/database";

export const useUserComments = (userId: string | null) => {
  const { organization } = useOrganization();
  const [comments, setComments] = useState<GlobalComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

    return () => {
      unsubscribe();
    };
  }, [userId, organization?.organizationId]);

  return { comments, loading, error };
};

export default useUserComments;
