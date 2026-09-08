import { NextRequest, NextResponse } from 'next/server'
import { getIronSession } from 'iron-session'
import { sessionOptions, AppSession } from '@/lib/session'

/* ── Config ────────────────────────────────────────────────────────────
   Add a new road section here when onboarding it: a FeatureServer base
   URL, its layer id -> color/style mapping, and a defaultBounds envelope
   (used whenever no zoomed-in viewport bbox is available — see GET below).
   No other file needs to change. Mirrors PROJECT_ID_MAP's exact convention
   in src/app/api/map/route.ts.

   Field names are NOT consistent across a FeatureServer's own layers (found
   the hard way: layers 74/75/76 use Entity_Name/Road_Section, while
   112/113/122 use a totally different SJ_* spatial-join schema —
   SJ_project/SJ_section/SJ_item/SJ_Side/SJ_Status/SJ_Chainag). Rather than
   configuring per-layer field names, GET always requests outFields=* and
   pickField() below tries a list of known candidate names — resilient to
   whatever schema a newly onboarded section's layers happen to use. ──── */
type DashStyle = 'solid' | 'dash' | 'dot' | 'dashdot'

interface RoadDesignLayerConfig {
  id: number
  label: string
  color: string
  dash: DashStyle
  weight: number
  zIndex: number
}

interface RoadDesignConfig {
  featureServer: string // no trailing slash
  layers: RoadDesignLayerConfig[]
  defaultBounds: { minLat: number; minLng: number; maxLat: number; maxLng: number }
}

const ROAD_DESIGN_LAYERS: Record<string, RoadDesignConfig> = {
  'Coastal Road': {
    featureServer: 'https://services2.arcgis.com/SnldgL6izbwRB976/arcgis/rest/services/Section_1c_Entities__WFL1/FeatureServer',
    layers: [
      { id: 74,  label: 'Slope',           color: '#b45309', dash: 'dash',    weight: 2, zIndex: 2.5 },
      { id: 113, label: 'Ducts',           color: '#a855f7', dash: 'dot',     weight: 2, zIndex: 2.5 },
      { id: 112, label: 'Drainage',        color: '#0ea5e9', dash: 'dashdot', weight: 3, zIndex: 2.5 },
      { id: 122, label: 'Culverts',        color: '#14b8a6', dash: 'solid',   weight: 3, zIndex: 2.5 },
      { id: 76,  label: 'Road Marking',    color: '#fbbf24', dash: 'dash',    weight: 2, zIndex: 2.5 },
      { id: 75,  label: 'Pavement (CRCP)', color: '#a8a29e', dash: 'solid',   weight: 4, zIndex: 2.6 },
    ],
    // Verified live: the union of all 6 layers' actual extents (they don't
    // all cover the same ground — e.g. top_slope/CRCP span the wider road,
    // the SJ_*-schema layers are narrower). This envelope was directly
    // tested to return real features from every layer, not guessed from a
    // single sample point.
    defaultBounds: { minLat: 6.39, minLng: 3.42, maxLat: 6.45, maxLng: 4.35 },
  },
}

const ENTITY_NAME_FIELDS = ['Entity_Name', 'Entity_name', 'entity_name', 'SJ_item', 'SJ_name_x', 'SJ_label_x', 'label', 'name']
const ROAD_SECTION_FIELDS = ['Road_Section', 'Road_section', 'road_section', 'SJ_project', 'SJ_section']
const SHAPE_LENGTH_FIELDS = ['Shape__Length', 'SJ_Length', 'SJ_Shape_L']
const SIDE_FIELDS = ['SJ_Side', 'Side', 'side']
const STATUS_FIELDS = ['SJ_Status', 'Status', 'status']
const CHAINAGE_FIELDS = ['SJ_Chainag', 'SJ_label_x', 'Chainage', 'chainage']

function pickField(props: Record<string, unknown>, candidates: string[]): string | number | null {
  const lower = new Map(Object.keys(props).map(k => [k.toLowerCase(), k]))
  for (const c of candidates) {
    const realKey = lower.get(c.toLowerCase())
    if (realKey !== undefined) {
      const v = props[realKey]
      if (v !== null && v !== undefined && v !== '') return v as string | number
    }
  }
  return null
}

function geometryToPaths(geom: any): { lat: number; lng: number }[][] {
  if (!geom) return []
  if (geom.type === 'LineString') {
    return [(geom.coordinates as number[][]).map(([lng, lat]) => ({ lat, lng }))]
  }
  if (geom.type === 'MultiLineString') {
    return (geom.coordinates as number[][][]).map(line => line.map(([lng, lat]) => ({ lat, lng })))
  }
  return []
}

interface DesignFeature {
  objectId: number | null
  entityName: string | null
  roadSection: string | null
  shapeLength: number | null
  side: string | null
  status: string | null
  chainage: string | null
  paths: { lat: number; lng: number }[][]
}

async function queryLayer(
  featureServer: string,
  layerId: number,
  bbox: { minLat: number; minLng: number; maxLat: number; maxLng: number }
): Promise<DesignFeature[]> {
  const features: DesignFeature[] = []
  const PAGE = 2000      // matches this FeatureServer's maxRecordCount
  const MAX_PAGES = 5    // defensive ceiling (10,000 features/layer) against
                          // a future, much denser section
  for (let page = 0, offset = 0; page < MAX_PAGES; page++, offset += PAGE) {
    const url = new URL(`${featureServer}/${layerId}/query`)
    url.searchParams.set('f', 'geojson')
    url.searchParams.set('outFields', '*')
    url.searchParams.set('geometry', `${bbox.minLng},${bbox.minLat},${bbox.maxLng},${bbox.maxLat}`)
    url.searchParams.set('geometryType', 'esriGeometryEnvelope')
    url.searchParams.set('spatialRel', 'esriSpatialRelIntersects')
    url.searchParams.set('inSR', '4326')
    url.searchParams.set('outSR', '4326')
    url.searchParams.set('resultRecordCount', String(PAGE))
    url.searchParams.set('resultOffset', String(offset))

    const r = await fetch(url.toString(), { signal: AbortSignal.timeout(10000) }).catch(() => null)
    if (!r || !r.ok) break
    const fc = await r.json().catch(() => null)
    if (!fc?.features) break

    for (const f of fc.features) {
      const paths = geometryToPaths(f.geometry)
      if (paths.length === 0) continue
      const props = f.properties ?? {}
      features.push({
        objectId:    (pickField(props, ['OBJECTID']) as number | null) ?? null,
        entityName:  pickField(props, ENTITY_NAME_FIELDS) as string | null,
        roadSection: pickField(props, ROAD_SECTION_FIELDS) as string | null,
        shapeLength: pickField(props, SHAPE_LENGTH_FIELDS) as number | null,
        side:        pickField(props, SIDE_FIELDS) as string | null,
        status:      pickField(props, STATUS_FIELDS) as string | null,
        chainage:    pickField(props, CHAINAGE_FIELDS) as string | null,
        paths,
      })
    }
    if (!fc.exceededTransferLimit) break
  }
  return features
}

export async function GET(req: NextRequest) {
  const res = NextResponse.json({})
  const session = await getIronSession<AppSession>(req, res, sessionOptions)
  if (!session.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const project = searchParams.get('project') || 'Coastal Road'
  const config = ROAD_DESIGN_LAYERS[project]

  // Not every project has design CAD data (only Coastal Road / Section 1c
  // today) — this is an expected, non-error case, not a 404. UnifiedMap's
  // fetch is unconditional per-project; the empty response is what makes
  // that safe.
  if (!config) return NextResponse.json({ project, source: 'none', layers: [] })

  const zoomParam = searchParams.get('zoom')
  const zoom = zoomParam !== null && !isNaN(Number(zoomParam)) ? Number(zoomParam) : null

  const bboxKeys = ['swLat', 'swLng', 'neLat', 'neLng'] as const
  const bboxVals = Object.fromEntries(bboxKeys.map(k => [k, searchParams.get(k)]))
  const hasViewportBbox = zoom !== null && zoom >= 12 && bboxKeys.every(k => bboxVals[k] !== null && !isNaN(Number(bboxVals[k])))

  const bbox = hasViewportBbox
    ? { minLat: Number(bboxVals.swLat), minLng: Number(bboxVals.swLng), maxLat: Number(bboxVals.neLat), maxLng: Number(bboxVals.neLng) }
    : config.defaultBounds

  const layers = await Promise.all(
    config.layers.map(async layerCfg => ({
      id: layerCfg.id, label: layerCfg.label,
      color: layerCfg.color, dash: layerCfg.dash, weight: layerCfg.weight, zIndex: layerCfg.zIndex,
      features: await queryLayer(config.featureServer, layerCfg.id, bbox).catch(() => []),
    }))
  )

  return NextResponse.json({
    project,
    source: hasViewportBbox ? 'viewport' : 'default-extent',
    layers,
  })
}
