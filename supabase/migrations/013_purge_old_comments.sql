-- Remove task comments older than 30 days from `comments` and `global_comments`
-- to limit storage. Keeps `tasks.comments_count` in sync.
--
-- When the pg_cron extension is enabled (e.g. Supabase projects with cron), a
-- daily job is registered. Otherwise run manually: SELECT public.purge_old_task_comments(30);

CREATE OR REPLACE FUNCTION public.purge_old_task_comments(p_retention_days integer DEFAULT 30)
RETURNS TABLE(deleted_comments bigint, deleted_global bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cutoff timestamptz;
  n_comments bigint;
  n_global bigint;
BEGIN
  IF p_retention_days < 1 THEN
    RAISE EXCEPTION 'retention must be at least 1 day';
  END IF;

  cutoff := now() - make_interval(days => p_retention_days);

  WITH doomed AS (
    SELECT task_id, COUNT(*)::bigint AS n
    FROM public.comments
    WHERE created_at < cutoff
    GROUP BY task_id
  )
  UPDATE public.tasks t
  SET comments_count = GREATEST(0, COALESCE(t.comments_count, 0) - doomed.n::integer)
  FROM doomed
  WHERE t.task_id = doomed.task_id;

  DELETE FROM public.global_comments WHERE created_at < cutoff;
  GET DIAGNOSTICS n_global = ROW_COUNT;

  DELETE FROM public.comments WHERE created_at < cutoff;
  GET DIAGNOSTICS n_comments = ROW_COUNT;

  RETURN QUERY SELECT n_comments, n_global;
END;
$$;

REVOKE ALL ON FUNCTION public.purge_old_task_comments(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.purge_old_task_comments(integer) TO service_role;

COMMENT ON FUNCTION public.purge_old_task_comments(integer) IS
  'Deletes rows in comments/global_comments older than p_retention_days and adjusts tasks.comments_count.';

CREATE INDEX IF NOT EXISTS idx_comments_created_at ON public.comments (created_at);
CREATE INDEX IF NOT EXISTS idx_global_comments_created_at ON public.global_comments (created_at);

DO $$
DECLARE
  r RECORD;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    FOR r IN SELECT jobid FROM cron.job WHERE jobname = 'purge_old_task_comments'
    LOOP
      PERFORM cron.unschedule(r.jobid);
    END LOOP;
    PERFORM cron.schedule(
      'purge_old_task_comments',
      '0 6 * * *',
      'SELECT public.purge_old_task_comments(30)'
    );
  END IF;
END $$;
