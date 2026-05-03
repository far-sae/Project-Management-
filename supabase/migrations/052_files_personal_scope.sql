-- Personal Files
-- Each non-viewer (owner, admin, member) gets a private Files page where they
-- can upload personal documents/images. No one else in the org sees these
-- files — strictly per-user isolation. Personal-scope rows are not tied to
-- any project, so project_id must allow NULL.

-- 1. Allow NULL on project_id. Idempotent — no-op if already nullable.
ALTER TABLE public.files
  ALTER COLUMN project_id DROP NOT NULL;

-- 2. If a FK to projects(project_id) exists, recreate it with ON DELETE CASCADE
--    so deleting a project still removes its files but personal rows (with
--    project_id NULL) stay untouched. Idempotent.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'files_project_id_fkey'
      AND table_schema = 'public'
      AND table_name = 'files'
  ) THEN
    ALTER TABLE public.files DROP CONSTRAINT files_project_id_fkey;
  END IF;

  ALTER TABLE public.files
    ADD CONSTRAINT files_project_id_fkey
    FOREIGN KEY (project_id)
    REFERENCES public.projects(project_id)
    ON DELETE CASCADE;
END $$;

-- 3. Enforce the scope/project_id contract: 'personal' rows have NULL
--    project_id; 'project' / 'task' rows must have a project_id.
ALTER TABLE public.files
  DROP CONSTRAINT IF EXISTS files_personal_scope_no_project;

ALTER TABLE public.files
  ADD CONSTRAINT files_personal_scope_no_project
  CHECK (
    (scope = 'personal' AND project_id IS NULL)
    OR (scope IN ('project', 'task') AND project_id IS NOT NULL)
  );

-- 4. Lookup index for the personal Files page query
--    (filter by uploader within an org, ordered by recency).
CREATE INDEX IF NOT EXISTS idx_files_personal
  ON public.files (organization_id, uploaded_by, uploaded_at DESC)
  WHERE scope = 'personal';
