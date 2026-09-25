-- add_dashboard_personnel_trends.sql
-- 2026-09-25 — two /personnel improvements, picked from a recommendation
-- list given after the equivalent /machines work earlier the same day:
--   1. Personnel Activity Trend — this page had zero time dimension anywhere
--      (same real gap /machines had before its own (5) entry): no chart uses
--      date_of_activity. A 3-series (employees/engineers/supervisors)
--      mentions-per-day trend, not just one blended count — the three join
--      tables aren't a normalized unit, so summing them into one series would
--      be a meaningless number.
--   2. Engineer × Supervisor cross-reference — the same "stacked bars per
--      primary entity, segmented by counterpart" shape as /machines' Driver ×
--      Machine, but here answering a genuinely different, org-structural
--      question: which supervisor's reports are staffed by which engineers.
--      Checked the real data before building (not assumed the same lopsided
--      shape /machines had): bySupervisor is fairly evenly spread (1425 down
--      to 61 across 14 people, no single overwhelming leader) and byEngineer
--      only has a mild 2:1 lead (Believe 1151 vs TONY 563) — nowhere near the
--      10:1 skew one dominant driver had, so this is expected to render
--      cleanly without needing the aggressive row/legend caps that fix
--      needed. Capped defensively anyway, for robustness against future data.
--
-- Purely additive to dashboard_core, like add_dashboard_machine_trends.sql —
-- two new output keys, same 19-parameter signature, no new RPC parameter, so
-- no signature-mismatch risk and no retry safeguard needed. Both are optional
-- on the response until this is applied — the frontend defaults with `?? []`
-- / a length check, same convention as every other pending-migration field.
--
-- CREATE OR REPLACE dashboard_core in full (a function body can't be
-- partially altered) — identical to add_dashboard_driver_machine_stacked.sql
-- except for the new CTEs and two new jsonb_build_object entries, both
-- marked "-- NEW" below.

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
  -- NEW: employee/engineer/supervisor mentions joined back to their report's
  -- date, for personnelActivityByDay — same mac_dated pattern as above.
  emp_dated as materialized (
    select e2.*, r3.date_of_activity as dd from emp e2 join rep r3 on r3.id = e2.report_id
  ),
  eng_dated as materialized (
    select e2.*, r3.date_of_activity as dd from eng e2 join rep r3 on r3.id = e2.report_id
  ),
  sup_dated as materialized (
    select s2.*, r3.date_of_activity as dd from sup s2 join rep r3 on r3.id = s2.report_id
  ),
  -- NEW: engineer x supervisor co-occurrence (same report_id), reshaped for
  -- a stacked bar per supervisor — mirrors dm_* above with the roles swapped
  -- and the join table changed from a shared report_id column to matching
  -- across the eng/sup tables directly (no report_id column of its own to
  -- group by, unlike mac's driver_name/machine_name which live on one row).
  es_pairs as materialized (
    select public._titlecase(btrim(s.supervisor_name)) supervisor, public._titlecase(btrim(e.engineer_name)) engineer, count(*) n
    from sup s
    join eng e on e.report_id = s.report_id
    where btrim(s.supervisor_name) <> '' and btrim(e.engineer_name) <> ''
    group by 1, 2
  ),
  es_supervisor_totals as materialized (
    select supervisor, sum(n) total
    from es_pairs
    group by 1
    order by total desc
    limit 10
  ),
  es_ranked as materialized (
    select p.supervisor, p.engineer, p.n,
      row_number() over (partition by p.supervisor order by p.n desc) as rn
    from es_pairs p
    join es_supervisor_totals t on t.supervisor = p.supervisor
  ),
  es_capped as materialized (
    select supervisor, case when rn <= 5 then engineer else 'Other' end as engineer, n
    from es_ranked
  ),
  es_final as materialized (
    select supervisor, engineer, sum(n) as n
    from es_capped
    group by 1, 2
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
    -- NEW: 3-series personnel mentions per day — deliberately not blended
    -- into one number, since employees/engineers/supervisors are 3 separate
    -- join tables, not a normalized unit.
    'personnelActivityByDay', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'date', to_char(d.day::date,'YYYY-MM-DD'),
        'employees', coalesce(ce.n,0), 'engineers', coalesce(cg.n,0), 'supervisors', coalesce(cs.n,0)
      ) order by d.day), '[]'::jsonb)
      from generate_series(v_cutoff, current_date, interval '1 day') d(day)
      left join (select dd, count(*) n from emp_dated where dd is not null group by 1) ce on ce.dd = d.day::date
      left join (select dd, count(*) n from eng_dated where dd is not null group by 1) cg on cg.dd = d.day::date
      left join (select dd, count(*) n from sup_dated where dd is not null group by 1) cs on cs.dd = d.day::date),
    'byMachine',         public._dash_group(array(select machine_name::text    from mac), 15),
    'byOwnership',       public._dash_group(array(select ownership::text        from mac), null),
    'byDriver',          public._dash_group(array(select driver_name::text      from mac), 15),
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
    -- NEW: nested per-supervisor shape, same convention as driverMachineCross.
    'engineerSupervisorCross', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'supervisor', t.supervisor,
        'total', t.total,
        'engineers', (
          select coalesce(jsonb_agg(jsonb_build_object('engineer', f.engineer, 'count', f.n) order by f.n desc), '[]'::jsonb)
          from es_final f where f.supervisor = t.supervisor)
      ) order by t.total desc), '[]'::jsonb)
      from es_supervisor_totals t),
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
-- select (public.dashboard_core())->'personnelActivityByDay';
-- select (public.dashboard_core())->'engineerSupervisorCross';
