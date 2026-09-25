-- add_dashboard_machine_trends.sql
-- 2026-09-25 — three /machines improvements picked from a brainstorm list:
--   1. Activity-over-time trend for machine usage (no chart on that page uses
--      date_of_activity at all — everything is a plain ranked count).
--   2. Driver × Machine cross-reference (which driver operates which machine
--      most) — a new angle on data that's already joined in dashboard_core's
--      existing `mac` CTE, nothing new to fetch from the base tables.
--   3. Low-utilization flag on the Machines Used list — pure frontend, no SQL
--      needed (byMachine already carries the count each row needs).
--
-- Unlike add_dashboard_status_filter.sql, this is a SAFE, purely additive
-- change: it adds two new keys to dashboard_core's returned jsonb, but does
-- NOT change its parameter list (still the same 19 params) — so no "no
-- matching function" risk, no drop-function-first step, and no retry/
-- degradation safeguard needed in the API route. Before this is applied, the
-- two new keys simply aren't present in the response; the frontend treats
-- them as optional (`?? []`) so the page renders normally either way — the
-- two new widgets just show their own empty state until this runs.
--
-- CREATE OR REPLACE dashboard_core in full (a function body can't be
-- partially altered) — identical to the version in
-- add_dashboard_status_filter.sql except for the two new CTEs
-- (mac_dated, driver_machine) and the two new jsonb_build_object entries
-- (machineActivityByDay, driverMachineCross), both marked "-- NEW" below.

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
  -- NEW: mac joined back to its report's date, for machineActivityByDay.
  -- mac.report_id is always found in rep — when v_has, mac is explicitly
  -- restricted to filt; when not v_has, filt/rep is the whole table, so
  -- every mac row's report_id is still present. An inner join is safe.
  mac_dated as materialized (
    select m2.*, r3.date_of_activity as dd
    from mac m2 join rep r3 on r3.id = m2.report_id
  ),
  emp as materialized (
    select e.* from public.hitech_report_hitechemployee e
    where (not v_has or e.report_id in (select id from filt))
      and (p_employee is null or lower(btrim(coalesce(nullif(btrim(e.employee_name),''), e.employee_missing_name))) = lower(btrim(p_employee)))
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
    union all select 'emp',  public._titlecase(v) from (select distinct btrim(coalesce(nullif(btrim(employee_name),''), employee_missing_name)) v from emp) z where v <> ''
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
    -- NEW: same generate_series/left-join shape as byDay above, counting
    -- machine mentions (mac_dated) per day instead of reports per day.
    'machineActivityByDay', (
      select coalesce(jsonb_agg(jsonb_build_object('date', to_char(d.day::date,'YYYY-MM-DD'), 'count', coalesce(c.n,0)) order by d.day), '[]'::jsonb)
      from generate_series(v_cutoff, current_date, interval '1 day') d(day)
      left join (select dd, count(*) n from mac_dated where dd is not null group by 1) c on c.dd = d.day::date),
    'byMachine',         public._dash_group(array(select machine_name::text    from mac), 15),
    'byOwnership',       public._dash_group(array(select ownership::text        from mac), null),
    'byDriver',          public._dash_group(array(select driver_name::text      from mac), 15),
    -- NEW: top driver+machine pairs by mention count — both sides must be
    -- non-blank (a driver with no machine, or vice versa, isn't a real pair).
    'driverMachineCross', (
      select coalesce(jsonb_agg(jsonb_build_object('driver', driver, 'machine', machine, 'count', n) order by n desc, driver, machine), '[]'::jsonb)
      from (
        select public._titlecase(btrim(driver_name)) driver, public._titlecase(btrim(machine_name)) machine, count(*) n
        from mac
        where btrim(driver_name) <> '' and btrim(machine_name) <> ''
        group by 1, 2
        order by n desc
        limit 12
      ) x),
    'byEmployee',        public._dash_group(array(select coalesce(nullif(btrim(employee_name),''), employee_missing_name)::text from emp), 15),
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

revoke all on function public.dashboard_core from public, anon, authenticated;
grant execute on function public.dashboard_core to service_role;

-- ── verification queries (run manually after applying) ─────────────────────
-- select (public.dashboard_core())->'machineActivityByDay';
-- select (public.dashboard_core())->'driverMachineCross';
-- select (public.dashboard_core(p_machine := 'GPS'))->'driverMachineCross';  -- should only show GPS pairs
