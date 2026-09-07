import { NextRequest, NextResponse } from 'next/server'
import { getIronSession } from 'iron-session'
import { createClient } from '@supabase/supabase-js'
import { sessionOptions, AppSession } from '@/lib/session'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

function toTitleCase(s: string): string {
  return (s || '').trim().replace(/\b\w/g, c => c.toUpperCase())
}

function groupCount(vals: string[]): Array<{ name: string; count: number }> {
  const map: Record<string, number> = {}
  for (const v of vals) {
    const k = toTitleCase(v) || 'Unknown'
    map[k] = (map[k] || 0) + 1
  }
  return Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({ name, count }))
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchAll<T = Record<string, unknown>>(query: any): Promise<T[]> {
  const all: T[] = []
  const PAGE = 1000
  let from = 0
  while (true) {
    const { data, error } = await (query as any).range(from, from + PAGE - 1)
    if (error || !data || data.length === 0) break
    all.push(...data)
    if (data.length < PAGE) break
    from += PAGE
  }
  return all
}

export async function GET(req: NextRequest) {
  const res = NextResponse.json({})
  const session = await getIronSession<AppSession>(req, res, sessionOptions)
  if (!session.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const filterCategory = searchParams.get('category')  || ''
  const filterProject  = searchParams.get('project')   || ''
  const filterSection  = searchParams.get('section')   || ''
  const filterDateFrom = searchParams.get('date_from') || ''
  const filterDateTo   = searchParams.get('date_to')   || ''
  const filterChFrom   = searchParams.get('ch_from')   || ''
  const filterChTo     = searchParams.get('ch_to')     || ''
  const filterSearch   = (searchParams.get('search')   || '').trim()
  const filterWeather    = searchParams.get('weather')    || ''
  const filterMachine    = searchParams.get('machine')    || ''
  const filterEmployee   = searchParams.get('employee')   || ''
  const filterEngineer   = searchParams.get('engineer')   || ''
  const filterSupervisor = searchParams.get('supervisor') || ''
  const filterOwnership       = searchParams.get('ownership')        || ''
  const filterDriver          = searchParams.get('driver')           || ''
  const filterEmployeeRole    = searchParams.get('employee_role')    || ''
  const filterEngineerParty   = searchParams.get('engineer_party')   || ''
  const filterSupervisorParty = searchParams.get('supervisor_party') || ''

  // Strip characters that would break PostgREST .or() filter syntax
  const searchTerm = filterSearch.replace(/[,()%*]/g, '')
  const searchOr = searchTerm
    ? ['reporter_name', 'project_name', 'section_name', 'activity_type', 'comment_activity']
        .map(col => `${col}.ilike.%${searchTerm}%`)
        .join(',')
    : ''

  // Chainage filter is only active when BOTH values are present and numeric
  const chFromNum = Number(filterChFrom)
  const chToNum   = Number(filterChTo)
  const applyChFilter = !!(
    filterChFrom && filterChTo &&
    !isNaN(chFromNum) && !isNaN(chToNum) &&
    chFromNum >= 0 && chToNum >= 0 &&
    chToNum > chFromNum
  )

  const now = new Date()
  const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    .toISOString().split('T')[0]

  const dayMap: Record<string, number> = {}
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now)
    d.setDate(d.getDate() - i)
    dayMap[d.toISOString().split('T')[0]] = 0
  }
  const cutoff = Object.keys(dayMap)[0]

  function buildLiteQuery() {
    let q = supabase
    .from('hitech_report_hitechreport')
    .select(
      'id, activity_category, project_name, date_of_activity, weather, ' +
      'activity_status, reporter_name, start_chainage_lat, start_chainage_long, ' +
      'end_chainage_lat, end_chainage_long, start_chainage_val, end_chainage_val'
    )
    if (filterCategory) q = (q as any).ilike('activity_category', filterCategory)
    if (filterProject)  q = (q as any).ilike('project_name',      filterProject)
    if (filterSection)  q = (q as any).ilike('section_name',      filterSection)
    if (filterWeather)  q = (q as any).ilike('weather',           filterWeather)
    if (filterDateFrom) q = (q as any).gte('date_of_activity',    filterDateFrom)
    if (filterDateTo)   q = (q as any).lte('date_of_activity',    filterDateTo)
    if (searchOr)        q = (q as any).or(searchOr)
    if (applyChFilter) {
      q = (q as any).gte('start_chainage_val', chFromNum)
      q = (q as any).lte('start_chainage_val', chToNum)
    }
    return q
  }

  const [allRaw, totalMediaResult, machines, employees, engineers, supervisors, filterOptions] =
    await Promise.all([
      fetchAll(buildLiteQuery()),

      supabase
        .from('hitech_report_hitechphoto')
        .select('id', { count: 'exact', head: true })
        .eq('media_type', 'image'),

      fetchAll(supabase
        .from('hitech_report_hitechmachine')
        .select('machine_name, ownership, driver_name, fleet_number, report_id')),

      fetchAll(supabase
        .from('hitech_report_hitechemployee')
        .select('employee_name, employee_role, report_id')),

      fetchAll(supabase
        .from('hitech_report_hitechengineer')
        .select('engineer_name, party, report_id')),

      fetchAll(supabase
        .from('hitech_report_hitechsupervisor')
        .select('supervisor_name, party, report_id')),

      fetchAll(supabase
        .from('hitech_report_hitechreport')
        .select('activity_category, project_name, section_name')),
    ])

  // Machine/Employee/Engineer/Supervisor filters are resolved in-memory: those
  // tables are already fetched in full on every request, so no extra round trip.
  function matchReportIds(rows: Record<string, unknown>[], field: string, filterVal: string): Set<number> | null {
    if (!filterVal) return null
    const target = filterVal.toLowerCase()
    return new Set(
      rows
        .filter(r => toTitleCase(r[field] as string).toLowerCase() === target)
        .map(r => r.report_id as number)
    )
  }
  const hrIdSets = [
    matchReportIds(machines,    'machine_name',    filterMachine),
    matchReportIds(employees,   'employee_name',   filterEmployee),
    matchReportIds(engineers,   'engineer_name',   filterEngineer),
    matchReportIds(supervisors, 'supervisor_name', filterSupervisor),
    matchReportIds(machines,    'ownership',       filterOwnership),
    matchReportIds(machines,    'driver_name',     filterDriver),
    matchReportIds(employees,   'employee_role',   filterEmployeeRole),
    matchReportIds(engineers,   'party',           filterEngineerParty),
    matchReportIds(supervisors, 'party',           filterSupervisorParty),
  ].filter((s): s is Set<number> => s !== null)
  const hrRestrictIds = hrIdSets.length
    ? hrIdSets.reduce((acc, s) => new Set([...acc].filter(id => s.has(id))))
    : null

  const all = hrRestrictIds ? allRaw.filter(r => hrRestrictIds.has((r as any).id as number)) : allRaw

  const filteredIds = new Set(all.map(r => (r as any).id as number))
  const hasFilters  = !!(filterProject || filterCategory || filterSection || filterWeather || filterDateFrom || filterDateTo || applyChFilter || searchOr || hrRestrictIds)

  // Most-recent-first ordering of the fully filtered set (all filters,
  // including machine/employee/engineer/supervisor applied above) — shared by
  // the recent-reports feed and the media gallery below, so both draw from
  // the same "most relevant reports for this filter" pool instead of a
  // separate, unfiltered global sample.
  const sortedAll = [...all].sort((a, b) => {
    const d = ((b as any).date_of_activity || '').localeCompare((a as any).date_of_activity || '')
    return d !== 0 ? d : ((b as any).id as number) - ((a as any).id as number)
  })

  // Recent-reports feed: take the most-recent N ids from the FULLY filtered set,
  // then fetch their display fields. Doing this against `all` — rather than
  // limiting the DB query to N rows before applying the HR filter — avoids
  // returning an empty feed when the most-recent rows overall happen not to
  // match a narrow filter.
  const recentIds = sortedAll.slice(0, searchOr ? 300 : 12).map(r => (r as any).id as number)

  // Media gallery: when any filter is active, scope the photo query to the
  // filtered report ids (capped, most-recent-first) instead of a global
  // "most recently uploaded" sample — a narrow filter's matching photos are
  // very unlikely to fall within the last 600 uploads site-wide, which
  // previously made the gallery look empty/wrong under filtering even though
  // matching photos existed (the same class of bug the recent-reports feed
  // above was already fixed for).
  const mediaReportIds = hasFilters ? sortedAll.slice(0, 800).map(r => (r as any).id as number) : null

  const [recent, media] = await Promise.all([
    recentIds.length
      ? supabase
          .from('hitech_report_hitechreport')
          .select('id, date_of_activity, reporter_name, project_name, section_name, activity_category, activity_type, activity_status, comment_activity, weather, start_chainage, end_chainage, start_chainage_lat, start_chainage_long, end_chainage_lat, end_chainage_long')
          .in('id', recentIds)
          .order('date_of_activity', { ascending: false })
          .order('id', { ascending: false })
          .then(r => r.data ?? [])
      : Promise.resolve([]),

    mediaReportIds
      ? (mediaReportIds.length
          ? supabase
              .from('hitech_report_hitechphoto')
              .select('file, media_type, report_id')
              .in('report_id', mediaReportIds)
              .order('id', { ascending: false })
              .limit(800)
              .then(r => ({ data: r.data ?? [] }))
          : Promise.resolve({ data: [] }))
      : supabase
          .from('hitech_report_hitechphoto')
          .select('file, media_type, report_id')
          .order('id', { ascending: false })
          .limit(600)
          .then(r => ({ data: r.data ?? [] })),
  ])

  const totalReports     = all.length
  const reportsThisMonth = all.filter(r => (r as any).date_of_activity >= thisMonthStart).length
  const activeProjects   = new Set(
    all.filter(r => (r as any).date_of_activity >= cutoff).map(r => (r as any).project_name).filter(Boolean)
  ).size
  const uniqueReporters  = new Set(all.map(r => (r as any).reporter_name).filter(Boolean)).size

  all.forEach(r => {
    const d = (r as any).date_of_activity as string
    if (d && d in dayMap) dayMap[d]++
  })

  const byCategory = groupCount(all.map(r => (r as any).activity_category as string)).slice(0, 7)
  const byProject  = groupCount(all.map(r => (r as any).project_name      as string)).slice(0, 8)
  const byWeather  = groupCount(all.map(r => (r as any).weather            as string)).slice(0, 6)
  const byStatus   = groupCount(all.map(r => (r as any).activity_status    as string))
  const byDay      = Object.entries(dayMap).map(([date, count]) => ({ date, count }))

  const completedCount = byStatus.find(s => s.name === 'Completed' || s.name === 'Complete')?.count ?? 0
  const completionRate = totalReports ? Math.round((completedCount / totalReports) * 100) : 0

  const inFilter = (row: unknown) => !hasFilters ? true : filteredIds.has((row as any).report_id as number)

  const filteredMachines    = machines.filter(inFilter)
  const filteredEmployees   = employees.filter(inFilter)
  const filteredEngineers   = engineers.filter(inFilter)
  const filteredSupervisors = supervisors.filter(inFilter)

  // Project/category/weather/etc. filters are deliberately a co-occurrence
  // view: filter the report set, then show whatever else appears within it.
  // Machine/employee/engineer/supervisor are the exception, per explicit
  // user request — selecting a specific one (e.g. clicking "GPS", or an
  // employee's name) should narrow that dimension's own panels/KPIs down to
  // its own rows, not every machine/person who happened to co-occur in the
  // same now-report-level-filtered reports (which was confusing: "Distinct
  // Machines" showing 24 after selecting just GPS, "Distinct Employees"
  // showing 38 after selecting one employee, etc.).
  const machineRows = filterMachine
    ? filteredMachines.filter(m => toTitleCase((m as any).machine_name as string).toLowerCase() === filterMachine.toLowerCase())
    : filteredMachines
  const employeeRows = filterEmployee
    ? filteredEmployees.filter(e => toTitleCase((e as any).employee_name as string).toLowerCase() === filterEmployee.toLowerCase())
    : filteredEmployees
  const engineerRows = filterEngineer
    ? filteredEngineers.filter(e => toTitleCase((e as any).engineer_name as string).toLowerCase() === filterEngineer.toLowerCase())
    : filteredEngineers
  const supervisorRows = filterSupervisor
    ? filteredSupervisors.filter(s => toTitleCase((s as any).supervisor_name as string).toLowerCase() === filterSupervisor.toLowerCase())
    : filteredSupervisors

  const byMachine    = groupCount(machineRows.map(m => (m as any).machine_name    as string)).slice(0, 15)
  const byEmployee   = groupCount(employeeRows.map(e => (e as any).employee_name   as string)).slice(0, 15)
  const byEngineer   = groupCount(engineerRows.map(e => (e as any).engineer_name   as string)).slice(0, 15)
  const bySupervisor = groupCount(supervisorRows.map(s => (s as any).supervisor_name as string)).slice(0, 15)
  const byOwnership  = groupCount(machineRows.map(m => (m as any).ownership         as string))
  const byDriver      = groupCount(machineRows.map(m => (m as any).driver_name  as string)).slice(0, 15)
  const byEmployeeRole    = groupCount(employeeRows.map(e => (e as any).employee_role as string))
  const byEngineerParty   = groupCount(engineerRows.map(e => (e as any).party as string))
  const bySupervisorParty = groupCount(supervisorRows.map(s => (s as any).party as string))

  const distinctCount = (rows: Record<string, unknown>[], field: string) =>
    new Set(rows.map(r => toTitleCase(r[field] as string)).filter(Boolean)).size

  const machineSummary = {
    totalMentions:    machineRows.length,
    distinctMachines: distinctCount(machineRows, 'machine_name'),
    distinctDrivers:  distinctCount(machineRows, 'driver_name'),
  }
  const employeeSummary = {
    totalMentions:     employeeRows.length,
    distinctEmployees: distinctCount(employeeRows, 'employee_name'),
  }
  const engineerSummary = {
    totalMentions:     engineerRows.length,
    distinctEngineers: distinctCount(engineerRows, 'engineer_name'),
  }
  const supervisorSummary = {
    totalMentions:       supervisorRows.length,
    distinctSupervisors: distinctCount(supervisorRows, 'supervisor_name'),
  }

  const mapPoints = all
    .filter(r => (r as any).start_chainage_lat && (r as any).start_chainage_long)
    .map(r => ({
      lat:      parseFloat((r as any).start_chainage_lat),
      lng:      parseFloat((r as any).start_chainage_long),
      lat2:     (r as any).end_chainage_lat  ? parseFloat((r as any).end_chainage_lat)  : null,
      lng2:     (r as any).end_chainage_long ? parseFloat((r as any).end_chainage_long) : null,
      project:  toTitleCase((r as any).project_name),
      category: toTitleCase((r as any).activity_category),
      status:   (r as any).activity_status || '',
    }))
    .filter(p => !isNaN(p.lat) && !isNaN(p.lng) && p.lat !== 0 && p.lng !== 0)

  const calMap: Record<string, { count: number; projs: Set<string> }> = {}
  all.forEach(r => {
    const d = (r as any).date_of_activity as string
    if (!d) return
    if (!calMap[d]) calMap[d] = { count: 0, projs: new Set() }
    calMap[d].count++
    if ((r as any).project_name) calMap[d].projs.add(toTitleCase((r as any).project_name as string))
  })
  const activityCalendar = Object.entries(calMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, { count, projs }]) => ({ date, count, projects: [...projs] }))

  const allRows    = filterOptions ?? []
  const categories = [...new Set(allRows.map(r => toTitleCase((r as any).activity_category)).filter(Boolean))].sort()
  const projects   = [...new Set(allRows.map(r => toTitleCase((r as any).project_name)).filter(Boolean))].sort()
  const sections   = [...new Set(allRows.map(r => toTitleCase((r as any).section_name)).filter(Boolean))].sort()

  const reportProjectMap: Record<number, string> = {}
  for (const r of all) {
    const id   = (r as any).id as number
    const proj = toTitleCase((r as any).project_name as string)
    if (id && proj) reportProjectMap[id] = proj
  }

  const mediaItems = (media.data ?? [])
    .filter(p => p.file)
    .map(p => ({
      file:         p.file as string,
      media_type:   (p.media_type || 'image') as string,
      project_name: reportProjectMap[(p as any).report_id as number] || '',
    }))
    .filter(p => !hasFilters || p.project_name !== '')

  return NextResponse.json({
    summary: {
      totalReports,
      reportsThisMonth,
      activeProjects,
      totalPhotos: hasFilters
        ? mediaItems.filter(p => p.media_type !== 'video').length
        : (totalMediaResult.count ?? 0),
      uniqueReporters,
      completionRate,
    },
    byCategory, byProject, byDay, byWeather, byStatus,
    byMachine, byEmployee, byEngineer, bySupervisor, byOwnership,
    byDriver, byEmployeeRole, byEngineerParty, bySupervisorParty,
    machineSummary, employeeSummary, engineerSummary, supervisorSummary,
    mediaItems, mapPoints, activityCalendar,
    recentReports: recent,
    filterOptions: { categories, projects, sections },
    activeFilters: {
      filterCategory, filterProject, filterSection, filterDateFrom, filterDateTo, filterChFrom, filterChTo, filterSearch,
      filterWeather, filterMachine, filterEmployee, filterEngineer, filterSupervisor,
      filterOwnership, filterDriver, filterEmployeeRole, filterEngineerParty, filterSupervisorParty,
    },
  })
}