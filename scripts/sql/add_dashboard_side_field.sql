-- add_dashboard_side_field.sql
--
-- Adds `side` (LHS / RHS / Median) to `recentReports` on dashboard_extra, for
-- /dashboard's "Recent Activity Reports" table and the map's report popup.
--
-- hitech_report_hitechreport DOES have a real `side` column — previously
-- undocumented in CLAUDE.md, confirmed live (not assumed) by sampling the
-- table directly before writing this migration. 9,780 reports, 0 null, 2
-- blank; the real raw values are dirtier than the clean three-way split used
-- elsewhere in this project (road_assets/hitech_construction_entities):
--   RHS 3495, LHS 5063, Median 188, MEDIAN 1010, Left 19, Right 3, (blank) 2
-- _normalize_side() collapses all of that to the canonical 'LHS'/'RHS'/
-- 'Median' (matching this project's existing side-value convention) or null
-- for the 2 blank rows, so the frontend never has to handle the raw variants.
--
-- Purely additive: `dashboard_extra`'s parameter list is unchanged, only one
-- new key is added inside its returned jsonb (same category as
-- add_dashboard_machine_trends.sql's new output keys) — no DROP FUNCTION
-- needed, and no rpcWithRetry/OPTIONAL_ARGS safeguard needed either, since
-- there's no way for this change to make an existing call fail to resolve.
-- `side` is simply absent from a `recentReports` row until this is applied;
-- the frontend reads it as optional and falls back to "—".

create or replace function public._normalize_side(s text)
returns text language sql immutable as $$
  select case
    when s is null or btrim(s) = '' then null
    when upper(btrim(s)) in ('LHS','LEFT','L') then 'LHS'
    when upper(btrim(s)) in ('RHS','RIGHT','R') then 'RHS'
    when upper(btrim(s)) like 'MED%' then 'Median'
    else public._titlecase(s)
  end
$$;

create or replace function public.dashboard_extra(
  p_category text default null, p_project text default null, p_section text default null,
  p_weather text default null, p_status text default null,
  p_date_from text default null, p_date_to text default null,
  p_ch_from numeric default null, p_ch_to numeric default null, p_search text default null,
  p_machine text default null, p_employee text default null, p_engineer text default null,
  p_supervisor text default null, p_ownership text default null, p_driver text default null,
  p_employee_role text default null, p_engineer_party text default null, p_supervisor_party text default null,
  p_planned boolean default null
)
returns jsonb
language plpgsql stable parallel safe as $$
declare
  v_has boolean := (p_category is not null or p_project is not null or p_section is not null
    or p_weather is not null or p_status is not null
    or p_date_from is not null or p_date_to is not null or p_ch_from is not null or p_ch_to is not null
    or p_search is not null or p_machine is not null or p_employee is not null or p_engineer is not null
    or p_supervisor is not null or p_ownership is not null or p_driver is not null
    or p_employee_role is not null or p_engineer_party is not null or p_supervisor_party is not null
    or p_planned is not null);
  v_recent int := case when p_search is not null then 300 else 12 end;
  v_result jsonb;
begin
  with filt as materialized (
    select id from public.dashboard_filtered_ids(p_category,p_project,p_section,p_weather,p_status,p_date_from,p_date_to,
      p_ch_from,p_ch_to,p_search,p_machine,p_employee,p_engineer,p_supervisor,p_ownership,p_driver,
      p_employee_role,p_engineer_party,p_supervisor_party,p_planned) as t(id)
  ),
  rep as materialized (
    select t.* from public.hitech_report_hitechreport t join filt on filt.id = t.id
  )
  select jsonb_build_object(
    'mapPoints', '[]'::jsonb,
    'activityCalendar', (
      select coalesce(jsonb_agg(jsonb_build_object('date', to_char(dd,'YYYY-MM-DD'), 'count', n, 'projects', projs) order by dd), '[]'::jsonb)
      from (
        select date_of_activity dd, count(*) n,
               coalesce(jsonb_agg(distinct public._titlecase(project_name)) filter (where btrim(project_name) <> ''), '[]'::jsonb) projs
        from rep where date_of_activity is not null group by 1
      ) s),
    'recentReports', (
      select coalesce(jsonb_agg(to_jsonb(x) order by x.date_of_activity desc nulls last, x.id desc), '[]'::jsonb)
      from (
        select id, to_char(date_of_activity,'YYYY-MM-DD') date_of_activity, reporter_name, project_name, section_name,
               activity_category, activity_type, activity_status, comment_activity, weather,
               public._normalize_side(side) as side,
               start_chainage, end_chainage, start_chainage_lat, start_chainage_long, end_chainage_lat, end_chainage_long
        from rep order by date_of_activity desc nulls last, id desc limit v_recent
      ) x),
    'mediaItems', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'file', file, 'media_type', coalesce(nullif(media_type,''),'image'),
        'project_name', coalesce(public._titlecase(pname),''))), '[]'::jsonb)
      from (
        select p.file, p.media_type, r2.project_name pname
        from public.hitech_report_hitechphoto p
        left join public.hitech_report_hitechreport r2 on r2.id = p.report_id
        where p.file is not null and p.file <> ''
          and (not v_has or p.report_id in (select id from filt))
        order by p.id desc
        limit 600
      ) m
      where not v_has or coalesce(btrim(pname),'') <> '')
  ) into v_result;
  return v_result;
end;
$$;

revoke all on function public.dashboard_extra from public, anon, authenticated;
grant execute on function public.dashboard_extra to service_role;

-- Verification (run after applying, expect non-null 'side' on every row of
-- recentReports for an unfiltered call, values only ever LHS/RHS/Median):
--   select jsonb_path_query_array(dashboard_extra(), '$.recentReports[*].side');
