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

/** Fetch ALL rows from a table by paginating 1 000 rows at a time. */
async function fetchAll<T = Record<string, unknown>>(
  query: ReturnType<typeof supabase.from>
): Promise<T[]> {
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

  // ── Read filter params ────────────────────────────────────────────────────
  const { searchParams } = new URL(req.url)
  const filterCategory  = searchParams.get('category')  || ''
  const filterProject   = searchParams.get('project')   || ''
  const filterDateFrom  = searchParams.get('date_from') || ''
  const filterDateTo    = searchParams.get('date_to')   || ''

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

  // ── Build base query with filters ─────────────────────────────────────────
  function buildLiteQuery() {
    let q = supabase
      .from('hitech_report_hitechreport')
      .select(
        'id, activity_category, project_name, date_of_activity, weather, ' +
        'activity_status, reporter_name, start_chainage_lat, start_chainage_long, ' +
        'end_chainage_lat, end_chainage_long'
      )
    if (filterCategory) q = (q as any).eq('activity_category', filterCategory)
    if (filterProject)  q = (q as any).eq('project_name',      filterProject)
    if (filterDateFrom) q = (q as any).gte('date_of_activity', filterDateFrom)
    if (filterDateTo)   q = (q as any).lte('date_of_activity', filterDateTo)
    return q
  }

  // ── Fetch everything in parallel ──────────────────────────────────────────
  const [all, recent, media, totalMediaResult, machines, employees, engineers, supervisors, filterOptions] =
    await Promise.all([
      // All report rows (paginated, filtered)
      fetchAll(buildLiteQuery()),

      // Recent 12 reports
      supabase
        .from('hitech_report_hitechreport')
        .select('id, date_of_activity, reporter_name, project_name, section_name, activity_category, activity_type, activity_status, comment_activity')
        .order('date_of_activity', { ascending: false })
        .order('id', { ascending: false })
        .limit(12),

      // Media
      supabase
        .from('hitech_report_hitechphoto')
        .select('file, media_type')
        .order('id', { ascending: false })
        .limit(200),

      // Total photo count
      supabase
        .from('hitech_report_hitechphoto')
        .select('id', { count: 'exact', head: true })
        .eq('media_type', 'image'),

      // Machines
      supabase
        .from('hitech_report_hitechmachine')
        .select('machine_name, ownership, driver_name, fleet_number, report_id'),

      // Employees
      supabase
        .from('hitech_report_hitechemployee')
        .select('employee_name, employee_role, report_id'),

      // Engineers
      supabase
        .from('hitech_report_hitechengineer')
        .select('engineer_name, party, report_id'),

      // Supervisors
      supabase
        .from('hitech_report_hitechsupervisor')
        .select('supervisor_name, party, report_id'),

      // Filter dropdown options (unfiltered — always show all options)
      supabase
        .from('hitech_report_hitechreport')
        .select('activity_category, project_name'),
    ])

  // ── Aggregate report data ─────────────────────────────────────────────────
  const totalReports     = all.length
  const reportsThisMonth = all.filter(r => (r as any).date_of_activity >= thisMonthStart).length
  const activeProjects   = new Set(
    all
      .filter(r => (r as any).date_of_activity >= cutoff)
      .map(r => (r as any).project_name)
      .filter(Boolean)
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

  // ── HR / Machine charts ───────────────────────────────────────────────────
  const byMachine    = groupCount((machines.data    ?? []).map(m => (m as any).machine_name   as string)).slice(0, 15)
  const byEmployee   = groupCount((employees.data   ?? []).map(e => (e as any).employee_name  as string)).slice(0, 15)
  const byEngineer   = groupCount((engineers.data   ?? []).map(e => (e as any).engineer_name  as string)).slice(0, 15)
  const bySupervisor = groupCount((supervisors.data ?? []).map(s => (s as any).supervisor_name as string)).slice(0, 15)
  const byOwnership  = groupCount((machines.data    ?? []).map(m => (m as any).ownership      as string))

  // ── Map points ────────────────────────────────────────────────────────────
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

  // ── Activity calendar ─────────────────────────────────────────────────────
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

  // ── Filter dropdown options ───────────────────────────────────────────────
  const allRows       = filterOptions.data ?? []
  const categories    = [...new Set(allRows.map(r => toTitleCase((r as any).activity_category)).filter(Boolean))].sort()
  const projects      = [...new Set(allRows.map(r => toTitleCase((r as any).project_name)).filter(Boolean))].sort()

  // ── Media ─────────────────────────────────────────────────────────────────
  const mediaItems = (media.data ?? [])
    .filter(p => p.file)
    .map(p => ({ file: p.file as string, media_type: (p.media_type || 'image') as string }))

  return NextResponse.json({
    summary: {
      totalReports,
      reportsThisMonth,
      activeProjects,
      totalPhotos: totalMediaResult.count ?? 0,
      uniqueReporters,
    },
    byCategory,
    byProject,
    byDay,
    byWeather,
    byMachine,
    byEmployee,
    byEngineer,
    bySupervisor,
    byOwnership,
    mediaItems,
    mapPoints,
    activityCalendar,
    recentReports: recent.data ?? [],
    filterOptions: { categories, projects },
    activeFilters: { filterCategory, filterProject, filterDateFrom, filterDateTo },
  })
}