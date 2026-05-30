-- 081_crm_upsert_recipe_unique_names.sql
-- Avoid 409 conflicts when users create/copy an automation with a recipe name
-- that already exists in the organization. Keep names readable by appending a
-- numeric suffix instead of surfacing a raw unique-constraint failure.

create or replace function public.crm_upsert_recipe(
  p_recipe_id uuid,
  p_organization_id uuid,
  p_name text,
  p_description text,
  p_trigger_type text,
  p_trigger_config jsonb,
  p_conditions jsonb,
  p_actions jsonb,
  p_enabled boolean,
  p_send_window jsonb default null
) returns public.automation_recipes
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.automation_recipes;
  v_base_name text;
  v_name text;
  v_suffix int := 2;
begin
  if not public.is_org_admin(p_organization_id) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  v_base_name := nullif(btrim(p_name), '');
  if v_base_name is null then
    raise exception 'Recipe name is required' using errcode = '22023';
  end if;

  if jsonb_array_length(coalesce(p_actions, '[]'::jsonb)) = 0 then
    raise exception 'Recipe must have at least one action' using errcode = '22023';
  end if;

  v_name := v_base_name;
  while exists (
    select 1
    from public.automation_recipes
    where organization_id = p_organization_id
      and lower(name) = lower(v_name)
      and (p_recipe_id is null or recipe_id <> p_recipe_id)
  ) loop
    v_name := v_base_name || ' (' || v_suffix || ')';
    v_suffix := v_suffix + 1;
  end loop;

  if p_recipe_id is null then
    insert into public.automation_recipes (
      organization_id, name, description, trigger_type, trigger_config,
      conditions, actions, enabled, send_window, created_by
    ) values (
      p_organization_id,
      v_name,
      p_description,
      p_trigger_type,
      coalesce(p_trigger_config, '{}'::jsonb),
      coalesce(p_conditions, '[]'::jsonb),
      p_actions,
      coalesce(p_enabled, true),
      p_send_window,
      auth.uid()
    )
    returning * into v_row;
  else
    update public.automation_recipes
    set name = v_name,
        description = p_description,
        trigger_type = p_trigger_type,
        trigger_config = coalesce(p_trigger_config, '{}'::jsonb),
        conditions = coalesce(p_conditions, '[]'::jsonb),
        actions = p_actions,
        enabled = coalesce(p_enabled, true),
        send_window = p_send_window,
        updated_at = now()
    where recipe_id = p_recipe_id
      and organization_id = p_organization_id
    returning * into v_row;

    if v_row.recipe_id is null then
      raise exception 'Recipe not found' using errcode = 'P0002';
    end if;
  end if;

  return v_row;
end;
$$;

grant execute on function public.crm_upsert_recipe(uuid, uuid, text, text, text, jsonb, jsonb, jsonb, boolean, jsonb)
  to authenticated;
