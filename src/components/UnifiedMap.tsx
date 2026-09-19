'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { setOptions, importLibrary } from '@googlemaps/js-api-loader'
import { MarkerClusterer, NoopAlgorithm } from '@googlemaps/markerclusterer'
import { useMapView, readPersistedCamera, type MapLayerKey } from '@/lib/map-view'

/* ──────────────────────────────────────────────────────────────
   One map for the whole app. Merges what used to be two separate
   components:
     • HitechMap        — Coastal Road chainage line + ~9.7k activity-report
                           pins + the ArcGIS road-design CAD overlay
     • RoadAssetsMap     — the 7.27M-row road_assets table, server-clustered,
                           for Calabar / Ogun / Kebbi
   Layer visibility, colour-by and the last camera live in useMapView() so
   they survive navigating between /dashboard and /planning-implementation
   even though the Google Maps instance itself re-mounts on a route change.
────────────────────────────────────────────────────────────── */

/* ── Design tokens (kept local, same as the old HitechMap) ──── */
const D = {
  bg:    '#212124',
  panel: '#1e1e22',
  text:  '#cac6be',
  muted: '#848080',
  sub:   '#504e54',
  amber: '#d4a040',
  green: '#34d399',
  blue:  '#60a5fa',
  red:   '#e31c3d',
}
const SH_WELL   = 'inset 4px 4px 14px rgba(0,0,0,0.88), inset -1px -1px 3px rgba(255,255,255,0.03)'
const SH_RAISED = '3px 3px 10px rgba(0,0,0,0.78), -1px -1px 4px rgba(255,255,255,0.052), inset 0 1px 0 rgba(255,255,255,0.07)'

/* ── Colour maps ───────────────────────────────────────────── */
const CAT_COLORS: Record<string, string> = {
  'Earthworks':                       '#d4a040',
  'Construction':                     '#60a5fa',
  'Drainage Channels - Utilities':    '#34d399',
  'Surveying and Geospatial Services':'#a78bfa',
  'Road Markings and Signage':        '#f472b6',
  'Retaining wall':                   '#e87040',
  'Slop Protection':                  '#22d3ee',
  'Quality Control and Inspection':   '#e31c3d',
  'Vegetation and Landscaping':       '#86efac',
}
const STATUS_COLORS: Record<string, string> = {
  Completed:    '#34d399',
  Complete:     '#34d399',
  'In Progress':'#d4a040',
  Ongoing:      '#d4a040',
  Pending:      '#60a5fa',
}
const catColor    = (c: string) => CAT_COLORS[c]    || '#848080'
const statusColor = (s: string) => STATUS_COLORS[s] || '#848080'

const ROAD_PRIMARY   = '#ffffff'
const ROAD_SECONDARY = '#7d8590'
const HL_FILTER      = '#6366f1'

const COASTAL_PROJECT = 'Coastal Road'
const KEBBI_PROJECT   = 'SBS Sokoto Badagry highway'

/* road_assets project/section pairs — fixed, confirmed live. See
   src/app/api/road-assets/route.ts + the 2026-08-05 CLAUDE.md entry. */
const ASSET_SECTIONS: Record<'calabar' | 'ogun' | 'kebbi', { project: string; section: string }> = {
  calabar: { project: 'Coastal road',          section: 'Section 3 - Calabar' },
  ogun:    { project: 'Coastal road',          section: 'Section 3 - Ogun' },
  kebbi:   { project: 'Kebbi - Sokoto project', section: 'Kebbi section' },
}

/* Rough per-region camera — used to fit /planning-implementation's section
   filter and as a fallback focus target. The national default shows every
   layer at once, which is the /dashboard landing view. */
const REGION_CAMERA: Record<string, { lat: number; lng: number; zoom: number }> = {
  national: { lat: 8.6, lng: 5.4, zoom: 6 },
  coastal:  { lat: 6.44, lng: 3.63, zoom: 11 },
  calabar:  { lat: 4.98, lng: 8.33, zoom: 11 },
  ogun:     { lat: 6.37, lng: 4.47, zoom: 12 },
  kebbi:    { lat: 11.8, lng: 4.52, zoom: 8 },
}

/* ── Types ─────────────────────────────────────────────────── */
interface Station { label: number; chainage: string; latitude: number; longitude: number; project_id: number }

interface ActivityReport {
  id:                   number
  start_chainage?:      number | null
  end_chainage?:        number | null
  start_chainage_val?:  number | null
  end_chainage_val?:    number | null
  activity_category:    string
  activity_type:        string
  activity_status:      string
  reporter_name:        string
  date_of_activity:     string
  project_name:         string
  section_name:         string
  start_chainage_lat?:  string | null
  start_chainage_long?: string | null
  end_chainage_lat?:    string | null
  end_chainage_long?:   string | null
}

interface AssetCluster {
  layer: 'calabar' | 'ogun' | 'kebbi'
  lat: number
  lng: number
  count: number
  id?: number
  entityType?: string
  project?: string
  section?: string
  side?: string
  station?: string
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
interface DesignLayer {
  id: number
  label: string
  color: string
  dash: 'solid' | 'dash' | 'dot' | 'dashdot'
  weight: number
  zIndex: number
  features: DesignFeature[]
}
interface RoadDesignData { project: string; source: string; layers: DesignLayer[] }

interface ViewState { zoom: number; swLat: number; swLng: number; neLat: number; neLng: number }

interface Props {
  /** From /dashboard's active filters — drives the road-line highlight + the
     one-time fit when a chainage range is set. */
  chFrom?: string
  chTo?: string
  category?: string
  /** From /dashboard's Project filter — when set, drops the default all=1
     (every-project) report fetch in favor of scoping to just this project
     (see the reports-fetch effect below), and counts as an active filter
     for both clusterers' decluster check. */
  project?: string
  /** From /dashboard's Weather Conditions chart — same treatment as
     category: narrows which reports are fetched (see the reports-fetch
     effect below) and counts as an active filter for both clusterers'
     decluster check + the camera-fit trigger. */
  weather?: string
  /** From /planning-implementation's section filter — fits that region once
     on mount / when it changes. '' = show everything (national). */
  initialSection?: string
  /** Aggregate road-asset fetch stats, for the planning page's load-time KPI. */
  onLoadStats?: (stats: { queryMs: number; clientMs: number; count: number; mode: 'live' | 'mv' }) => void
  /** Map → filter bidirectional wiring: a "Filter by…" button inside a
     report/asset popup calls this with the same (key, value) shape
     dashboard/page.tsx's own handleFilter already accepts — clicking the
     already-active value again is expected to clear it, same convention as
     every chart's click-to-filter elsewhere on the page. Omit to leave
     popups info-only (no filter action offered). */
  onFilterRequest?: (key: 'category' | 'project' | 'section', value: string) => void
}

setOptions({ key: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || '', v: 'weekly' })

const regionOf = (r: { project_name?: string | null; section_name?: string | null }): MapLayerKey => {
  const s = `${r.section_name || ''} ${r.project_name || ''}`.toLowerCase()
  if (s.includes('calabar')) return 'calabar'
  if (s.includes('ogun'))    return 'ogun'
  if (s.includes('kebbi') || s.includes('sokoto')) return 'kebbi'
  return 'reports'
}

/* ── Component ─────────────────────────────────────────────── */
export default function UnifiedMap({ chFrom, chTo, category, project, weather, initialSection, onLoadStats, onFilterRequest }: Props) {
  const { camera, setCamera, layers, toggleLayer, setLayer, colorBy, setColorBy, focusRequest, clearFocusRequest } = useMapView()

  const mapContainer = useRef<HTMLDivElement>(null)
  const mapRef       = useRef<google.maps.Map | null>(null)
  const [mapLoaded,  setMapLoaded]  = useState(false)
  const [viewState,  setViewState]  = useState<ViewState | null>(null)
  const [error,      setError]      = useState('')

  const [coastalStations, setCoastalStations] = useState<Station[]>([])
  const [kebbiStations,    setKebbiStations]  = useState<Station[]>([])
  const [reports,          setReports]        = useState<ActivityReport[]>([])
  const [reportsLoading,   setReportsLoading] = useState(true)
  const [assetClusters,    setAssetClusters]  = useState<AssetCluster[]>([])
  const [assetsRefreshing, setAssetsRefreshing] = useState(false)
  // What's actually plotted after the chainage-range filter below narrows
  // `reports` (which itself is only ever server-narrowed by category) — the
  // "N reports" readout should match what's on the map, not the fetched set.
  const [visibleReportCount, setVisibleReportCount] = useState(0)

  const [designData, setDesignData] = useState<RoadDesignData | null>(null)
  const [designLoading, setDesignLoading] = useState(false)

  const [selReport, setSelReport] = useState<ActivityReport | null>(null)
  const [selDesign, setSelDesign] = useState<{ feature: DesignFeature; layer: DesignLayer } | null>(null)
  const [selCell,   setSelCell]   = useState<AssetCluster | null>(null)

  // Clickable legend (PowerBI/ArcGIS-style series toggling) — clicking a
  // legend swatch hides/shows just that category, status, or design layer
  // without touching the coarser LAYER_CHIPS on/off toggles above the map.
  // Kept as two separate sets (not one, reset on colorBy change) so
  // switching Color By doesn't lose whichever set isn't currently in view.
  const [hiddenCategories, setHiddenCategories] = useState<Set<string>>(new Set())
  const [hiddenStatuses,   setHiddenStatuses]   = useState<Set<string>>(new Set())
  const [hiddenDesignLayers, setHiddenDesignLayers] = useState<Set<number>>(new Set())

  // Overlay refs (no Mapbox-style setData — clear + rebuild each time)
  const primaryLineRef   = useRef<google.maps.Polyline | null>(null)
  const secondaryLineRef = useRef<google.maps.Polyline | null>(null)
  const highlightLinesRef = useRef<google.maps.Polyline[]>([])
  const tickMarkersRef   = useRef<google.maps.Marker[]>([])
  const reportLinesRef   = useRef<google.maps.Polyline[]>([])
  const reportClustererRef = useRef<MarkerClusterer | null>(null)
  const reportClusterModeRef = useRef<boolean | null>(null)
  const assetClustererRef  = useRef<MarkerClusterer | null>(null)
  const assetClusterModeRef = useRef<boolean | null>(null)
  const designLinesRef   = useRef<google.maps.Polyline[]>([])

  const mapReqKeyRef    = useRef<string>('')
  const kebbiFetchedRef = useRef(false)
  const designReqKeyRef = useRef<string>('')
  const lastFocusRef    = useRef<number | string | null>(null)
  const lastSectionFitRef = useRef<string | null>(null)
  const filterFitRef    = useRef<string | null>(null)
  const catFitRef       = useRef<string | null>(null)

  const bbox = (v: ViewState | null) =>
    v && v.zoom >= 12
      ? { swLat: v.swLat, swLng: v.swLng, neLat: v.neLat, neLng: v.neLng }
      : null

  /* ── Fetch: Coastal stations + reports ────────────────────────
     No project filter selected: all=1 returns every project's reports, so
     Calabar/Kebbi/Ogun pins come down alongside Coastal's, and stations
     default to Coastal Road. Once a project IS selected (confirmed with the
     user, see the 2026-09-17 (7) changelog — chosen over "just decluster,
     keep showing every project"), all=1 is dropped and `project` is sent
     as the real filter value instead of the hardcoded default — /api/map's
     own existing project-scoping (.ilike('project_name', ...), same
     convention as /api/progress) then does the narrowing, so a project
     change actually reduces which pins show, not just whether they cluster.
     Skipped entirely when neither the road-line nor the reports layer is on. */
  useEffect(() => {
    if (!layers.coastalLine && !layers.reports) { setReports([]); setCoastalStations([]); setReportsLoading(false); return }
    const b = bbox(viewState)
    const key = `${layers.reports}|${category || ''}|${project || ''}|${weather || ''}|${viewState?.zoom ?? ''}|${b ? `${b.swLat.toFixed(2)},${b.swLng.toFixed(2)},${b.neLat.toFixed(2)},${b.neLng.toFixed(2)}` : 'wide'}`
    if (mapReqKeyRef.current === key) return
    mapReqKeyRef.current = key

    const p = new URLSearchParams({ project: project || COASTAL_PROJECT })
    if (!project) p.set('all', '1')
    if (category) p.set('category', category)
    if (weather) p.set('weather', weather)
    if (viewState) p.set('zoom', String(viewState.zoom))
    if (b) { p.set('swLat', String(b.swLat)); p.set('swLng', String(b.swLng)); p.set('neLat', String(b.neLat)); p.set('neLng', String(b.neLng)) }

    setReportsLoading(true)
    fetch(`/api/map?${p.toString()}`)
      .then(r => r.json())
      .then(d => {
        setCoastalStations(d.stations ?? [])
        setReports(d.reports ?? [])

        // Fit the camera to a *category or project* filter right here, off
        // the response that was actually just fetched for it — not in a
        // separate effect keyed on the category/project props, which fires
        // as soon as a prop changes and would otherwise race this fetch,
        // computing bounds from the *previous* filter's reports still
        // sitting in state. Only a real change fits — EXCEPT the very first
        // run, which used to always seed-and-skip (to avoid yanking a
        // restored/persisted camera on a plain page load). That was wrong
        // whenever the URL already specifies a filter on first load (e.g.
        // navigating straight to /dashboard?category=Earthworks) — there's
        // no meaningful "previous view" to protect in that case, and the map
        // was silently sitting at whatever camera was last persisted,
        // completely unrelated to the filter (confirmed live: a fresh load
        // of ?category=Earthworks showed a random leftover close-up zoom).
        // So: seed-and-skip only when there's genuinely no filter yet.
        const filterKey = `${category || ''}|${project || ''}|${weather || ''}`
        const hasFilter = !!category || !!project || !!weather
        if (catFitRef.current === null) {
          catFitRef.current = filterKey
          if (!hasFilter) return
        } else {
          if (catFitRef.current === filterKey) return
          catFitRef.current = filterKey
        }
        if (!hasFilter || !mapRef.current) return
        const secRegion = initialSection ? sectionRegion(initialSection) : ''
        if (secRegion === 'calabar' || secRegion === 'ogun' || secRegion === 'kebbi') return

        // Resolve each report's position the SAME way the render effect
        // does (nearest-chainage-station snap for Coastal reports, raw GPS
        // only as a fallback) — not raw start_chainage_lat/long directly.
        // That field is known-unreliable at scale (2026-07-22 changelog: a
        // single stuck/cached GPS value is reused across thousands of
        // reports spanning completely different chainages) — computing
        // bounds from it can pull the fit toward a location that has
        // nothing to do with where the pins actually render.
        const stations = (d.stations ?? []) as Station[]
        const nearestStationForFit = (targetLabel: number): Station | undefined => {
          let best: Station | undefined, bestDist = Infinity
          for (const s of stations) {
            const dist = Math.abs(s.label - targetLabel)
            if (dist < bestDist) { best = s; bestDist = dist }
          }
          return best
        }
        const chainageNumForFit = (val?: number | null, text?: number | null): number | null => {
          if (val != null && !isNaN(val)) return val
          if (text != null) { const n = Number(String(text).replace('+', '')); if (!isNaN(n)) return n }
          return null
        }

        const map = mapRef.current
        const b = new google.maps.LatLngBounds()
        let points = 0
        for (const r of (d.reports ?? []) as ActivityReport[]) {
          const snap = regionOf(r) === 'reports'
          const ch = chainageNumForFit(r.start_chainage_val, r.start_chainage)
          const station = snap && ch != null ? nearestStationForFit(ch) : undefined
          const lat = station?.latitude  ?? (r.start_chainage_lat  ? parseFloat(r.start_chainage_lat)  : NaN)
          const lng = station?.longitude ?? (r.start_chainage_long ? parseFloat(r.start_chainage_long) : NaN)
          if (!isNaN(lat) && !isNaN(lng)) { b.extend({ lat, lng }); points++ }
        }
        if (points === 0) return
        if (points === 1 || b.getNorthEast().equals(b.getSouthWest())) {
          map.panTo(b.getCenter())
          map.setZoom(16)
        } else {
          map.fitBounds(b, 70)
          google.maps.event.addListenerOnce(map, 'bounds_changed', () => { if ((map.getZoom() ?? 0) > 16) map.setZoom(16) })
        }
      })
      .catch(() => setError('Failed to load map data'))
      .finally(() => setReportsLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layers.coastalLine, layers.reports, category, project, weather, viewState])

  /* ── Fetch: Kebbi corridor line (static context, fixed coarse zoom) ── */
  useEffect(() => {
    if (!layers.kebbi || kebbiFetchedRef.current) return
    kebbiFetchedRef.current = true
    fetch(`/api/map?${new URLSearchParams({ project: KEBBI_PROJECT, zoom: '9' }).toString()}`)
      .then(r => r.json())
      .then(d => setKebbiStations(d.stations ?? []))
      .catch(() => {})
  }, [layers.kebbi])

  /* ── Fetch: road-asset clusters, one request per enabled section ────── */
  useEffect(() => {
    const enabled = (['calabar', 'ogun', 'kebbi'] as const).filter(k => layers[k])
    if (enabled.length === 0) { setAssetClusters([]); return }
    const b = bbox(viewState)
    setAssetsRefreshing(true)
    const t0 = performance.now()

    Promise.all(enabled.map(k => {
      const { project, section } = ASSET_SECTIONS[k]
      const p = new URLSearchParams({ project, section })
      if (viewState) p.set('zoom', String(viewState.zoom))
      if (b) { p.set('swLat', String(b.swLat)); p.set('swLng', String(b.swLng)); p.set('neLat', String(b.neLat)); p.set('neLng', String(b.neLng)) }
      return fetch(`/api/road-assets?${p.toString()}`)
        .then(r => r.json())
        .then(d => ({ k, d }))
        .catch(() => ({ k, d: { clusters: [], queryMs: 0, clusterMode: 'mv' } }))
    })).then(results => {
      const merged: AssetCluster[] = []
      let queryMs = 0
      let mode: 'live' | 'mv' = 'mv'
      for (const { k, d } of results) {
        queryMs = Math.max(queryMs, d.queryMs ?? 0)
        if (d.clusterMode === 'live') mode = 'live'
        for (const c of (d.clusters ?? [])) merged.push({ layer: k, lat: c.lat, lng: c.lng, count: c.count, id: c.id, entityType: c.entityType, project: c.project, section: c.section, side: c.side, station: c.station })
      }
      setAssetClusters(merged)
      setAssetsRefreshing(false)
      onLoadStats?.({ queryMs, clientMs: Math.round(performance.now() - t0), count: merged.length, mode })
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layers.calabar, layers.ogun, layers.kebbi, viewState])

  /* ── Fetch: ArcGIS road-design overlay ─────────────────────── */
  useEffect(() => {
    if (!layers.design) { setDesignData(null); return }
    const zoom = viewState?.zoom ?? null
    const useViewport = zoom !== null && zoom >= 12 && !!viewState
    const key = useViewport
      ? `${zoom}|${viewState!.swLat.toFixed(3)}|${viewState!.swLng.toFixed(3)}|${viewState!.neLat.toFixed(3)}|${viewState!.neLng.toFixed(3)}`
      : 'default'
    if (designReqKeyRef.current === key) return
    designReqKeyRef.current = key

    const p = new URLSearchParams({ project: COASTAL_PROJECT })
    if (useViewport) {
      p.set('zoom', String(viewState!.zoom))
      p.set('swLat', String(viewState!.swLat)); p.set('swLng', String(viewState!.swLng))
      p.set('neLat', String(viewState!.neLat)); p.set('neLng', String(viewState!.neLng))
    }
    setDesignLoading(true)
    fetch(`/api/road-design?${p.toString()}`)
      .then(r => r.json())
      .then(d => setDesignData(d))
      .catch(() => {})
      .finally(() => setDesignLoading(false))
  }, [layers.design, viewState])

  /* ── Initialise the map once ──────────────────────────────── */
  useEffect(() => {
    if (!mapContainer.current || mapRef.current) return
    if (!process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY) {
      setError('Google Maps API key not set (NEXT_PUBLIC_GOOGLE_MAPS_API_KEY missing)')
      return
    }
    let cancelled = false

    // camera (context) is null on a fresh mount — the provider's hydrate
    // effect runs *after* this child effect — so fall back to a direct
    // localStorage read. initialSection only wins when there's no saved view.
    const start = camera
      ?? readPersistedCamera()
      ?? REGION_CAMERA[initialSection ? sectionRegion(initialSection) : 'national']
      ?? REGION_CAMERA.national

    importLibrary('maps').then(({ Map }) => {
      if (cancelled || !mapContainer.current) return
      let localMap: google.maps.Map
      try {
        localMap = new Map(mapContainer.current, {
          center: { lat: start.lat, lng: start.lng },
          zoom: start.zoom,
          mapTypeId: 'hybrid',
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
          scaleControl: true,
          zoomControl: true,
          zoomControlOptions: { position: google.maps.ControlPosition.RIGHT_TOP },
          clickableIcons: false,
        })
      } catch (err: any) {
        setError(`Map init failed: ${err?.message || String(err)}`)
        return
      }
      mapRef.current = localMap
      ;(window as any).__debugMap = localMap
      setMapLoaded(true)

      localMap.addListener('click', () => { setSelReport(null); setSelDesign(null); setSelCell(null) })
      localMap.addListener('idle', () => {
        const b = localMap.getBounds()
        if (!b) return
        const sw = b.getSouthWest(), ne = b.getNorthEast()
        const c = localMap.getCenter()
        const z = localMap.getZoom() ?? start.zoom
        setViewState({ zoom: z, swLat: sw.lat(), swLng: sw.lng(), neLat: ne.lat(), neLng: ne.lng() })
        if (c) setCamera({ lat: c.lat(), lng: c.lng(), zoom: z })
      })
    }).catch((err: any) => {
      if (!cancelled) setError(`Failed to load Google Maps: ${err?.message || String(err)}`)
    })

    return () => {
      cancelled = true
      primaryLineRef.current?.setMap(null)
      secondaryLineRef.current?.setMap(null)
      highlightLinesRef.current.forEach(l => l.setMap(null))
      tickMarkersRef.current.forEach(m => m.setMap(null))
      reportLinesRef.current.forEach(l => l.setMap(null))
      designLinesRef.current.forEach(l => l.setMap(null))
      reportClustererRef.current?.clearMarkers()
      assetClustererRef.current?.clearMarkers()
      mapRef.current = null
      setMapLoaded(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* ── Fit /planning-implementation's section filter ─────────────────────
     Only fires for a real (non-empty) section pick, and only when it
     actually changes — an empty section must NOT clobber the camera
     restored from context on a fresh mount. First run is seeded from the
     initial prop value so the very first real section doesn't re-fit. */
  useEffect(() => {
    if (lastSectionFitRef.current === null) { lastSectionFitRef.current = initialSection ?? '' ; return }
    if (!mapLoaded || !mapRef.current || !initialSection) return
    if (lastSectionFitRef.current === initialSection) return
    lastSectionFitRef.current = initialSection
    const cam = REGION_CAMERA[sectionRegion(initialSection)]
    if (cam) { mapRef.current.setCenter({ lat: cam.lat, lng: cam.lng }); mapRef.current.setZoom(cam.zoom) }
  }, [mapLoaded, initialSection])

  /* ── Render: Coastal line, ticks, highlight, report pins ───── */
  useEffect(() => {
    if (!mapLoaded || !mapRef.current) return
    const map = mapRef.current

    primaryLineRef.current?.setMap(null)
    secondaryLineRef.current?.setMap(null)
    highlightLinesRef.current.forEach(l => l.setMap(null)); highlightLinesRef.current = []
    tickMarkersRef.current.forEach(m => m.setMap(null)); tickMarkersRef.current = []
    reportLinesRef.current.forEach(l => l.setMap(null)); reportLinesRef.current = []
    reportClustererRef.current?.clearMarkers()

    /* Kebbi corridor line — background context */
    if (layers.kebbi && kebbiStations.length > 0) {
      const sorted = [...kebbiStations].sort((a, b) => a.label - b.label)
      secondaryLineRef.current = new google.maps.Polyline({
        path: sorted.map(s => ({ lat: s.latitude, lng: s.longitude })),
        strokeColor: ROAD_SECONDARY, strokeOpacity: 0.75, strokeWeight: 2.5,
        clickable: false, zIndex: 1, map,
      })
    }

    /* Coastal road line + 1km ticks */
    if (layers.coastalLine && coastalStations.length > 0) {
      const sorted = [...coastalStations].sort((a, b) => a.label - b.label)
      primaryLineRef.current = new google.maps.Polyline({
        path: sorted.map(s => ({ lat: s.latitude, lng: s.longitude })),
        strokeColor: ROAD_PRIMARY, strokeOpacity: 0.9, strokeWeight: 3,
        clickable: false, zIndex: 2, map,
      })
      tickMarkersRef.current = coastalStations
        .filter(s => s.label % 1000 === 0)
        .map(s => new google.maps.Marker({
          position: { lat: s.latitude, lng: s.longitude },
          map,
          icon: { path: google.maps.SymbolPath.CIRCLE, scale: 0, strokeOpacity: 0, fillOpacity: 0, anchor: new google.maps.Point(0, 0), labelOrigin: new google.maps.Point(0, -8) },
          label: { text: s.chainage, color: D.amber, fontSize: '13px', fontWeight: '700', fontFamily: 'var(--font-mono)' },
          clickable: false, zIndex: 2,
        }))
    }

    const nearestStation = (targetLabel: number): Station | undefined => {
      let best: Station | undefined, bestDist = Infinity
      for (const s of coastalStations) {
        const d = Math.abs(s.label - targetLabel)
        if (d < bestDist) { best = s; bestDist = d }
      }
      return best
    }
    const chainageNum = (val?: number | null, text?: number | null): number | null => {
      if (val != null && !isNaN(val)) return val
      if (text != null) { const n = Number(String(text).replace('+', '')); if (!isNaN(n)) return n }
      return null
    }
    const colorFor = (r: ActivityReport) => colorBy === 'category' ? catColor(r.activity_category) : statusColor(r.activity_status)

    /* Road-line highlight for an active category / chainage filter */
    if (layers.coastalLine && coastalStations.length > 0) {
      const HL_MERGE_GAP = 500
      const mergeRanges = (ranges: [number, number][]): [number, number][] => {
        if (ranges.length === 0) return []
        const s = [...ranges].sort((a, b) => a[0] - b[0])
        const out: [number, number][] = [[...s[0]] as [number, number]]
        for (let i = 1; i < s.length; i++) {
          const [a, b] = s[i], last = out[out.length - 1]
          if (a <= last[1] + HL_MERGE_GAP) last[1] = Math.max(last[1], b)
          else out.push([a, b])
        }
        return out
      }
      const chainagePath = (fromCh: number, toCh: number) => {
        const lo = Math.min(fromCh, toCh), hi = Math.max(fromCh, toCh)
        const within = coastalStations.filter(s => s.label >= lo && s.label <= hi).sort((a, b) => a.label - b.label)
        const startS = nearestStation(lo), endS = nearestStation(hi)
        const pts = [...within]
        if (startS && pts[0]?.label !== startS.label) pts.unshift(startS)
        if (endS && pts[pts.length - 1]?.label !== endS.label) pts.push(endS)
        return pts.map(s => ({ lat: s.latitude, lng: s.longitude }))
      }
      let ranges: [number, number][] = []
      if (category && layers.reports) {
        const raw: [number, number][] = []
        reports.forEach(r => {
          if (regionOf(r) !== 'reports') return
          const a = chainageNum(r.start_chainage_val, r.start_chainage)
          const b = chainageNum(r.end_chainage_val, r.end_chainage)
          if (a != null && b != null) raw.push([Math.min(a, b), Math.max(a, b)])
        })
        ranges = mergeRanges(raw)
      } else {
        const f = chFrom ? Number(chFrom) : null, t = chTo ? Number(chTo) : null
        if (f != null && t != null && !isNaN(f) && !isNaN(t) && t > f) ranges = [[f, t]]
      }
      highlightLinesRef.current = ranges
        .map(([lo, hi]) => chainagePath(lo, hi))
        .filter(path => path.length >= 2)
        .map(path => new google.maps.Polyline({ path, strokeColor: HL_FILTER, strokeOpacity: 0.9, strokeWeight: 6, clickable: false, zIndex: 3, map }))
    }

    /* Report pins */
    if (layers.reports) {
      // An active category, project, and/or a fully-set chainage range all
      // narrow which reports actually render — when any is on, the
      // clusterer below is swapped to NoopAlgorithm so the (now much
      // smaller) matching set shows as individual pins rather than a
      // bubbled count, matching the "zoom to the filtered point(s), no
      // clusters" behaviour asked for. `project` added 2026-09-17 (7) —
      // previously this only checked category/chainage, so selecting a
      // project (which does genuinely narrow `reports`, see the fetch
      // effect above) still left the map clustered.
      const chF = chFrom ? Number(chFrom) : NaN
      const chT = chTo ? Number(chTo) : NaN
      const chActive = !isNaN(chF) && !isNaN(chT) && chT > chF
      const hasActiveFilter = !!category || !!project || !!weather || chActive

      const markers: google.maps.Marker[] = []
      const lines: google.maps.Polyline[] = []
      reports
        .filter(r => r.start_chainage != null || r.start_chainage_val != null || r.start_chainage_lat != null)
        .forEach(r => {
          const region = regionOf(r)
          const snap = region === 'reports'
          const startCh = chainageNum(r.start_chainage_val, r.start_chainage)
          const startStation = snap && startCh != null ? nearestStation(startCh) : undefined
          const startLat = startStation?.latitude  ?? (r.start_chainage_lat  ? parseFloat(r.start_chainage_lat)  : undefined)
          const startLng = startStation?.longitude ?? (r.start_chainage_long ? parseFloat(r.start_chainage_long) : undefined)
          const endCh = chainageNum(r.end_chainage_val, r.end_chainage)
          const endStation = snap && endCh != null ? nearestStation(endCh) : undefined
          const endLat = endStation?.latitude  ?? (r.end_chainage_lat  ? parseFloat(r.end_chainage_lat)  : undefined)
          const endLng = endStation?.longitude ?? (r.end_chainage_long ? parseFloat(r.end_chainage_long) : undefined)
          if (startLat == null || startLng == null || isNaN(startLat) || isNaN(startLng)) return

          // Chainage filter only has meaning for Coastal (chainage-tracked)
          // reports — apply it there, leave Calabar/Ogun/Kebbi pins alone.
          if (chActive && region === 'reports') {
            const rStart = startCh ?? endCh
            const rEnd   = endCh   ?? startCh
            if (rStart == null || rEnd == null || rEnd < chF || rStart > chT) return
          }

          // Clickable-legend hide: skip whichever dimension is currently
          // being colour-coded (and thus shown in the legend) if the user
          // clicked that swatch to hide it.
          if (colorBy === 'category' && hiddenCategories.has(r.activity_category)) return
          if (colorBy === 'status'   && hiddenStatuses.has(r.activity_status))     return

          const endTooFar = endLat != null && endLng != null && !isNaN(endLat) && !isNaN(endLng)
            && Math.hypot(endLng - startLng, endLat - startLat) > 0.05
          // While a filter narrows the view, always render a single point
          // per report (ArcGIS/Power BI convention — one dot per record)
          // rather than a line spanning its start→end chainage. The
          // unfiltered default view keeps the extent-line, which is useful
          // context for browsing all activity along the road at once.
          const samePoint = hasActiveFilter || endLat == null || endLng == null
            || (startLat === endLat && startLng === endLng) || endTooFar
          const color = colorFor(r)
          // Native browser tooltip on hover — cheap at this marker count
          // (no per-marker mouseover/mouseout JS needed) and matches the
          // "hover for a quick look" ask without a custom overlay.
          const hoverTitle = `${r.activity_category} · ${r.activity_type}\n${r.activity_status} · ${r.section_name || r.project_name}`

          if (samePoint) {
            const m = new google.maps.Marker({
              title: hoverTitle,
              position: { lat: startLat, lng: startLng },
              icon: { path: google.maps.SymbolPath.CIRCLE, fillColor: color, fillOpacity: 0.9, strokeColor: 'rgba(0,0,0,0.6)', strokeWeight: 2, scale: 7 },
              zIndex: 5,
            })
            m.addListener('click', () => { setSelReport(r); setSelCell(null); setSelDesign(null) })
            markers.push(m)
          } else {
            // google.maps.Polyline has no native `title`/hover-tooltip
            // support (Marker-only) — lines only ever appear in the
            // unfiltered default view now (see samePoint above), so this is
            // click-only; a custom cursor-following overlay wasn't worth
            // the complexity for the secondary case.
            const line = new google.maps.Polyline({
              path: [{ lat: startLat, lng: startLng }, { lat: endLat!, lng: endLng! }],
              strokeColor: color, strokeOpacity: 0.85, strokeWeight: 6, clickable: true, zIndex: 4, map,
            })
            line.addListener('click', () => { setSelReport(r); setSelCell(null); setSelDesign(null) })
            lines.push(line)
          }
        })
      reportLinesRef.current = lines
      setVisibleReportCount(markers.length + lines.length)

      // Swap the clusterer's algorithm (only settable at construction) when
      // filter state flips between "cluster nearby pins" and "show every
      // matching pin individually" — recreate rather than mutate in place.
      if (reportClustererRef.current && reportClusterModeRef.current !== hasActiveFilter) {
        reportClustererRef.current.setMap(null)
        reportClustererRef.current = null
      }
      if (reportClustererRef.current) {
        reportClustererRef.current.addMarkers(markers)
      } else {
        reportClustererRef.current = new MarkerClusterer({
          map, markers,
          algorithm: hasActiveFilter ? new NoopAlgorithm({}) : undefined,
          renderer: { render: ({ count, position }) => {
            const radius = count >= 500 ? 30 : count >= 100 ? 24 : count >= 25 ? 18 : 14
            return new google.maps.Marker({
              position,
              icon: { path: google.maps.SymbolPath.CIRCLE, fillColor: D.amber, fillOpacity: 0.85, strokeColor: 'rgba(0,0,0,0.5)', strokeWeight: 2, scale: radius },
              label: { text: String(count), color: '#000', fontSize: '11px', fontFamily: 'var(--font-mono)' },
              zIndex: 1000 + count,
            })
          } },
        })
        reportClusterModeRef.current = hasActiveFilter
      }
    } else {
      setVisibleReportCount(0)
    }
  }, [mapLoaded, coastalStations, kebbiStations, reports, colorBy, category, project, weather, chFrom, chTo, layers.coastalLine, layers.reports, layers.kebbi, hiddenCategories, hiddenStatuses])

  /* ── Render: road-asset clusters ──────────────────────────── */
  useEffect(() => {
    if (!mapLoaded || !mapRef.current) return
    const map = mapRef.current

    // Same "no clusters once something is filtered" behaviour the report
    // pins already have (see the "Report pins" block below) — extended here
    // on direct user ask, since this clusterer previously never checked any
    // filter state at all and stayed bubbled regardless. category/project/
    // chFrom/chTo don't actually narrow road_assets' own data (it has no
    // activity_category or project_name column matching the reports side),
    // and initialSection does narrow which Calabar/Ogun/Kebbi section is
    // fetched — but the user confirmed they want ALL of these treated as
    // "a filter is active" for this layer, for one consistent whole-map
    // behaviour rather than a data-semantics distinction a viewer wouldn't
    // necessarily notice either way. `project` added 2026-09-17 (7) for the
    // same reason (a project selection is just as much "a filter is
    // active" as category ever was, even though it doesn't narrow assets).
    const chF = chFrom ? Number(chFrom) : NaN
    const chT = chTo ? Number(chTo) : NaN
    const chActive = !isNaN(chF) && !isNaN(chT) && chT > chF
    const hasActiveFilter = !!category || !!project || !!weather || chActive || !!initialSection

    const markers = assetClusters.map(c => {
      const single = c.count === 1 && c.id != null
      const m = new google.maps.Marker({
        title: single ? `${c.entityType || 'Asset'} · ${c.section || c.layer}` : `Cluster of ${c.count.toLocaleString()} — ${c.layer}`,
        position: { lat: c.lat, lng: c.lng },
        icon: { path: google.maps.SymbolPath.CIRCLE, fillColor: single ? D.green : D.blue, fillOpacity: 0.85, strokeColor: 'rgba(0,0,0,0.55)', strokeWeight: 2, scale: single ? 6 : 8 },
        zIndex: single ? 400 : 90,
      })
      m.addListener('click', () => { setSelCell(c); setSelReport(null); setSelDesign(null) })
      return m
    })

    if (assetClustererRef.current && assetClusterModeRef.current !== hasActiveFilter) {
      assetClustererRef.current.setMap(null)
      assetClustererRef.current = null
    }
    if (assetClustererRef.current) {
      assetClustererRef.current.clearMarkers()
      assetClustererRef.current.addMarkers(markers)
    } else {
      assetClustererRef.current = new MarkerClusterer({
        map, markers,
        algorithm: hasActiveFilter ? new NoopAlgorithm({}) : undefined,
        renderer: { render: ({ count, position }) => {
          const radius = count >= 500 ? 30 : count >= 100 ? 24 : count >= 25 ? 18 : 14
          return new google.maps.Marker({
            position,
            icon: { path: google.maps.SymbolPath.CIRCLE, fillColor: D.blue, fillOpacity: 0.8, strokeColor: 'rgba(0,0,0,0.5)', strokeWeight: 2, scale: radius },
            label: { text: String(count), color: '#000', fontSize: '11px', fontFamily: 'var(--font-mono)' },
            zIndex: 900 + count,
          })
        } },
      })
      assetClusterModeRef.current = hasActiveFilter
    }
  }, [mapLoaded, assetClusters, category, project, weather, chFrom, chTo, initialSection])

  /* ── Render: ArcGIS road-design overlay ───────────────────── */
  useEffect(() => {
    if (!mapLoaded || !mapRef.current) return
    const map = mapRef.current
    designLinesRef.current.forEach(l => l.setMap(null))
    designLinesRef.current = []
    if (!layers.design || !designData) return

    const dashIcons = (dash: DesignLayer['dash']): google.maps.IconSequence[] | undefined => {
      if (dash === 'solid') return undefined
      const dashSym = { path: 'M 0,-1 0,1', strokeOpacity: 1, scale: 3 }
      const dotSym  = { path: google.maps.SymbolPath.CIRCLE, strokeOpacity: 1, scale: 2, fillOpacity: 1 }
      if (dash === 'dash') return [{ icon: dashSym, offset: '0', repeat: '14px' }]
      if (dash === 'dot')  return [{ icon: dotSym,  offset: '0', repeat: '10px' }]
      return [{ icon: dashSym, offset: '0', repeat: '20px' }, { icon: dotSym, offset: '10px', repeat: '20px' }]
    }
    const lines: google.maps.Polyline[] = []
    designData.layers.forEach(layer => {
      if (hiddenDesignLayers.has(layer.id)) return // clickable-legend hide
      const icons = dashIcons(layer.dash)
      layer.features.forEach(feature => {
        feature.paths.forEach(path => {
          if (path.length < 2) return
          const line = new google.maps.Polyline({
            path, strokeColor: layer.color, strokeOpacity: icons ? 0 : 0.95, strokeWeight: layer.weight,
            icons, clickable: true, zIndex: layer.zIndex, map,
          })
          line.addListener('click', () => { setSelDesign({ feature, layer }); setSelReport(null); setSelCell(null) })
          lines.push(line)
        })
      })
    })
    designLinesRef.current = lines
  }, [mapLoaded, designData, layers.design, hiddenDesignLayers])

  /* ── Consume a focus request (report row clicked elsewhere) ── */
  useEffect(() => {
    if (!focusRequest || !mapLoaded || !mapRef.current) return
    const sig = focusRequest.reportId ?? `${focusRequest.lat},${focusRequest.lng}`
    if (lastFocusRef.current === sig) return
    lastFocusRef.current = sig

    if (focusRequest.enableLayer) setLayer(focusRequest.enableLayer, true)
    if (!isNaN(focusRequest.lat) && !isNaN(focusRequest.lng)) {
      mapRef.current.panTo({ lat: focusRequest.lat, lng: focusRequest.lng })
      mapRef.current.setZoom(focusRequest.zoom ?? 16)
    }
    if (focusRequest.popup && focusRequest.reportId != null) {
      setSelReport({
        id: focusRequest.reportId,
        activity_category: focusRequest.popup.activity_category || '',
        activity_type: focusRequest.popup.activity_type || '',
        activity_status: focusRequest.popup.activity_status || '',
        reporter_name: focusRequest.popup.reporter_name || '',
        section_name: focusRequest.popup.section_name || '',
        project_name: '',
        date_of_activity: focusRequest.popup.date_of_activity || '',
        start_chainage: focusRequest.popup.start_chainage as any,
        end_chainage: focusRequest.popup.end_chainage as any,
      })
      setSelCell(null); setSelDesign(null)
    }
    clearFocusRequest()
  }, [focusRequest, mapLoaded, setLayer, clearFocusRequest])

  /* ── Fit to an active chainage-only filter (dashboard) ──────────────────
     The category case is fitted where its data actually arrives (the
     reports-fetch effect above) — computing it here from `reports` state
     races that fetch and ends up fitting to the *previous* category's
     already-loaded reports (a real bug, not hypothetical — caught live:
     selecting a category moved the camera only slightly, toward whatever
     the stale full/previous report set's centroid was, not the new
     category's actual location).
     Only fires when the filter value actually changes — a normal load must
     leave the persisted camera alone. First run seeds the ref so a page
     opened with a filter already in the URL doesn't yank the view. */
  useEffect(() => {
    if (!mapLoaded || !mapRef.current) return
    const key = `${category || ''}|${chFrom || ''}|${chTo || ''}`
    if (filterFitRef.current === null) { filterFitRef.current = key; return }
    if (filterFitRef.current === key) return
    filterFitRef.current = key
    if (key === '||') return // filters cleared — keep current view
    if (category) return // handled by the reports-fetch effect instead

    // A regional section filter (Calabar/Ogun/Kebbi) owns the camera via the
    // section-fit effect above. The chainage bounds computed below are
    // Coastal-only, so without this they'd drag the view back to Lagos.
    const secRegion = initialSection ? sectionRegion(initialSection) : ''
    if (secRegion === 'calabar' || secRegion === 'ogun' || secRegion === 'kebbi') return

    const map = mapRef.current
    const b = new google.maps.LatLngBounds()
    let points = 0
    const f = chFrom ? Number(chFrom) : NaN, t = chTo ? Number(chTo) : NaN
    if (!isNaN(f) && !isNaN(t) && t > f) {
      coastalStations.filter(s => s.label >= f && s.label <= t).forEach(s => { b.extend({ lat: s.latitude, lng: s.longitude }); points++ })
    }
    if (points === 0) return
    // A single matched point (or a degenerate zero-area bounds) can't be
    // "fit" meaningfully — go straight to a close, deterministic zoom on
    // it instead of leaving fitBounds to guess.
    if (points === 1 || b.getNorthEast().equals(b.getSouthWest())) {
      map.panTo(b.getCenter())
      map.setZoom(16)
    } else {
      map.fitBounds(b, 70)
      google.maps.event.addListenerOnce(map, 'bounds_changed', () => { if ((map.getZoom() ?? 0) > 16) map.setZoom(16) })
    }
  }, [mapLoaded, category, chFrom, chTo, coastalStations, initialSection])

  /* ── Render ───────────────────────────────────────────────── */
  const legendItems = colorBy === 'category' ? Object.entries(CAT_COLORS) : Object.entries(STATUS_COLORS)
  const busy = reportsLoading || assetsRefreshing

  const LAYER_CHIPS: { k: MapLayerKey; label: string }[] = [
    { k: 'coastalLine', label: 'Road line' },
    { k: 'reports',     label: 'Reports' },
    { k: 'calabar',     label: 'Calabar' },
    { k: 'ogun',        label: 'Ogun' },
    { k: 'kebbi',       label: 'Kebbi' },
    { k: 'design',      label: 'Design' },
  ]

  return (
    <div style={{ position: 'relative', width: '100%' }}>

      {/* Controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, color: D.muted, fontFamily: 'var(--font-mono)', letterSpacing: 1 }}>LAYERS</span>
        {LAYER_CHIPS.map(({ k, label }) => (
          <button key={k} onClick={() => toggleLayer(k)} style={{
            background: layers[k] ? D.amber : 'transparent',
            color: layers[k] ? '#000' : D.muted,
            border: `1px solid ${layers[k] ? D.amber : D.sub}`,
            borderRadius: 5, padding: '4px 12px', fontSize: 11, cursor: 'pointer',
            fontFamily: 'var(--font-mono)', letterSpacing: 0.5, textTransform: 'uppercase',
            transition: 'all 0.2s', boxShadow: layers[k] ? SH_RAISED : 'none',
          }}>{label}</button>
        ))}

        <span style={{ width: 1, height: 18, background: D.sub, margin: '0 2px' }} />
        <span style={{ fontSize: 11, color: D.muted, fontFamily: 'var(--font-mono)', letterSpacing: 1 }}>COLOR</span>
        {(['category', 'status'] as const).map(opt => (
          <button key={opt} onClick={() => setColorBy(opt)} style={{
            background: colorBy === opt ? D.amber : 'transparent',
            color: colorBy === opt ? '#000' : D.muted,
            border: `1px solid ${colorBy === opt ? D.amber : D.sub}`,
            borderRadius: 5, padding: '4px 12px', fontSize: 11, cursor: 'pointer',
            fontFamily: 'var(--font-mono)', letterSpacing: 0.5, textTransform: 'uppercase',
            transition: 'all 0.2s', boxShadow: colorBy === opt ? SH_RAISED : 'none',
          }}>{opt}</button>
        ))}
        {designLoading && <span style={{ fontSize: 10, color: D.amber, fontFamily: 'var(--font-mono)' }}>· loading design…</span>}

        {chFrom && chTo && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: `${D.amber}15`, border: `1px solid ${D.amber}44`, borderRadius: 5, padding: '4px 10px' }}>
            <span style={{ fontSize: 10, color: D.amber, fontFamily: 'var(--font-mono)', letterSpacing: 0.5 }}>
              CH {Number(chFrom).toLocaleString()} → {Number(chTo).toLocaleString()}
            </span>
          </div>
        )}

        <span style={{ marginLeft: 'auto', fontSize: 11, color: D.sub, fontFamily: 'var(--font-mono)', display: 'flex', alignItems: 'center', gap: 8 }}>
          {visibleReportCount.toLocaleString()} reports · {assetClusters.length.toLocaleString()} asset points
          {busy && <span style={{ color: D.amber }}>· refining…</span>}
        </span>
      </div>

      {/* Map */}
      <div className="unified-map-frame" style={{ position: 'relative', borderRadius: 10, overflow: 'hidden', height: 520, boxShadow: SH_WELL }}>
        <div ref={mapContainer} style={{ width: '100%', height: '100%' }} />

        {!mapLoaded && !error && (
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(33,33,36,0.88)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12, zIndex: 10 }}>
            <div style={{ width: 32, height: 32, border: `3px solid ${D.sub}`, borderTop: `3px solid ${D.amber}`, borderRadius: '50%', animation: 'umSpin 0.8s linear infinite' }} />
            <span style={{ color: D.muted, fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: 1 }}>INITIALISING MAP…</span>
          </div>
        )}

        {error && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(33,33,36,0.95)', color: D.red, fontFamily: 'var(--font-mono)', fontSize: 12, zIndex: 20, textAlign: 'center', padding: 24 }}>
            {error}
          </div>
        )}

        {/* Report popup — top-left */}
        {selReport && (
          <div style={{ position: 'absolute', top: 12, left: 12, zIndex: 20, background: 'rgba(10,8,5,0.96)', border: `1px solid ${catColor(selReport.activity_category)}55`, borderRadius: 10, padding: '14px 16px', minWidth: 240, maxWidth: 300, boxShadow: '0 12px 40px rgba(0,0,0,0.7)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
              <span style={{ fontSize: 10, color: catColor(selReport.activity_category), fontFamily: 'var(--font-mono)', letterSpacing: 1, textTransform: 'uppercase', fontWeight: 700 }}>{selReport.activity_category}</span>
              <button onClick={() => setSelReport(null)} style={{ background: 'none', border: 'none', color: D.sub, cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: 0, marginLeft: 8 }}>✕</button>
            </div>
            <div style={{ fontSize: 13, color: D.text, fontWeight: 600, marginBottom: 8 }}>{selReport.activity_type}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <InfoRow label="Status" value={selReport.activity_status} color={statusColor(selReport.activity_status)} />
              <InfoRow label="Reporter" value={selReport.reporter_name} />
              <InfoRow label="Section" value={selReport.section_name} />
              <InfoRow label="Date" value={selReport.date_of_activity} />
              {selReport.start_chainage != null && <InfoRow label="Chainage" value={`${selReport.start_chainage} → ${selReport.end_chainage}`} />}
            </div>
            {onFilterRequest && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10, paddingTop: 10, borderTop: `1px solid ${D.sub}33` }}>
                <FilterPill
                  label={category === selReport.activity_category ? 'Clear category filter' : `Filter: ${selReport.activity_category}`}
                  active={category === selReport.activity_category}
                  onClick={() => onFilterRequest('category', category === selReport.activity_category ? '' : selReport.activity_category)}
                />
                {selReport.project_name && (
                  <FilterPill
                    label={project === selReport.project_name ? 'Clear project filter' : `Filter: ${selReport.project_name}`}
                    active={project === selReport.project_name}
                    onClick={() => onFilterRequest('project', project === selReport.project_name ? '' : selReport.project_name)}
                  />
                )}
              </div>
            )}
          </div>
        )}

        {/* Asset-cluster popup — bottom-left */}
        {selCell && (
          <div style={{ position: 'absolute', bottom: 12, left: 12, zIndex: 20, background: 'rgba(10,8,5,0.96)', border: `1px solid ${D.blue}55`, borderRadius: 10, padding: '14px 16px', minWidth: 220, maxWidth: 280, boxShadow: '0 12px 40px rgba(0,0,0,0.7)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
              <span style={{ fontSize: 10, color: D.blue, fontFamily: 'var(--font-mono)', letterSpacing: 1, textTransform: 'uppercase', fontWeight: 700 }}>
                {selCell.count === 1 ? 'Asset' : `Cluster of ${selCell.count.toLocaleString()}`}
              </span>
              <button onClick={() => setSelCell(null)} style={{ background: 'none', border: 'none', color: D.sub, cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: 0, marginLeft: 8 }}>✕</button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <InfoRow label="Layer" value={selCell.layer} />
              {selCell.entityType && <InfoRow label="Type" value={selCell.entityType} />}
              {selCell.section && <InfoRow label="Section" value={selCell.section} />}
              {selCell.side && <InfoRow label="Side" value={selCell.side} />}
              {selCell.station && <InfoRow label="Chainage" value={selCell.station} />}
              {selCell.id != null && <InfoRow label="ID" value={selCell.id} />}
              {selCell.count > 1 && <div style={{ fontSize: 10, color: D.sub, fontFamily: 'var(--font-mono)', marginTop: 4 }}>Zoom in for exact positions</div>}
            </div>
            {onFilterRequest && selCell.section && (
              <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${D.sub}33` }}>
                <FilterPill
                  label={initialSection === selCell.section ? 'Clear section filter' : `Filter: ${selCell.section}`}
                  active={initialSection === selCell.section}
                  onClick={() => onFilterRequest('section', initialSection === selCell.section ? '' : selCell.section!)}
                />
              </div>
            )}
          </div>
        )}

        {/* Road-design popup — top-right */}
        {selDesign && (
          <div style={{ position: 'absolute', top: 12, right: 12, zIndex: 20, background: 'rgba(10,8,5,0.96)', border: `1px solid ${selDesign.layer.color}55`, borderRadius: 10, padding: '14px 16px', minWidth: 220, maxWidth: 280, boxShadow: '0 12px 40px rgba(0,0,0,0.7)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
              <span style={{ fontSize: 10, color: selDesign.layer.color, fontFamily: 'var(--font-mono)', letterSpacing: 1, textTransform: 'uppercase', fontWeight: 700 }}>{selDesign.layer.label}</span>
              <button onClick={() => setSelDesign(null)} style={{ background: 'none', border: 'none', color: D.sub, cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: 0, marginLeft: 8 }}>✕</button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <InfoRow label="Entity" value={selDesign.feature.entityName} />
              <InfoRow label="Section" value={selDesign.feature.roadSection} />
              <InfoRow label="Chainage" value={selDesign.feature.chainage} />
              <InfoRow label="Side" value={selDesign.feature.side} />
              <InfoRow label="Status" value={selDesign.feature.status} />
              {selDesign.feature.shapeLength != null && <InfoRow label="Length" value={`${selDesign.feature.shapeLength.toFixed(1)} m`} />}
            </div>
          </div>
        )}
      </div>

      {/* Legend — clickable, PowerBI/ArcGIS-style series toggling. The
         "Road assets" swatch stays non-interactive (that whole layer is
         already toggled by the Calabar/Ogun/Kebbi LAYER_CHIPS above, so a
         second toggle here would be redundant, not complementary). */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 16px', marginTop: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ width: 10, height: 10, borderRadius: '50%', background: D.blue }} />
          <span style={{ fontSize: 10, color: D.muted, fontFamily: 'var(--font-mono)' }}>Road assets (Calabar/Ogun/Kebbi)</span>
        </div>
        {designData && designData.layers.length > 0 && designData.layers.map(l => {
          const hidden = hiddenDesignLayers.has(l.id)
          return (
            <LegendSwatch key={l.id} color={l.color} label={l.label} hidden={hidden}
              onClick={() => setHiddenDesignLayers(prev => {
                const next = new Set(prev)
                next.has(l.id) ? next.delete(l.id) : next.add(l.id)
                return next
              })} />
          )
        })}
        {legendItems.map(([name, color]) => {
          const hiddenSet = colorBy === 'category' ? hiddenCategories : hiddenStatuses
          const setHidden = colorBy === 'category' ? setHiddenCategories : setHiddenStatuses
          const hidden = hiddenSet.has(name)
          return (
            <LegendSwatch key={name} color={color} label={name} hidden={hidden}
              onClick={() => setHidden(prev => {
                const next = new Set(prev)
                next.has(name) ? next.delete(name) : next.add(name)
                return next
              })} />
          )
        })}
      </div>

      <style>{`
        @media (max-width: 640px) { .unified-map-frame { height: 360px !important; } }
        @keyframes umSpin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  )
}

/* Section string (from either taxonomy) → REGION_CAMERA key */
function sectionRegion(section: string): string {
  const s = section.toLowerCase()
  if (s.includes('calabar')) return 'calabar'
  if (s.includes('ogun')) return 'ogun'
  if (s.includes('kebbi')) return 'kebbi'
  if (s.includes('section 1') || s.includes('section 2') || s.includes('section 3')) return 'coastal'
  return 'national'
}

function LegendSwatch({ color, label, hidden, onClick }: { color: string; label: string; hidden: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} title={hidden ? `Show ${label}` : `Hide ${label}`} style={{
      display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', padding: 0,
      cursor: 'pointer', opacity: hidden ? 0.4 : 1, transition: 'opacity 0.15s',
    }}>
      <div style={{ width: 10, height: 10, borderRadius: 2, background: color }} />
      <span style={{ fontSize: 10, color: D.muted, fontFamily: 'var(--font-mono)', textDecoration: hidden ? 'line-through' : 'none' }}>{label}</span>
    </button>
  )
}

function FilterPill({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      background: active ? `${D.amber}22` : 'transparent',
      color: active ? D.amber : D.text,
      border: `1px solid ${active ? D.amber : D.sub}`,
      borderRadius: 5, padding: '3px 9px', fontSize: 10, cursor: 'pointer',
      fontFamily: 'var(--font-mono)', letterSpacing: 0.3,
    }}>{active ? '✕' : '▸'} {label}</button>
  )
}

function InfoRow({ label, value, color }: { label: string; value: string | number | null; color?: string }) {
  if (!value && value !== 0) return null
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
      <span style={{ fontSize: 10, color: D.sub, fontFamily: 'var(--font-mono)', width: 60, flexShrink: 0 }}>{label}</span>
      <span style={{ fontSize: 11, color: color || D.text, fontFamily: 'var(--font-mono)' }}>{String(value)}</span>
    </div>
  )
}
