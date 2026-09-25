-- add_dashboard_status_filter.sql
-- 2026-09-25 — "can the [Activity Status] segments be used as a filter for the
-- page too just like the activity category donut chart"
--
-- The Activity Status donut (byStatus, added 2026-09-25 "Activity Status
-- chart" changelog entry) was deliberately shipped display-only: making it
-- clickable needs a p_status parameter on dashboard_filtered_ids /
-- dashboard_core / dashboard_extra, which didn't exist yet. This migration
-- adds it, the same way p_section was added on 2026-09-08 (see
-- add_dashboard_rpcs.sql's own "add_dashboard_section_filter" delta comment).
--
-- This file is the new consolidated, authoritative definition of all three
-- functions — it supersedes add_dashboard_rpcs.sql AND
-- add_dashboard_unknown_handling.sql for these three function bodies (both are
-- folded in here: p_section from the former, the employee_name ->
-- coalesce(employee_name, employee_missing_name) recovery from the latter,
-- marked "-- CHANGED" below same as before, plus dashboard_extra now also
-- getting that same employee fallback for consistency even though it doesn't
-- currently read employee_name itself).
--
-- Signature grows from 18 params to 19 (p_status inserted right after
-- p_weather, before the date-range params) — Postgres identifies a function
-- overload by name + full parameter list, so this DROPs the old 18-arg
-- signatures first, same as the 2026-09-08 section-filter delta had to.
--
-- Backward-compat note: the API route (src/app/api/dashboard/_lib.ts,
-- rpcWithRetry) detects a PostgREST "no matching function" error and retries
-- once with p_status stripped, so the dashboard keeps working with the OLD
-- signature if this migration hasn't been applied yet — the status filter
-- just silently won't narrow anything until this file is run. Apply this in
-- the Supabase SQL Editor to activate it.

-- ── drop the pre-p_status (18-arg) signatures before recreating at 19 args ──
drop function if exists public.dashboard_extra(text,text,text,text,text,text,numeric,numeric,text,text,text,text,text,text,text,text,text,text);
drop function if exists public.dashboard_core(text,text,text,text,text,text,numeric,numeric,text,text,text,text,text,text,text,text,text,text);
drop function if exists public.dashboard_filtered_ids(text,text,text,text,text,text,numeric,numeric,text,text,text,text,text,text,text,text,text,text);

-- ── shared filter predicate ───────────────────────────────────────────────
create or replace function public.dashboard_filtered_ids(
  p_category text default null, p_project text default null, p_section text default null,
  p_weather text default null, p_status text default null,
  p_date_from text default null, p_date_to text default null,
  p_ch_from numeric default null, p_ch_to numeric default null, p_search text default null,
  p_machine text default null, p_employee text default null, p_engineer text default null,
  p_supervisor text default null, p_ownership text default null, p_driver text default null,
  p_employee_role text default null, p_engineer_party text default null, p_supervisor_party text default null
)
returns setof bigint
language sql stable parallel safe as $$
  select r.id
  from public.hitech_report_hitechreport r
  where (p_category  is null or r.activity_category ilike p_category)
    and (p_project   is null or r.project_name      ilike p_project)
    and (p_section   is null or r.section_name      ilike p_section)
    and (p_weather   is null or r.weather           ilike p_weather)
    and (p_status    is null or r.activity_status   ilike p_status)
    and (p_date_from is null or r.date_of_activity >= p_date_from::date)
    and (p_date_to   is null or r.date_of_activity <= p_date_to::date)
    and (p_ch_from   is null or r.start_chainage_val >= p_ch_from)
    and (p_ch_to     is null or r.start_chainage_val <= p_ch_to)
    and (p_search    is null or (
          r.reporter_name    ilike '%'||p_search||'%'
       or r.project_name     ilike '%'||p_search||'%'
       or r.section_name     ilike '%'||p_search||'%'
       or r.activity_type    ilike '%'||p_search||'%'
       or r.comment_activity ilike '%'||p_search||'%'))
    and (p_machine    is null or exists (select 1 from public.hitech_report_hitechmachine x
           where x.report_id = r.id and lower(btrim(x.machine_name))    = lower(btrim(p_machine))))
    and (p_employee   is null or exists (select 1 from public.hitech_report_hitechemployee x   -- CHANGED
           where x.report_id = r.id and lower(btrim(coalesce(nullif(btrim(x.employee_name),''), x.employee_missing_name))) = lower(btrim(p_employee))))
    and (p_engineer   is null or exists (select 1 from public.hitech_report_hitechengineer x
           where x.report_id = r.id and lower(btrim(x.engineer_name))   = lower(btrim(p_engineer))))
    and (p_supervisor is null or exists (select 1 from public.hitech_report_hitechsupervisor x
           where x.report_id = r.id and lower(btrim(x.supervisor_name)) = lower(btrim(p_supervisor))))
    and (p_ownership  is null or exists (select 1 from public.hitech_report_hitechmachine x
           where x.report_id = r.id and lower(btrim(x.ownership))       = lower(btrim(p_ownership))))
    and (p_driver     is null or exists (select 1 from public.hitech_report_hitechmachine x
           where x.report_id = r.id and lower(btrim(x.driver_name))     = lower(btrim(p_driver))))
    and (p_employee_role    is null or exists (select 1 from public.hitech_report_hitechemployee x
           where x.report_id = r.id and lower(btrim(x.employee_role))   = lower(btrim(p_employee_role))))
    and (p_engineer_party   is null or exists (select 1 from public.hitech_report_hitechengineer x
           where x.report_id = r.id and lower(btrim(x.party))           = lower(btrim(p_engineer_party))))
    and (p_supervisor_party is null or exists (select 1 from public.hitech_report_hitechsupervisor x
           where x.report_id = r.id and lower(btrim(x.party))           = lower(btrim(p_supervisor_party))));
$$;

-- ── CORE ──────────────────────────────────────────────────────────────────
create or replace function public.dashboard_core(
  p_category text default null, p_project text default null, p_section text default null,
  p_weather text default null, p_status text default null,
  p_date_from text default null, p_date_to text default null,
  p_ch_from numeric default null, p_ch_to numeric default null, p_search text default null,
  p_machine text default null, p_employee text default null, p_engineer text default null,
  p_supervisor text default null, p_ownership text default null, p_driver text default null,
  p_employee_role text default null, p_engineer_party text default null, p_supervisor_party text default null
)
returns jsonb
language plpgsql stable parallel safe as $$
declare
  v_has boolean := (p_category is not null or p_project is not null or p_section is not null
    or p_weather is not null or p_status is not null
    or p_date_from is not null or p_date_to is not null or p_ch_from is not null or p_ch_to is not null
    or p_search is not null or p_machine is not null or p_employee is not null or p_engineer is not null
    or p_supervisor is not null or p_ownership is not null or p_driver is not null
    or p_employee_role is not null or p_engineer_party is not null or p_supervisor_party is not null);
  v_cutoff date := current_date - 29;
  v_month  date := date_trunc('month', current_date)::date;
  v_result jsonb;
begin
  with filt as materialized (
    select id from public.dashboard_filtered_ids(p_category,p_project,p_section,p_weather,p_status,p_date_from,p_date_to,
      p_ch_from,p_ch_to,p_search,p_machine,p_employee,p_engineer,p_supervisor,p_ownership,p_driver,
      p_employee_role,p_engineer_party,p_supervisor_party) as t(id)
  ),
  rep as materialized (
    select t.* from public.hitech_report_hitechreport t join filt on filt.id = t.id
  ),
  mac as materialized (
    select m.* from public.hitech_report_hitechmachine m
    where (not v_has or m.report_id in (select id from filt))
      and (p_machine is null or lower(btrim(m.machine_name)) = lower(btrim(p_machine)))
  ),
  emp as materialized (
    select e.* from public.hitech_report_hitechemployee e
    where (not v_has or e.report_id in (select id from filt))
      and (p_employee is null or lower(btrim(coalesce(nullif(btrim(e.employee_name),''), e.employee_missing_name))) = lower(btrim(p_employee)))  -- CHANGED
  ),
  eng as materialized (
    select e.* from public.hitech_report_hitechengineer e
    where (not v_has or e.report_id in (select id from filt))
      and (p_engineer is null or lower(btrim(e.engineer_name)) = lower(btrim(p_engineer)))
  ),
  sup as materialized (
    select s.* from public.hitech_report_hitechsupervisor s
    where (not v_has or s.report_id in (select id from filt))
      and (p_supervisor is null or lower(btrim(s.supervisor_name)) = lower(btrim(p_supervisor)))
  ),
  distinct_tc as (
    select 'proj'     k, public._titlecase(v) tc from (select distinct btrim(project_name)    v from rep) z where v <> ''
    union all select 'rep',  public._titlecase(v) from (select distinct btrim(reporter_name) v from rep) z where v <> ''
    union all select 'mac',  public._titlecase(v) from (select distinct btrim(machine_name)  v from mac) z where v <> ''
    union all select 'drv',  public._titlecase(v) from (select distinct btrim(driver_name)   v from mac) z where v <> ''
    union all select 'emp',  public._titlecase(v) from (select distinct btrim(coalesce(nullif(btrim(employee_name),''), employee_missing_name)) v from emp) z where v <> ''  -- CHANGED
    union all select 'eng',  public._titlecase(v) from (select distinct btrim(engineer_name) v from eng) z where v <> ''
    union all select 'sup',  public._titlecase(v) from (select distinct btrim(supervisor_name) v from sup) z where v <> ''
  )
  select jsonb_build_object(
    'summary', jsonb_build_object(
      'totalReports',     (select count(*) from rep),
      'reportsThisMonth', (select count(*) from rep where date_of_activity >= v_month),
      'activeProjects',   (select count(distinct public._titlecase(btrim(project_name))) from rep
                             where date_of_activity >= v_cutoff and btrim(project_name) <> ''),
      'totalPhotos',      (select count(*) from public.hitech_report_hitechphoto p
                             where p.media_type ilike 'image'
                               and (not v_has or p.report_id in (select id from filt))),
      'uniqueReporters',  (select count(distinct tc) from distinct_tc where k='rep'),
      'completionRate',   (select case when count(*) = 0 then 0 else
                             round(100.0 * count(*) filter (where public._titlecase(activity_status) in ('Completed','Complete')) / count(*))
                           end from rep)
    ),
    'byCategory', public._dash_group(array(select activity_category::text from rep), 7),
    'byProject',  public._dash_group(array(select project_name::text      from rep), 8),
    'byWeather',  public._dash_group(array(select weather::text           from rep), 6),
    'byStatus',   public._dash_group(array(select activity_status::text   from rep), null),
    'byDay', (
      select coalesce(jsonb_agg(jsonb_build_object('date', to_char(d.day::date,'YYYY-MM-DD'), 'count', coalesce(c.n,0)) order by d.day), '[]'::jsonb)
      from generate_series(v_cutoff, current_date, interval '1 day') d(day)
      left join (select date_of_activity dd, count(*) n from rep group by 1) c on c.dd = d.day::date),
    'byMachine',         public._dash_group(array(select machine_name::text    from mac), 15),
    'byOwnership',       public._dash_group(array(select ownership::text        from mac), null),
    'byDriver',          public._dash_group(array(select driver_name::text      from mac), 15),
    'byEmployee',        public._dash_group(array(select coalesce(nullif(btrim(employee_name),''), employee_missing_name)::text from emp), 15),  -- CHANGED
    'byEmployeeRole',    public._dash_group(array(select employee_role::text    from emp), null),
    'byEngineer',        public._dash_group(array(select engineer_name::text    from eng), 15),
    'byEngineerParty',   public._dash_group(array(select party::text            from eng), null),
    'bySupervisor',      public._dash_group(array(select supervisor_name::text  from sup), 15),
    'bySupervisorParty', public._dash_group(array(select party::text            from sup), null),
    'machineSummary', jsonb_build_object(
      'totalMentions',    (select count(*) from mac),
      'distinctMachines', (select count(distinct tc) from distinct_tc where k='mac'),
      'distinctDrivers',  (select count(distinct tc) from distinct_tc where k='drv')),
    'employeeSummary', jsonb_build_object(
      'totalMentions',     (select count(*) from emp),
      'distinctEmployees', (select count(distinct tc) from distinct_tc where k='emp')),
    'engineerSummary', jsonb_build_object(
      'totalMentions',     (select count(*) from eng),
      'distinctEngineers', (select count(distinct tc) from distinct_tc where k='eng')),
    'supervisorSummary', jsonb_build_object(
      'totalMentions',       (select count(*) from sup),
      'distinctSupervisors', (select count(distinct tc) from distinct_tc where k='sup')),
    'filterOptions', jsonb_build_object(
      'categories', (select coalesce(jsonb_agg(tc order by tc), '[]'::jsonb) from (
                       select distinct public._titlecase(btrim(activity_category)) tc
                       from public.hitech_report_hitechreport where btrim(activity_category) <> '') z),
      'projects',   (select coalesce(jsonb_agg(tc order by tc), '[]'::jsonb) from (
                       select distinct public._titlecase(btrim(project_name)) tc
                       from public.hitech_report_hitechreport where btrim(project_name) <> '') z),
      'sections',   (select coalesce(jsonb_agg(tc order by tc), '[]'::jsonb) from (
                       select distinct public._titlecase(btrim(section_name)) tc
                       from public.hitech_report_hitechreport where btrim(section_name) <> '') z))
  ) into v_result;
  return v_result;
end;
$$;

-- ── EXTRA ─────────────────────────────────────────────────────────────────
create or replace function public.dashboard_extra(
  p_category text default null, p_project text default null, p_section text default null,
  p_weather text default null, p_status text default null,
  p_date_from text default null, p_date_to text default null,
  p_ch_from numeric default null, p_ch_to numeric default null, p_search text default null,
  p_machine text default null, p_employee text default null, p_engineer text default null,
  p_supervisor text default null, p_ownership text default null, p_driver text default null,
  p_employee_role text default null, p_engineer_party text default null, p_supervisor_party text default null
)
returns jsonb
language plpgsql stable parallel safe as $$
declare
  v_has boolean := (p_category is not null or p_project is not null or p_section is not null
    or p_weather is not null or p_status is not null
    or p_date_from is not null or p_date_to is not null or p_ch_from is not null or p_ch_to is not null
    or p_search is not null or p_machine is not null or p_employee is not null or p_engineer is not null
    or p_supervisor is not null or p_ownership is not null or p_driver is not null
    or p_employee_role is not null or p_engineer_party is not null or p_supervisor_party is not null);
  v_recent int := case when p_search is not null then 300 else 12 end;
  v_result jsonb;
begin
  with filt as materialized (
    select id from public.dashboard_filtered_ids(p_category,p_project,p_section,p_weather,p_status,p_date_from,p_date_to,
      p_ch_from,p_ch_to,p_search,p_machine,p_employee,p_engineer,p_supervisor,p_ownership,p_driver,
      p_employee_role,p_engineer_party,p_supervisor_party) as t(id)
  ),
  rep as materialized (
    select t.* from public.hitech_report_hitechreport t join filt on filt.id = t.id
  )
  select jsonb_build_object(
    -- mapPoints: not consumed by the dashboard page (UnifiedMap fetches /api/map
    -- itself). Kept as an empty array so the DashData shape is unchanged.
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

revoke all on function public.dashboard_filtered_ids from public, anon, authenticated;
revoke all on function public.dashboard_core           from public, anon, authenticated;
revoke all on function public.dashboard_extra          from public, anon, authenticated;
grant execute on function public.dashboard_filtered_ids to service_role;
grant execute on function public.dashboard_core           to service_role;
grant execute on function public.dashboard_extra          to service_role;

-- ── verification queries (run manually after applying) ─────────────────────
-- select jsonb_pretty((public.dashboard_core(p_status := 'Completed'))->'summary');
-- select jsonb_pretty((public.dashboard_core(p_status := 'Ongoing'))->'summary');
-- select (public.dashboard_core())->'byStatus';  -- unfiltered: should still list all 5
