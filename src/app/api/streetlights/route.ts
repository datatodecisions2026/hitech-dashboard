import { NextRequest, NextResponse } from 'next/server'
import { getIronSession } from 'iron-session'
import { createClient } from '@supabase/supabase-js'
import { sessionOptions, AppSession } from '@/lib/session'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// streetlights is 3M rows. Mirrors /api/map's intervalForZoom() tiering, in
// 2D grid-degrees instead of a 1D metre interval. 0.02 matches the existing
// streetlights_grid_mv's baked-in resolution so the MV/live handoff around
// zoom 11->12 is smooth.
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
  const section = searchParams.get('section') || null

  const bboxKeys = ['swLat', 'swLng', 'neLat', 'neLng'] as const
  const bboxVals = Object.fromEntries(bboxKeys.map(k => [k, searchParams.get(k)]))
  const hasBbox = bboxKeys.every(k => bboxVals[k] !== null && !isNaN(Number(bboxVals[k])))
  const bbox = hasBbox ? {
    minLat: Number(bboxVals.swLat), maxLat: Number(bboxVals.neLat),
    minLng: Number(bboxVals.swLng), maxLng: Number(bboxVals.neLng),
  } : null

  // MV path for zoomed-out / no-bbox (the only case that would otherwise
  // touch all 3M rows live). Any bbox at zoom>=12, or any section filter,
  // goes through the live, index-assisted RPC.
  const useLivePath = !!section || (zoom !== null && zoom >= 12 && hasBbox)
  const gridDeg = gridDegForZoom(zoom)

  const clusterPromise = useLivePath
    ? supabase.rpc('streetlights_cluster', {
        p_min_lat: bbox?.minLat ?? null, p_max_lat: bbox?.maxLat ?? null,
        p_min_lng: bbox?.minLng ?? null, p_max_lng: bbox?.maxLng ?? null,
        p_section: section, p_grid_deg: gridDeg, p_max_points: 900,
      })
    : supabase.rpc('streetlights_clusters', {
        min_lon: bbox?.minLng ?? -180, min_lat: bbox?.minLat ?? -90,
        max_lon: bbox?.maxLng ?? 180,  max_lat: bbox?.maxLat ?? 90,
        // The MV alone is 1,743 rows > the 900-point cap, so even the true
        // whole-world/no-bbox first paint needs one more coarsening pass.
        grid_size: zoom !== null && zoom > 6 ? 0.02 : 0.5,
      })

  const [clusterRes, summaryRes, sectionsRes, variantsRes] = await Promise.all([
    clusterPromise,
    supabase.from('streetlights_summary_cache').select('*').eq('id', 1).maybeSingle(),
    supabase.from('streetlights_section_stats').select('section, point_count').order('point_count', { ascending: false }),
    supabase.from('streetlight_image_variants').select('variant, label, image_url').order('variant'),
  ])

  // Every result MUST be checked for .error — an unchecked .error is
  // exactly what shipped the silent-all-zeros bug in /api/progress before
  // (a canceled/failed query returns error + null data, not empty data).
  const named = [
    ['cluster', clusterRes], ['summary', summaryRes],
    ['sections', sectionsRes], ['variants', variantsRes],
  ] as const
  for (const [name, r] of named) {
    if (r.error) {
      console.error(`streetlights ${name} query failed:`, r.error)
      return NextResponse.json({ error: `${name} query failed: ${r.error.message}` }, { status: 500 })
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type Row = Record<string, any>

  // Normalize both RPC shapes (MV path has no representative row; live path
  // does) into one uniform shape the frontend never has to branch on.
  const clusters = useLivePath
    ? ((clusterRes.data ?? []) as Row[]).map(r => ({
        lat: r.cell_lat, lng: r.cell_lng, count: Number(r.point_count),
        objectid: r.rep_objectid, side: r.rep_side, section: r.rep_section,
        station: r.rep_station, imageVariant: r.rep_image_variant,
        isSynthetic: r.rep_is_synthetic, imageUrl: r.image_url, imageLabel: r.image_label,
      }))
    : ((clusterRes.data ?? []) as Row[]).map(r => ({
        lat: r.cluster_lat, lng: r.cluster_lon, count: Number(r.point_count),
      }))

  return NextResponse.json({
    clusters,
    clusterMode: useLivePath ? 'live' : 'mv',
    summary: summaryRes.data,
    sections: sectionsRes.data ?? [],
    imageVariants: variantsRes.data ?? [],
    queryMs: Date.now() - t0,
  })
}
