'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { setOptions, importLibrary } from '@googlemaps/js-api-loader'
import { MarkerClusterer } from '@googlemaps/markerclusterer'
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
  /** From /planning-implementation's section filter — fits that region once
     on mount / when it changes. '' = show everything (national). */
  initialSection?: string
  /** Aggregate road-asset fetch stats, for the planning page's load-time KPI. */
  onLoadStats?: (stats: { queryMs: number; clientMs: number; count: number; mode: 'live' | 'mv' }) => void
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
export default function UnifiedMap({ chFrom, chTo, category, initialSection, onLoadStats }: Props) {
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

  const [designData, setDesignData] = useState<RoadDesignData | null>(null)
  const [designLoading, setDesignLoading] = useState(false)

  const [selReport, setSelReport] = useState<ActivityReport | null>(null)
  const [selDesign, setSelDesign] = useState<{ feature: DesignFeature; layer: DesignLayer } | null>(null)
  const [selCell,   setSelCell]   = useState<AssetCluster | null>(null)

  // Overlay refs (no Mapbox-style setData — clear + rebuild each time)
  const primaryLineRef   = useRef<google.maps.Polyline | null>(null)
  const secondaryLineRef = useRef<google.maps.Polyline | null>(null)
  const highlightLinesRef = useRef<google.maps.Polyline[]>([])
  const tickMarkersRef   = useRef<google.maps.Marker[]>([])
  const reportLinesRef   = useRef<google.maps.Polyline[]>([])
  const reportClustererRef = useRef<MarkerClusterer | null>(null)
  const assetClustererRef  = useRef<MarkerClusterer | null>(null)
  const designLinesRef   = useRef<google.maps.Polyline[]>([])

  const mapReqKeyRef    = useRef<string>('')
  const kebbiFetchedRef = useRef(false)
  const designReqKeyRef = useRef<string>('')
  const lastFocusRef    = useRef<number | string | null>(null)
  const lastSectionFitRef = useRef<string | null>(null)
  const filterFitRef    = useRef<string | null>(null)

  const bbox = (v: ViewState | null) =>
    v && v.zoom >= 12
      ? { swLat: v.swLat, swLng: v.swLng, neLat: v.neLat, neLng: v.neLng }
      : null

  /* ── Fetch: Coastal stations + ALL reports (one call) ────────
     all=1 returns every project's reports, so Calabar/Kebbi/Ogun pins come
     down alongside Coastal's. Stations still scoped to Coastal Road. Skipped
     entirely when neither the road-line nor the reports layer is on. */
  useEffect(() => {
    if (!layers.coastalLine && !layers.reports) { setReports([]); setCoastalStations([]); setReportsLoading(false); return }
    const b = bbox(viewState)
    const key = `${layers.reports}|${category || ''}|${viewState?.zoom ?? ''}|${b ? `${b.swLat.toFixed(2)},${b.swLng.toFixed(2)},${b.neLat.toFixed(2)},${b.neLng.toFixed(2)}` : 'wide'}`
    if (mapReqKeyRef.current === key) return
    mapReqKeyRef.current = key

    const p = new URLSearchParams({ project: COASTAL_PROJECT, all: '1' })
    if (category) p.set('category', category)
    if (viewState) p.set('zoom', String(viewState.zoom))
    if (b) { p.set('swLat', String(b.swLat)); p.set('swLng', String(b.swLng)); p.set('neLat', String(b.neLat)); p.set('neLng', String(b.neLng)) }

    setReportsLoading(true)
    fetch(`/api/map?${p.toString()}`)
      .then(r => r.json())
      .then(d => {
        setCoastalStations(d.stations ?? [])
        setReports(d.reports ?? [])
      })
      .catch(() => setError('Failed to load map data'))
      .finally(() => setReportsLoading(false))
  }, [layers.coastalLine, layers.reports, category, viewState])

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

          const endTooFar = endLat != null && endLng != null && !isNaN(endLat) && !isNaN(endLng)
            && Math.hypot(endLng - startLng, endLat - startLat) > 0.05
          const samePoint = endLat == null || endLng == null || (startLat === endLat && startLng === endLng) || endTooFar
          const color = colorFor(r)

          if (samePoint) {
            const m = new google.maps.Marker({
              position: { lat: startLat, lng: startLng },
              icon: { path: google.maps.SymbolPath.CIRCLE, fillColor: color, fillOpacity: 0.9, strokeColor: 'rgba(0,0,0,0.6)', strokeWeight: 2, scale: 7 },
              zIndex: 5,
            })
            m.addListener('click', () => { setSelReport(r); setSelCell(null); setSelDesign(null) })
            markers.push(m)
          } else {
            const line = new google.maps.Polyline({
              path: [{ lat: startLat, lng: startLng }, { lat: endLat!, lng: endLng! }],
              strokeColor: color, strokeOpacity: 0.85, strokeWeight: 6, clickable: true, zIndex: 4, map,
            })
            line.addListener('click', () => { setSelReport(r); setSelCell(null); setSelDesign(null) })
            lines.push(line)
          }
        })
      reportLinesRef.current = lines

      if (reportClustererRef.current) {
        reportClustererRef.current.addMarkers(markers)
      } else {
        reportClustererRef.current = new MarkerClusterer({
          map, markers,
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
      }
    }
  }, [mapLoaded, coastalStations, kebbiStations, reports, colorBy, category, chFrom, chTo, layers.coastalLine, layers.reports, layers.kebbi])

  /* ── Render: road-asset clusters ──────────────────────────── */
  useEffect(() => {
    if (!mapLoaded || !mapRef.current) return
    const map = mapRef.current
    assetClustererRef.current?.clearMarkers()

    const markers = assetClusters.map(c => {
      const single = c.count === 1 && c.id != null
      const m = new google.maps.Marker({
        position: { lat: c.lat, lng: c.lng },
        icon: { path: google.maps.SymbolPath.CIRCLE, fillColor: single ? D.green : D.blue, fillOpacity: 0.85, strokeColor: 'rgba(0,0,0,0.55)', strokeWeight: 2, scale: single ? 6 : 8 },
        zIndex: single ? 400 : 90,
      })
      m.addListener('click', () => { setSelCell(c); setSelReport(null); setSelDesign(null) })
      return m
    })

    if (assetClustererRef.current) {
      assetClustererRef.current.addMarkers(markers)
    } else {
      assetClustererRef.current = new MarkerClusterer({
        map, markers,
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
    }
  }, [mapLoaded, assetClusters])

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
  }, [mapLoaded, designData, layers.design])

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

  /* ── Fit to an active chainage / category filter (dashboard) ───────────
     Only when the filter value actually changes — a normal load must leave
     the persisted camera alone. First run seeds the ref so a page opened
     with a filter already in the URL doesn't yank the view. */
  useEffect(() => {
    if (!mapLoaded || !mapRef.current) return
    const key = `${category || ''}|${chFrom || ''}|${chTo || ''}`
    if (filterFitRef.current === null) { filterFitRef.current = key; return }
    if (filterFitRef.current === key) return
    filterFitRef.current = key
    if (key === '||') return // filters cleared — keep current view

    // A regional section filter (Calabar/Ogun/Kebbi) owns the camera via the
    // section-fit effect above. The category / chainage bounds computed below
    // are Coastal-only, so without this they'd drag the view back to Lagos.
    const secRegion = initialSection ? sectionRegion(initialSection) : ''
    if (secRegion === 'calabar' || secRegion === 'ogun' || secRegion === 'kebbi') return

    const map = mapRef.current
    const b = new google.maps.LatLngBounds()
    let has = false
    if (category) {
      reports.forEach(r => {
        if (regionOf(r) !== 'reports') return
        const lat = r.start_chainage_lat ? parseFloat(r.start_chainage_lat) : NaN
        const lng = r.start_chainage_long ? parseFloat(r.start_chainage_long) : NaN
        if (!isNaN(lat) && !isNaN(lng)) { b.extend({ lat, lng }); has = true }
      })
    } else {
      const f = chFrom ? Number(chFrom) : NaN, t = chTo ? Number(chTo) : NaN
      if (!isNaN(f) && !isNaN(t) && t > f) {
        coastalStations.filter(s => s.label >= f && s.label <= t).forEach(s => { b.extend({ lat: s.latitude, lng: s.longitude }); has = true })
      }
    }
    if (has) {
      map.fitBounds(b, 70)
      google.maps.event.addListenerOnce(map, 'bounds_changed', () => { if ((map.getZoom() ?? 0) > 16) map.setZoom(16) })
    }
  }, [mapLoaded, category, chFrom, chTo, reports, coastalStations, initialSection])

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
          {reports.length} reports · {assetClusters.length.toLocaleString()} asset points
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

      {/* Legend */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 16px', marginTop: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ width: 10, height: 10, borderRadius: '50%', background: D.blue }} />
          <span style={{ fontSize: 10, color: D.muted, fontFamily: 'var(--font-mono)' }}>Road assets (Calabar/Ogun/Kebbi)</span>
        </div>
        {designData && designData.layers.length > 0 && designData.layers.map(l => (
          <div key={l.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 10, height: 10, borderRadius: 2, background: l.color }} />
            <span style={{ fontSize: 10, color: D.muted, fontFamily: 'var(--font-mono)' }}>{l.label}</span>
          </div>
        ))}
        {legendItems.map(([name, color]) => (
          <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 10, height: 10, borderRadius: 2, background: color }} />
            <span style={{ fontSize: 10, color: D.muted, fontFamily: 'var(--font-mono)' }}>{name}</span>
          </div>
        ))}
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

function InfoRow({ label, value, color }: { label: string; value: string | number | null; color?: string }) {
  if (!value && value !== 0) return null
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
      <span style={{ fontSize: 10, color: D.sub, fontFamily: 'var(--font-mono)', width: 60, flexShrink: 0 }}>{label}</span>
      <span style={{ fontSize: 11, color: color || D.text, fontFamily: 'var(--font-mono)' }}>{String(value)}</span>
    </div>
  )
}
