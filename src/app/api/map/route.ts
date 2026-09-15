import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// PostgREST hard-caps any single response at 1000 rows, project-wide — a
// requested .limit(5000)/.limit(1000) is silently capped, not honoured (see
// the 2026-07-22 "map freezing" changelog). Confirmed live 2026-09-15: a
// Coastal "Earthworks" filter has 1,788 real matching reports; the old
// single-query fetch only ever returned the first 1,000, so the map's fit
// bounds / pin count / clustering (see the 2026-09-15 UnifiedMap entry) were
// silently working off a truncated 56% of the real matches whenever a
// category matched more than 1000 rows. Same page-until-exhausted pattern as
// src/app/api/progress/route.ts's fetchAll(). hitech_report_hitechreport is
// ~9.7k rows total — comfortably fine to page through in full (this project's
// own precedent: never fetchAll() road_assets/streetlights-scale tables,
// but this table is two-plus orders of magnitude smaller than those).
// MAX_PAGES is a defensive ceiling, not an expected limit, in case the table
// grows unexpectedly — 30 pages = 30,000 rows, ~3x today's real total.
async function fetchAll<T = Record<string, unknown>>(query: any): Promise<T[]> {
  const all: T[] = []
  const PAGE = 1000
  const MAX_PAGES = 30
  let from = 0
  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, error } = await query.range(from, from + PAGE - 1)
    if (error || !data || data.length === 0) break
    all.push(...data)
    if (data.length < PAGE) break
    from += PAGE
  }
  return all
}

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
  // Paged in full via fetchAll() below — the whole table is ~9.7k rows, well
  // within what's fine to page through (see fetchAll's own comment). Stations
  // still come from the `project` param, so all=1&project=Coastal Road gives
  // every report + the Coastal road line in one response.
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

  // all=1 still splits into a Coastal query + a targeted grab of the other
  // ~35 geolocated Calabar/Kebbi/Ogun rows (by section/project keyword),
  // rather than one flat query — both now go through fetchAll() so the
  // 1000-row cap itself is no longer the reason for the split, but keeping
  // it targeted still means the ~35-row "other" set never needs to page.
  // Note: PostgREST's embedded or() filter syntax uses `*` as the LIKE
  // wildcard, NOT `%` (unlike the standalone .ilike() builder).
  const OTHER_REGION_OR =
    'section_name.ilike.*calabar*,section_name.ilike.*ogun*,section_name.ilike.*kebbi*,' +
    'project_name.ilike.*sokoto*,project_name.ilike.*kebbi*'

  async function fetchReports(): Promise<any[]> {
    if (!allReports) {
      let q = supabase.from('hitech_report_hitechreport').select(REPORT_COLS)
        .ilike('project_name', `%${project.split(' ')[0]}%`)
      if (category) q = q.ilike('activity_category', category)
      return fetchAll(q)
    }
    let coastal = supabase.from('hitech_report_hitechreport').select(REPORT_COLS).ilike('project_name', '%Coastal%')
    let other   = supabase.from('hitech_report_hitechreport').select(REPORT_COLS).or(OTHER_REGION_OR)
    if (category) { coastal = coastal.ilike('activity_category', category); other = other.ilike('activity_category', category) }
    const [c, o] = await Promise.all([fetchAll(coastal), fetchAll(other)])
    const byId = new Map<number, any>()
    for (const r of [...c, ...o] as any[]) byId.set(r.id, r)
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
