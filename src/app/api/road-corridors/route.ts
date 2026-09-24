import { NextRequest, NextResponse } from 'next/server'
import { getIronSession } from 'iron-session'
import { createClient } from '@supabase/supabase-js'
import { sessionOptions, AppSession } from '@/lib/session'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const REGIONS = ['calabar', 'ogun', 'kebbi'] as const
type Region = (typeof REGIONS)[number]

// road_corridor_summary() aggregates the raw ~4.87M-row road_corridors table
// (not the small road_corridors_grid cache — see the SQL file's "real
// finding" comment on road_corridor_segments for that story) — measured live
// at ~5s for a single call. /road-corridors defaults to "All Regions", which
// fires 3 concurrent per-region fetches, and this route previously called
// this RPC on every one of them: 3 concurrent ~5s full-table scans against
// this Supabase instance's constrained resources (small work_mem/shared_
// buffers, few parallel workers — the same limits documented throughout this
// project's history) blew past the 8s statement_timeout and surfaced as real
// 503s in a live Playwright pass, not a hypothetical. Fixed with an
// in-process cache of the in-flight PROMISE (not just the resolved value) —
// concurrent callers within the same beat share one real query instead of
// each independently missing an empty cache and firing their own. The data
// is a one-time static ingestion (sync_road_corridors.py runs once, not on a
// schedule), so a long TTL is safe.
// Wrapped in a real async IIFE (a genuine native Promise), not the raw
// supabase-js query builder returned by supabase.rpc(...) directly — that
// builder's `.then()` performs the actual fetch each time it's awaited, so
// sharing the bare builder object across concurrent callers would still
// fire one real HTTP request per caller instead of deduping them. A native
// Promise settles once and safely fans out to every awaiter afterward.
let summaryCache: { promise: Promise<{ data: any; error: any }>; t: number } | null = null
const SUMMARY_TTL_MS = 5 * 60_000
function cachedSummary() {
  if (summaryCache && Date.now() - summaryCache.t < SUMMARY_TTL_MS) return summaryCache.promise
  const promise = (async () => supabase.rpc('road_corridor_summary'))()
  summaryCache = { promise, t: Date.now() }
  return promise
}

// Coarser grid at low zoom (cheap whole-region overview), finer as the
// caller zooms in — same "coarse then refined" tiering convention as
// intervalForZoom() (/api/map) and gridDegForZoom() (streetlights/road_assets).
function gridDegForZoom(zoom: number | null): number {
  if (zoom == null) return 0.03
  if (zoom <= 8) return 0.05
  if (zoom <= 10) return 0.02
  if (zoom <= 12) return 0.008
  if (zoom <= 14) return 0.003
  return 0.001
}

export async function GET(req: NextRequest) {
  const res = NextResponse.json({})
  const session = await getIronSession<AppSession>(req, res, sessionOptions)
  if (!session.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const regionParam = (searchParams.get('region') || '').toLowerCase()
  const region: Region | null = (REGIONS as readonly string[]).includes(regionParam) ? (regionParam as Region) : null

  const zoomParam = searchParams.get('zoom')
  const zoom = zoomParam !== null && !isNaN(Number(zoomParam)) ? Number(zoomParam) : null
  const gridDeg = gridDegForZoom(zoom)

  const bboxKeys = ['swLat', 'swLng', 'neLat', 'neLng'] as const
  const bboxVals = Object.fromEntries(bboxKeys.map(k => [k, searchParams.get(k)]))
  const hasBbox = bboxKeys.every(k => bboxVals[k] !== null && !isNaN(Number(bboxVals[k])))

  const t0 = Date.now()

  // Mirrors road_corridor_segments()'s own trigger for the close-zoom raw-
  // table detail path (p_grid_deg <= its 0.001 base grid, plus a bbox) —
  // that path uses keyset pagination (p_after_id) to page past PostgREST's
  // hard 1000-row-per-response cap, since a real dense hotspot (confirmed
  // live: 1000+ fragments in a ~90m x 155m area) needs more than one call's
  // worth of rows to render as genuinely dense rather than a patchy,
  // arbitrary 1000-row subset. The zoomed-out grid-cache overview path never
  // needs this — that table only has ~5k rows total per region, so a single
  // call already returns everything relevant.
  const isDetailZoom = hasBbox && gridDeg <= 0.001
  const MAX_DETAIL_PAGES = 5 // up to 5,000 real fragments per request — a defensive ceiling, not expected to be hit routinely

  type SegRow = { id: number; length_m: number; npoints: number; geojson: string }
  async function fetchSegments(): Promise<{ data: SegRow[] | null; error: unknown }> {
    if (!region) return { data: [], error: null }
    if (!isDetailZoom) {
      const singleRes = await supabase.rpc('road_corridor_segments', {
        p_region: region,
        p_min_lat: hasBbox ? Number(bboxVals.swLat) : null,
        p_max_lat: hasBbox ? Number(bboxVals.neLat) : null,
        p_min_lng: hasBbox ? Number(bboxVals.swLng) : null,
        p_max_lng: hasBbox ? Number(bboxVals.neLng) : null,
        p_grid_deg: gridDeg,
        p_max_segments: 3000,
      })
      return { data: singleRes.data as SegRow[] | null, error: singleRes.error }
    }
    const all: SegRow[] = []
    let afterId: number | null = null
    for (let page = 0; page < MAX_DETAIL_PAGES; page++) {
      const pageRes: { data: SegRow[] | null; error: unknown } = await supabase.rpc('road_corridor_segments', {
        p_region: region,
        p_min_lat: Number(bboxVals.swLat),
        p_max_lat: Number(bboxVals.neLat),
        p_min_lng: Number(bboxVals.swLng),
        p_max_lng: Number(bboxVals.neLng),
        p_grid_deg: gridDeg,
        p_max_segments: 1000,
        p_after_id: afterId,
      })
      if (pageRes.error) return pageRes
      const rows: SegRow[] = pageRes.data ?? []
      all.push(...rows)
      if (rows.length < 1000) break // exhausted the bbox — no more pages to fetch
      afterId = rows[rows.length - 1].id
    }
    return { data: all, error: null }
  }

  const [summaryRes, segmentsRes] = await Promise.all([cachedSummary(), fetchSegments()])

  if (summaryRes.error) {
    console.error('[road-corridors] summary RPC error:', JSON.stringify(summaryRes.error))
    return NextResponse.json({ error: 'Failed to load road corridor summary, please retry.' }, { status: 503 })
  }
  if (segmentsRes.error) {
    console.error('[road-corridors] segments RPC error:', JSON.stringify(segmentsRes.error))
    return NextResponse.json({ error: 'Failed to load road corridor segments, please retry.' }, { status: 503 })
  }

  const summary = (summaryRes.data ?? []).map((r: any) => ({
    region: r.region as Region,
    segmentCount: Number(r.segment_count),
    totalLengthM: Number(r.total_length_m),
  }))

  // ST_AsGeoJSON coordinates are [lng, lat] — flatten to {lat,lng}[] server-side
  // so the map client never has to touch raw GeoJSON.
  const segments = (segmentsRes.data ?? []).map((r: any) => {
    let path: { lat: number; lng: number }[] = []
    try {
      const geo = JSON.parse(r.geojson)
      path = (geo.coordinates ?? []).map(([lng, lat]: [number, number]) => ({ lat, lng }))
    } catch {}
    return { id: r.id, lengthM: Number(r.length_m), npoints: r.npoints as number, path }
  })

  return NextResponse.json({
    summary,
    region,
    segments,
    queryMs: Date.now() - t0,
  })
}
