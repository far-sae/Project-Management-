-- Normalize bootstrap workspace titles so "Default Workspace" / "Workspace" are not shown as-is.
update public.workspaces
set name = 'General',
    updated_at = coalesce(updated_at, now())
where is_default = true
  and lower(trim(name)) in ('workspace', 'default workspace', 'default');
