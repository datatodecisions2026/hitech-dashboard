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
//
// 2026-09-19: user reported "the map has gotten slower" — measured live
// (direct curl, 3 runs) and confirmed real: the unfiltered Coastal fetch
// (~9,746 rows / ~10 pages) took 5.3–13.6s, well over the ~3.8s this same
// page-until-exhausted design measured back in the 2026-09-15 (2) changelog
// entry, and this function's call sites' unfiltered-path query shape is
// unchanged this session — so this isn't a regression from this session's
// other edits, it's a real change in the environment (Supabase per-request
// latency running higher than it did in September; a control confirmed
// this wasn't specific to this endpoint — /api/dashboard's single RPC call,
// unrelated code, was also measured slower than its own documented figure).
//
// First attempt fetched pages in batches of 4 concurrently instead of one
// at a time, reasoning by analogy from the 2026-08-01 road-assets-coverage
// entry ("batching at 4-at-a-time... measured 0 failures") — this measured
// great in ISOLATION (2.6–3.7s, down from 5–13s) but that was the wrong
// test. UnifiedMap fires this alongside 5 other map-related requests
// (Kebbi corridor line, 3× road-assets, road-design) in the same tick on
// every page load — under that REAL concurrent load, BATCH=4 measured
// *13.96s*, worse than not batching at all (BATCH=1 measured 5.06s in the
// same concurrent test), because the extra internal concurrency piled onto
// contention that was already there against this project's well-documented
// small-resource-budget Supabase tier. BATCH=2 was then measured under the
// same realistic concurrent load, 3 separate times, landing at 1.6–2.4s
// each time and improving every additional page's cost without repeating
// BATCH=4's overload — kept as the setting, with this full trail recorded
// specifically so a future change doesn't re-reach for BATCH=4 by the same
// (reasonable-looking, but empirically wrong here) analogy.
//
// Takes a query FACTORY (not a single builder instance) because Supabase's
// query builder is mutable — calling .range() again on the same object
// before the previous call's request has actually gone out would silently
// clobber the range for both, since .range() only sets internal state and
// the real request fires on await/then; each concurrent page needs its own
// freshly-built query object.
async function fetchAll<T = Record<string, unknown>>(buildQuery: () => any): Promise<T[]> {
  const all: T[] = []
  const PAGE = 1000
  const MAX_PAGES = 30
  const BATCH = 2
  let page = 0
  batches:
  while (page < MAX_PAGES) {
    const pagesThisBatch: number[] = []
    for (let i = 0; i < BATCH && page < MAX_PAGES; i++, page++) pagesThisBatch.push(page)
    const results = await Promise.all(
      pagesThisBatch.map(p => buildQuery().range(p * PAGE, p * PAGE + PAGE - 1))
    )
    for (const { data, error } of results) {
      if (error || !data) break batches
      all.push(...data)
      if (data.length < PAGE) break batches
    }
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
  // Same convention as category — case-insensitive column match, filters the
  // reports array only (not stations). Added so UnifiedMap can zoom/decluster
  // for a Weather-chart click the same way it already does for category —
  // previously weather never reached this route at all, see the
  // "map still shows clusters after clicking a filter" changelog entry.
  const weather   = searchParams.get('weather') || ''
  // Same convention as category/weather — never actually wired in before
  // (2026-09-22 (5) changelog): filtering /dashboard's Section dropdown
  // never narrowed the map's reports at all, so e.g. "Section 1-A" still
  // fetched every Coastal report and rendered a single, misleadingly huge
  // grid-bucket marker instead of that section's real, much smaller set.
  const section   = searchParams.get('section') || ''
  // Same convention as category/weather/section — never wired in before.
  // Applied to the reports query only (not stations, same as every other
  // filter dimension here) via .gte()/.lte() on date_of_activity.
  const dateFrom  = searchParams.get('date_from') || ''
  const dateTo    = searchParams.get('date_to') || ''
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
      const build = () => {
        let q = supabase.from('hitech_report_hitechreport').select(REPORT_COLS)
          .ilike('project_name', `%${project.split(' ')[0]}%`)
        if (category) q = q.ilike('activity_category', category)
        if (weather) q = q.ilike('weather', weather)
        if (section) q = q.ilike('section_name', section)
        if (dateFrom) q = q.gte('date_of_activity', dateFrom)
        if (dateTo) q = q.lte('date_of_activity', dateTo)
        return q
      }
      return fetchAll(build)
    }
    const buildCoastal = () => {
      let q = supabase.from('hitech_report_hitechreport').select(REPORT_COLS).ilike('project_name', '%Coastal%')
      if (category) q = q.ilike('activity_category', category)
      if (weather) q = q.ilike('weather', weather)
      if (section) q = q.ilike('section_name', section)
      if (dateFrom) q = q.gte('date_of_activity', dateFrom)
      if (dateTo) q = q.lte('date_of_activity', dateTo)
      return q
    }
    const buildOther = () => {
      let q = supabase.from('hitech_report_hitechreport').select(REPORT_COLS).or(OTHER_REGION_OR)
      if (category) q = q.ilike('activity_category', category)
      if (weather) q = q.ilike('weather', weather)
      if (section) q = q.ilike('section_name', section)
      if (dateFrom) q = q.gte('date_of_activity', dateFrom)
      if (dateTo) q = q.lte('date_of_activity', dateTo)
      return q
    }
    const [c, o] = await Promise.all([fetchAll(buildCoastal), fetchAll(buildOther)])
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
    weather,
    section,
    dateFrom,
    dateTo,
  })
}
