-- Per-user notification preferences (synced to DB so invite flows / multi-device work).
-- LocalStorage-only prefs cannot be read when another user triggers a notification for you.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'user_profiles'
  ) THEN
    ALTER TABLE public.user_profiles
      ADD COLUMN IF NOT EXISTS notification_preferences jsonb
      DEFAULT '{
        "email": true,
        "push": true,
        "taskAssigned": true,
        "taskCompleted": true,
        "projectUpdates": true,
        "projectChatMessage": true
      }'::jsonb;
  END IF;
END $$;

-- Allow any authenticated user to read another user’s delivery prefs (needed before inserting a
-- notification or sending task email for the recipient). Data is only booleans, not PII.
CREATE OR REPLACE FUNCTION public.get_notification_preferences(p_user_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT notification_preferences FROM public.user_profiles WHERE id = p_user_id),
    '{
      "email": true,
      "push": true,
      "taskAssigned": true,
      "taskCompleted": true,
      "projectUpdates": true,
      "projectChatMessage": true
    }'::jsonb
  );
$$;

REVOKE ALL ON FUNCTION public.get_notification_preferences(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_notification_preferences(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_notification_preferences(uuid) TO service_role;
