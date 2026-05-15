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

export async function GET(req: NextRequest) {
  const res = NextResponse.json({})
  const session = await getIronSession<AppSession>(req, res, sessionOptions)
  if (!session.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

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

  const [
    { data: lite },
    { data: recent },
    { data: media },
    { count: totalMedia },
  ] = await Promise.all([
    supabase
      .from('hitech_report_hitechreport')
      .select('id, activity_category, project_name, date_of_activity, weather, activity_status, reporter_name, start_chainage_lat, start_chainage_long, end_chainage_lat, end_chainage_long'),
    supabase
      .from('hitech_report_hitechreport')
      .select('id, date_of_activity, reporter_name, project_name, section_name, activity_category, activity_type, activity_status, comment_activity')
      .order('date_of_activity', { ascending: false })
      .order('id', { ascending: false })
      .limit(12),
    supabase
      .from('hitech_report_hitechphoto')
      .select('file, media_type')
      .order('id', { ascending: false })
      .limit(200),
    supabase
      .from('hitech_report_hitechphoto')
      .select('id', { count: 'exact', head: true })
      .eq('media_type', 'image'),
  ])

  const all = lite ?? []

  const totalReports     = all.length
  const reportsThisMonth = all.filter(r => r.date_of_activity >= thisMonthStart).length
  const activeProjects   = new Set(
    all.filter(r => r.date_of_activity >= cutoff).map(r => r.project_name).filter(Boolean)
  ).size
  const uniqueReporters  = new Set(all.map(r => r.reporter_name).filter(Boolean)).size

  all.forEach(r => {
    const d = r.date_of_activity
    if (d && d in dayMap) dayMap[d]++
  })

  const byCategory = groupCount(all.map(r => r.activity_category)).slice(0, 7)
  const byProject  = groupCount(all.map(r => r.project_name)).slice(0, 8)
  const byWeather  = groupCount(all.map(r => r.weather)).slice(0, 6)
  const byDay      = Object.entries(dayMap).map(([date, count]) => ({ date, count }))

  const mediaItems = (media ?? [])
    .filter(p => p.file)
    .map(p => ({ file: p.file as string, media_type: (p.media_type || 'image') as string }))

  const mapPoints = all
    .filter(r => r.start_chainage_lat && r.start_chainage_long)
    .map(r => ({
      lat:      parseFloat(r.start_chainage_lat),
      lng:      parseFloat(r.start_chainage_long),
      lat2:     r.end_chainage_lat  ? parseFloat(r.end_chainage_lat)  : null as number | null,
      lng2:     r.end_chainage_long ? parseFloat(r.end_chainage_long) : null as number | null,
      project:  toTitleCase(r.project_name),
      category: toTitleCase(r.activity_category),
      status:   r.activity_status || '',
    }))
    .filter(p => !isNaN(p.lat) && !isNaN(p.lng) && p.lat !== 0 && p.lng !== 0)

  const calMap: Record<string, { count: number; projs: Set<string> }> = {}
  all.forEach(r => {
    const d = r.date_of_activity
    if (!d) return
    if (!calMap[d]) calMap[d] = { count: 0, projs: new Set() }
    calMap[d].count++
    if (r.project_name) calMap[d].projs.add(toTitleCase(r.project_name))
  })
  const activityCalendar = Object.entries(calMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, { count, projs }]) => ({ date, count, projects: [...projs] }))

  return NextResponse.json({
    summary: { totalReports, reportsThisMonth, activeProjects, totalPhotos: totalMedia ?? 0, uniqueReporters },
    byCategory, byProject, byDay, byWeather,
    mediaItems, mapPoints, activityCalendar,
    recentReports: recent ?? [],
  })
}
