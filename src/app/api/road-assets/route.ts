import { NextRequest, NextResponse } from 'next/server'
import { getIronSession } from 'iron-session'
import { createClient } from '@supabase/supabase-js'
import { sessionOptions, AppSession } from '@/lib/session'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// road_assets is 7.27M rows, national coverage (Coastal Road/Calabar/Ogun in
// the south, a separate Kebbi-Sokoto project in the north) — same tiering as
// streetlights' gridDegForZoom(), same 0.02 base resolution the materialized
// view is built at.
function gridDegForZoom(zoom: number | null): number {
  if (zoom == null) return 0.1
  if (zoom <= 6)  return 0.5
  if (zoom <= 9)  return 0.1
  if (zoom <= 11) return 0.02
  if (zoom <= 13) return 0.006
  if (zoom <= 15) return 0.0015
  if (zoom <= 17) return 0.0004
  return 0.0001
}

export async function GET(req: NextRequest) {
  const t0 = Date.now()
  const res = NextResponse.json({})
  const session = await getIronSession<AppSession>(req, res, sessionOptions)
  if (!session.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const zoomParam = searchParams.get('zoom')
  const zoom = zoomParam !== null && !isNaN(Number(zoomParam)) ? Number(zoomParam) : null
  const project = searchParams.get('project') || null
  const section = searchParams.get('section') || null

  const bboxKeys = ['swLat', 'swLng', 'neLat', 'neLng'] as const
  const bboxVals = Object.fromEntries(bboxKeys.map(k => [k, searchParams.get(k)]))
  const hasBbox = bboxKeys.every(k => bboxVals[k] !== null && !isNaN(Number(bboxVals[k])))
  const bbox = hasBbox ? {
    minLat: Number(bboxVals.swLat), maxLat: Number(bboxVals.neLat),
    minLng: Number(bboxVals.swLng), maxLng: Number(bboxVals.neLng),
  } : null

  // Unlike streetlights, a project/section filter alone does NOT justify the
  // live path here — 'Kebbi - Sokoto project' alone is 5.5M rows. The live
  // RPC is only ever safe (and only ever called) once a real bbox is known.
  // See scripts/sql/add_road_assets_infra.sql for the full reasoning.
  const useLivePath = zoom !== null && zoom >= 12 && hasBbox
  const gridDeg = gridDegForZoom(zoom)

  const clusterPromise = useLivePath
    ? supabase.rpc('road_assets_cluster', {
        p_min_lat: bbox!.minLat, p_max_lat: bbox!.maxLat,
        p_min_lng: bbox!.minLng, p_max_lng: bbox!.maxLng,
        p_project: project, p_section: section,
        p_grid_deg: gridDeg, p_max_points: 900,
      })
    : supabase.rpc('road_assets_clusters', {
        min_lon: bbox?.minLng ?? -180, min_lat: bbox?.minLat ?? -90,
        max_lon: bbox?.maxLng ?? 180,  max_lat: bbox?.maxLat ?? 90,
        grid_size: zoom !== null && zoom > 6 ? 0.02 : 0.5,
        p_project: project, p_section: section,
      })

  const [clusterRes, summaryRes, projectsRes, sectionsRes, entityTypesRes] = await Promise.all([
    clusterPromise,
    supabase.from('road_assets_summary_cache').select('*').eq('id', 1).maybeSingle(),
    supabase.from('road_assets_project_stats').select('project, point_count').order('point_count', { ascending: false }),
    supabase.from('road_assets_section_stats').select('project, section, point_count').order('point_count', { ascending: false }),
    supabase.from('road_assets_entity_type_stats').select('entity_type, point_count').order('point_count', { ascending: false }),
  ])

  // Every result MUST be checked for .error — an unchecked .error is exactly
  // what shipped the silent-all-zeros bug in /api/progress before (a
  // canceled/failed query returns error + null data, not empty data).
  const named = [
    ['cluster', clusterRes], ['summary', summaryRes],
    ['projects', projectsRes], ['sections', sectionsRes], ['entityTypes', entityTypesRes],
  ] as const
  for (const [name, r] of named) {
    if (r.error) {
      console.error(`road-assets ${name} query failed:`, r.error)
      return NextResponse.json({ error: `${name} query failed: ${r.error.message}` }, { status: 500 })
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type Row = Record<string, any>

  // Normalize both RPC shapes (MV path has no representative row; live path
  // does) into one uniform shape the frontend never has to branch on.
  const clusters = useLivePath
    ? ((clusterRes.data ?? []) as Row[]).map(r => ({
        lat: r.cluster_lat, lng: r.cluster_lon, count: Number(r.point_count),
        id: r.rep_id, entityType: r.rep_entity_type, project: r.rep_project,
        section: r.rep_section, side: r.rep_side, station: r.rep_station,
      }))
    : ((clusterRes.data ?? []) as Row[]).map(r => ({
        lat: r.cluster_lat, lng: r.cluster_lon, count: Number(r.point_count),
      }))

  return NextResponse.json({
    clusters,
    clusterMode: useLivePath ? 'live' : 'mv',
    summary: summaryRes.data,
    projects: projectsRes.data ?? [],
    sections: sectionsRes.data ?? [],
    entityTypes: entityTypesRes.data ?? [],
    queryMs: Date.now() - t0,
  })
}
