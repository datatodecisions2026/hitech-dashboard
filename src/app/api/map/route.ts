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

  const zoomParam = searchParams.get('zoom')
  const zoom      = zoomParam !== null && !isNaN(Number(zoomParam)) ? Number(zoomParam) : null
  const interval  = intervalForZoom(zoom)

  // Bbox (current map viewport) is only applied once zoomed in enough for it
  // to matter — at low zoom the viewport already ~= the whole road, so
  // skipping it there avoids relying on exact bound math for no real gain.
  const bboxKeys = ['swLat', 'swLng', 'neLat', 'neLng'] as const
  const bboxVals = Object.fromEntries(bboxKeys.map(k => [k, searchParams.get(k)]))
  const hasBbox  = zoom !== null && zoom >= 12 && bboxKeys.every(k => bboxVals[k] !== null && !isNaN(Number(bboxVals[k])))

  const [lineRes, reportsRes] = await Promise.all([
    supabase.rpc('map_chainage_line', {
      p_project_id: projectId,
      p_interval:   interval,
      p_min_lat: hasBbox ? Number(bboxVals.swLat) : null,
      p_max_lat: hasBbox ? Number(bboxVals.neLat) : null,
      p_min_lng: hasBbox ? Number(bboxVals.swLng) : null,
      p_max_lng: hasBbox ? Number(bboxVals.neLng) : null,
    }),

    // Report volume (currently ~9.7k total across all projects) is nowhere
    // near what chainage stations were — this bounded query is fine as-is.
    supabase
      .from('hitech_report_hitechreport')
      .select(
        'id, start_chainage, end_chainage, start_chainage_val, end_chainage_val, ' +
        'activity_category, activity_type, activity_status, ' +
        'reporter_name, date_of_activity, project_name, section_name, ' +
        'start_chainage_lat, start_chainage_long, end_chainage_lat, end_chainage_long'
      )
      .ilike('project_name', `%${project.split(' ')[0]}%`)
      .limit(5000),
  ])

  return NextResponse.json({
    stations:  (lineRes.data ?? []).map((s: any) => ({ ...s, label: Number(s.label), project_id: projectId })),
    reports:   reportsRes.data ?? [],
    projectId,
    project,
  })
}
