-- add_dashboard_driver_machine_stacked.sql
-- 2026-09-25 — redesign /machines' "Driver × Machine" card from a flat top-12
-- (driver, machine) pairs list into per-driver stacked bars.
--
-- Why: the flat top-12-pairs version (add_dashboard_machine_trends.sql)
-- shipped and was confirmed working, but the real data turned out lopsided —
-- one driver logs far more activity than everyone else, so 11 of the 12
-- top pairs were all the SAME driver against different machines. It read as
-- "this one person's machine list," not a genuine cross-reference across the
-- driver roster. Proposed three redesigns (a per-driver top-machine list, a
-- driver×machine heatmap, stacked bars per driver) with mockups via
-- AskUserQuestion — user picked stacked bars per driver.
--
-- `driverMachineCross`'s SHAPE changes here, from a flat array of
-- {driver, machine, count} pairs to a nested array of
-- {driver, total, machines: [{machine, count}, ...]} — one entry per driver
-- (top 10 by total mentions), each carrying its own top-5-machines-plus-
-- "Other" breakdown so a driver who touches many machine types doesn't blow
-- up the bar into dozens of slivers. Still purely additive to dashboard_core
-- as a whole (same 19-param signature, no new RPC parameter) — the frontend
-- guards against the OLD flat shape still being live (filters out any entry
-- missing a real `machines` array), so it degrades to the same "empty until
-- applied" state as every other pending-migration field in this file, not a
-- crash, if this hasn't been run yet.
--
-- CREATE OR REPLACE dashboard_core in full (a function body can't be
-- partially altered) — identical to add_dashboard_machine_trends.sql except
-- for the driverMachineCross computation, replaced end-to-end with the new
-- dm_* CTE pipeline below (marked "-- NEW").

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
  mac_dated as materialized (
    select m2.*, r3.date_of_activity as dd
    from mac m2 join rep r3 on r3.id = m2.report_id
  ),
  -- NEW: driver × machine breakdown, reshaped for a stacked bar per driver.
  dm_pairs as materialized (
    select public._titlecase(btrim(driver_name)) driver, public._titlecase(btrim(machine_name)) machine, count(*) n
    from mac
    where btrim(driver_name) <> '' and btrim(machine_name) <> ''
    group by 1, 2
  ),
  dm_driver_totals as materialized (
    select driver, sum(n) total
    from dm_pairs
    group by 1
    order by total desc
    limit 10
  ),
  dm_ranked as materialized (
    select p.driver, p.machine, p.n,
      row_number() over (partition by p.driver order by p.n desc) as rn
    from dm_pairs p
    join dm_driver_totals t on t.driver = p.driver
  ),
  -- top 5 machines kept literal per driver; the rest collapse into "Other"
  -- so a driver who's touched a dozen machine types doesn't blow the bar
  -- into unreadable slivers.
  dm_capped as materialized (
    select driver, case when rn <= 5 then machine else 'Other' end as machine, n
    from dm_ranked
  ),
  dm_final as materialized (
    select driver, machine, sum(n) as n
    from dm_capped
    group by 1, 2
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
    'machineActivityByDay', (
      select coalesce(jsonb_agg(jsonb_build_object('date', to_char(d.day::date,'YYYY-MM-DD'), 'count', coalesce(c.n,0)) order by d.day), '[]'::jsonb)
      from generate_series(v_cutoff, current_date, interval '1 day') d(day)
      left join (select dd, count(*) n from mac_dated where dd is not null group by 1) c on c.dd = d.day::date),
    'byMachine',         public._dash_group(array(select machine_name::text    from mac), 15),
    'byOwnership',       public._dash_group(array(select ownership::text        from mac), null),
    'byDriver',          public._dash_group(array(select driver_name::text      from mac), 15),
    -- NEW: nested per-driver shape — see the dm_* CTE comments above.
    'driverMachineCross', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'driver', t.driver,
        'total', t.total,
        'machines', (
          select coalesce(jsonb_agg(jsonb_build_object('machine', f.machine, 'count', f.n) order by f.n desc), '[]'::jsonb)
          from dm_final f where f.driver = t.driver)
      ) order by t.total desc), '[]'::jsonb)
      from dm_driver_totals t),
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
-- select (public.dashboard_core())->'driverMachineCross';
-- -- each entry should look like {"driver":"...", "total":N, "machines":[{"machine":"...","count":N}, ...]}
