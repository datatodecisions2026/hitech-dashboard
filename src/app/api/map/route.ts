import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// hitech_report_chainage is one row per metre of road (423,696 rows for the
// largest project alone) — never fetchAll() it. map_chainage_line() samples
// at a metre interval chosen from the requested zoom level, so the whole
// road stays cheap at low zoom and only gets denser as the caller zooms in.
// Every tier is a divisor of 1000, so 1km tick marks (label % 1000 === 0,
// filtered client-side same as before) are always a clean subset of the
// sampled points — no separate query needed for them.
function intervalForZoom(zoom: number | null): number {
  if (zoom == null) return 250
  if (zoom <= 9)  return 1000
  if (zoom <= 12) return 250
  if (zoom <= 14) return 100
  return 25
}

// Map project name → project_id in surveycollection_project
const PROJECT_ID_MAP: Record<string, number> = {
  'Coastal Road':               1,
  'Coastal road':               1,
  'coastal road':               1,
  'Refinery Road':              5,
  'Refinery road':              5,
  'SBS Sokoto Badagry highway': 7,
  'Benin road':                 3,
  'Benin Road':                 3,
  'Abuja road':                 4,
  'Abuja Road':                 4,
}

export async function GET(req: NextRequest) {

  const { searchParams } = new URL(req.url)
  const project   = searchParams.get('project') || 'Coastal Road'
  const projectId = PROJECT_ID_MAP[project] ?? 1
  const category  = searchParams.get('category') || ''
  // all=1 → return reports across every project/section, not just `project`
  // (the UnifiedMap needs Calabar/Kebbi/Ogun report pins alongside Coastal's).
  // Still one bounded query — the whole table is ~9.7k rows. Stations still
  // come from the `project` param, so all=1&project=Coastal Road gives every
  // report + the Coastal road line in a single call.
  const allReports = searchParams.get('all') === '1'

  const zoomParam = searchParams.get('zoom')
  const zoom      = zoomParam !== null && !isNaN(Number(zoomParam)) ? Number(zoomParam) : null
  const interval  = intervalForZoom(zoom)

  // Bbox (current map viewport) is only applied once zoomed in enough for it
  // to matter — at low zoom the viewport already ~= the whole road, so
  // skipping it there avoids relying on exact bound math for no real gain.
  const bboxKeys = ['swLat', 'swLng', 'neLat', 'neLng'] as const
  const bboxVals = Object.fromEntries(bboxKeys.map(k => [k, searchParams.get(k)]))
  const hasBbox  = zoom !== null && zoom >= 12 && bboxKeys.every(k => bboxVals[k] !== null && !isNaN(Number(bboxVals[k])))

  const REPORT_COLS =
    'id, start_chainage, end_chainage, start_chainage_val, end_chainage_val, ' +
    'activity_category, activity_type, activity_status, ' +
    'reporter_name, date_of_activity, project_name, section_name, ' +
    'start_chainage_lat, start_chainage_long, end_chainage_lat, end_chainage_long'

  // PostgREST hard-caps ANY single response at 1000 rows (project-wide, can't
  // be raised from the client — see the 2026-07-22 "map freezing" changelog).
  // For all=1 that means one flat query would only ever return the first 1000
  // reports, which are all Coastal Section 1 — the ~35 geolocated
  // Calabar/Kebbi/Ogun reports the UnifiedMap needs would never appear. So
  // all=1 runs the Coastal set AND a targeted grab of the other regions
  // (by section/project keyword — ~35 rows) and merges them.
  // Note: PostgREST's embedded or() filter syntax uses `*` as the LIKE
  // wildcard, NOT `%` (unlike the standalone .ilike() builder).
  const OTHER_REGION_OR =
    'section_name.ilike.*calabar*,section_name.ilike.*ogun*,section_name.ilike.*kebbi*,' +
    'project_name.ilike.*sokoto*,project_name.ilike.*kebbi*'

  async function fetchReports(): Promise<any[]> {
    if (!allReports) {
      let q = supabase.from('hitech_report_hitechreport').select(REPORT_COLS)
        .ilike('project_name', `%${project.split(' ')[0]}%`).limit(5000)
      if (category) q = q.ilike('activity_category', category)
      const { data } = await q
      return data ?? []
    }
    let coastal = supabase.from('hitech_report_hitechreport').select(REPORT_COLS).ilike('project_name', '%Coastal%').limit(1000)
    let other   = supabase.from('hitech_report_hitechreport').select(REPORT_COLS).or(OTHER_REGION_OR).limit(1000)
    if (category) { coastal = coastal.ilike('activity_category', category); other = other.ilike('activity_category', category) }
    const [c, o] = await Promise.all([coastal, other])
    const byId = new Map<number, any>()
    for (const r of [...((c.data ?? []) as any[]), ...((o.data ?? []) as any[])]) byId.set(r.id, r)
    return [...byId.values()]
  }

  const [lineRes, reports] = await Promise.all([
    supabase.rpc('map_chainage_line', {
      p_project_id: projectId,
      p_interval:   interval,
      p_min_lat: hasBbox ? Number(bboxVals.swLat) : null,
      p_max_lat: hasBbox ? Number(bboxVals.neLat) : null,
      p_min_lng: hasBbox ? Number(bboxVals.swLng) : null,
      p_max_lng: hasBbox ? Number(bboxVals.neLng) : null,
    }),
    fetchReports(),
  ])

  return NextResponse.json({
    stations:  (lineRes.data ?? []).map((s: any) => ({ ...s, label: Number(s.label), project_id: projectId })),
    reports,
    projectId,
    project,
    category,
  })
}
