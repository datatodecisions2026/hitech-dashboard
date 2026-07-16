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
    chFromNum > 0 && chToNum > 0 &&
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

  const [allRaw, media, totalMediaResult, machines, employees, engineers, supervisors, filterOptions] =
    await Promise.all([
      fetchAll(buildLiteQuery()),

      supabase
        .from('hitech_report_hitechphoto')
        .select('file, media_type, report_id')
        .order('id', { ascending: false })
        .limit(600),

      supabase
        .from('hitech_report_hitechphoto')
        .select('id', { count: 'exact', head: true })
        .eq('media_type', 'image'),

      supabase
        .from('hitech_report_hitechmachine')
        .select('machine_name, ownership, driver_name, fleet_number, report_id'),

      supabase
        .from('hitech_report_hitechemployee')
        .select('employee_name, employee_role, report_id'),

      supabase
        .from('hitech_report_hitechengineer')
        .select('engineer_name, party, report_id'),

      supabase
        .from('hitech_report_hitechsupervisor')
        .select('supervisor_name, party, report_id'),

      fetchAll(supabase
        .from('hitech_report_hitechreport')
        .select('activity_category, project_name')),
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
    matchReportIds(machines.data    ?? [], 'machine_name',    filterMachine),
    matchReportIds(employees.data   ?? [], 'employee_name',   filterEmployee),
    matchReportIds(engineers.data   ?? [], 'engineer_name',   filterEngineer),
    matchReportIds(supervisors.data ?? [], 'supervisor_name', filterSupervisor),
  ].filter((s): s is Set<number> => s !== null)
  const hrRestrictIds = hrIdSets.length
    ? hrIdSets.reduce((acc, s) => new Set([...acc].filter(id => s.has(id))))
    : null

  const all = hrRestrictIds ? allRaw.filter(r => hrRestrictIds.has((r as any).id as number)) : allRaw

  // Recent-reports feed: take the most-recent N ids from the FULLY filtered set
  // (all filters, including machine/employee/engineer/supervisor applied above),
  // then fetch their display fields. Doing this against `all` — rather than
  // limiting the DB query to N rows before applying the HR filter — avoids
  // returning an empty feed when the most-recent rows overall happen not to
  // match a narrow HR filter.
  const recentIds = [...all]
    .sort((a, b) => {
      const d = ((b as any).date_of_activity || '').localeCompare((a as any).date_of_activity || '')
      return d !== 0 ? d : ((b as any).id as number) - ((a as any).id as number)
    })
    .slice(0, searchOr ? 300 : 12)
    .map(r => (r as any).id as number)

  const recent = recentIds.length
    ? ((await supabase
        .from('hitech_report_hitechreport')
        .select('id, date_of_activity, reporter_name, project_name, section_name, activity_category, activity_type, activity_status, comment_activity')
        .in('id', recentIds)
        .order('date_of_activity', { ascending: false })
        .order('id', { ascending: false })
      ).data ?? [])
    : []

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
  const byDay      = Object.entries(dayMap).map(([date, count]) => ({ date, count }))

  const filteredIds = new Set(all.map(r => (r as any).id as number))
  const hasFilters  = !!(filterProject || filterCategory || filterWeather || filterDateFrom || filterDateTo || applyChFilter || searchOr || hrRestrictIds)
  const inFilter    = (row: unknown) => !hasFilters ? true : filteredIds.has((row as any).report_id as number)

  const byMachine    = groupCount((machines.data    ?? []).filter(inFilter).map(m => (m as any).machine_name    as string)).slice(0, 15)
  const byEmployee   = groupCount((employees.data   ?? []).filter(inFilter).map(e => (e as any).employee_name   as string)).slice(0, 15)
  const byEngineer   = groupCount((engineers.data   ?? []).filter(inFilter).map(e => (e as any).engineer_name   as string)).slice(0, 15)
  const bySupervisor = groupCount((supervisors.data ?? []).filter(inFilter).map(s => (s as any).supervisor_name as string)).slice(0, 15)
  const byOwnership  = groupCount((machines.data    ?? []).filter(inFilter).map(m => (m as any).ownership       as string))

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
    },
    byCategory, byProject, byDay, byWeather,
    byMachine, byEmployee, byEngineer, bySupervisor, byOwnership,
    mediaItems, mapPoints, activityCalendar,
    recentReports: recent,
    filterOptions: { categories, projects },
    activeFilters: {
      filterCategory, filterProject, filterDateFrom, filterDateTo, filterChFrom, filterChTo, filterSearch,
      filterWeather, filterMachine, filterEmployee, filterEngineer, filterSupervisor,
    },
  })
}