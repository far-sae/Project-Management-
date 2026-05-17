-- Fix infinite recursion in client scoring.
--
-- clients_score_after_change calls recompute_client_score(), which updates the
-- same clients row. That update fires clients_score_after_change again. Stop the
-- loop by only writing the score columns when the computed values actually
-- changed.

create or replace function public.recompute_client_score(p_client_id uuid)
returns void language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  v_org uuid;
  v_client public.clients;
  v_recent_days int;
  v_open_deals int;
  v_score int := 0;
  v_band text;
  v_hot int; v_warm int;
  v_rule record;
  v_match boolean;
  v_field_val jsonb;
begin
  select * into v_client from public.clients where client_id = p_client_id;
  if v_client is null then return; end if;
  v_org := v_client.organization_id;

  select coalesce(extract(day from now() - max(occurred_at)), 9999)::int
    into v_recent_days
    from public.client_notes where client_id = p_client_id;

  select count(*) into v_open_deals
    from public.deals d
    join public.pipeline_stages s on s.stage_id = d.stage_id
    where d.client_id = p_client_id
      and not s.is_won and not s.is_lost;

  for v_rule in
    select * from public.lead_scoring_rules
    where organization_id = v_org and enabled order by position
  loop
    begin
      v_field_val := case v_rule.field
        when 'industry'        then to_jsonb(v_client.industry)
        when 'annual_revenue'  then to_jsonb(v_client.annual_revenue)
        when 'employee_count'  then to_jsonb(v_client.employee_count)
        when 'source'          then to_jsonb(v_client.source)
        when 'status'          then to_jsonb(v_client.status)
        when 'type'            then to_jsonb(v_client.type)
        when 'rating'          then to_jsonb(v_client.rating)
        when 'country'         then to_jsonb(v_client.country)
        when 'recent_activity_days' then to_jsonb(v_recent_days)
        when 'open_deals_count'     then to_jsonb(v_open_deals)
        when 'tag_present'          then to_jsonb(v_client.tags)
        else 'null'::jsonb
      end;

      v_match := case v_rule.operator
        when 'eq'  then v_field_val = v_rule.value
        when 'neq' then v_field_val <> v_rule.value
        when 'gte' then (v_field_val ->> 0)::numeric >= (v_rule.value)::text::numeric
                        or (v_field_val::text)::numeric >= (v_rule.value::text)::numeric
        when 'lte' then (v_field_val::text)::numeric <= (v_rule.value::text)::numeric
        when 'gt'  then (v_field_val::text)::numeric >  (v_rule.value::text)::numeric
        when 'lt'  then (v_field_val::text)::numeric <  (v_rule.value::text)::numeric
        when 'in'  then v_rule.value @> v_field_val
        when 'contains' then (v_field_val::text) ilike '%' || trim(both '"' from v_rule.value::text) || '%'
        when 'exists' then v_field_val is not null and v_field_val <> 'null'::jsonb
        else false
      end;

      if v_match then v_score := v_score + v_rule.points; end if;
    exception when others then
      null;
    end;
  end loop;

  v_score := greatest(-100, least(200, v_score));

  select hot, warm into v_hot, v_warm
    from public.lead_scoring_thresholds where organization_id = v_org;
  v_hot := coalesce(v_hot, 70);
  v_warm := coalesce(v_warm, 40);
  v_band := case when v_score >= v_hot then 'hot' when v_score >= v_warm then 'warm' else 'cold' end;

  update public.clients
  set score = v_score,
      score_band = v_band,
      score_updated_at = now()
  where client_id = p_client_id
    and (
      score is distinct from v_score
      or score_band is distinct from v_band
    );
end;
$$;

grant execute on function public.recompute_client_score(uuid) to authenticated;
