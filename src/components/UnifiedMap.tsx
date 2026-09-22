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

// A broad filter (e.g. one category) can still match thousands of reports
// spread nationwide — attaching that many individual markers, even chunked
// across frames (see attachOverlaysChunked below), is a real, visible cost
// and a noisy "wall of dots" nobody can actually read. Below this many
// matches, skip clustering entirely so every point is its own clickable
// pin with full detail on click (small enough that showing them all is
// cheap and genuinely useful). At or above it, use the real clusterer —
// a fast, well-optimized overview with hover-tooltip cluster bubbles that
// naturally break apart into individual pins as the user zooms in or
// clicks a cluster, or narrows the filter further. See the 2026-09-22
// changelog entry for the full reasoning (a direct user ask to fix map
// slowness by making broad filters show a clustered overview instead of
// exploding into every matching point at once).
const INDIVIDUAL_PIN_THRESHOLD = 40

// nearestStation()'s binary search always returns the closest-by-label
// station in whatever set it's given — with no cap, a report whose real
// chainage sits nowhere near the current (possibly viewport-narrowed) set
// still "resolves" to that set's nearest edge station, placing it exactly
// there regardless of how far away it actually is. Harmless while the
// station set always spans nearly the whole road (the old, pre-viewport-
// filter default), but once stations correctly narrow to match a tight
// zoomed-in bbox (2026-09-22 (10) changelog), every report whose chainage
// falls outside that narrow range collapses onto the same one or two
// boundary points — which, being drawn from that exact bbox's own station
// query, sit inside the current viewport by construction, so they pass the
// geographic viewport filter and inflate the shown count back toward the
// unfiltered total instead of correctly narrowing it. 3000m is generous
// against the coarsest real sampling gap (map_chainage_line's 1000m tier,
// intervalForZoom() in src/app/api/map/route.ts) while still rejecting
// genuinely out-of-range chainage values, which in the confirmed live
// reproduction were routinely tens of kilometres past the nearest station.
const MAX_STATION_SNAP_DISTANCE_M = 3000

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

// A tiny bit of metadata stashed directly on a marker instance so a cluster
// renderer (which only ever receives the raw google.maps.Marker objects
// grouped into that cluster) can build a real summary tooltip without a
// second lookup structure — see INDIVIDUAL_PIN_THRESHOLD's comment above.
type MarkerWithMeta = google.maps.Marker & { __cat?: string }

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
  /** Show the Calabar/Ogun/Kebbi road_assets layer (fetch, render, layer
     chips, legend swatch) at all. Defaults to true — /planning-implementation
     needs it, that page's whole purpose is combining road_assets with the
     planning breakdown. /dashboard passes false: a real point-resolution
     bug in that layer's own server-side clustering (2026-09-22 (3)
     changelog) made it confusing there, and the direct ask was to keep
     that page showing only activity reports for clarity — see the
     2026-09-22 (4) entry. */
  showRoadAssets?: boolean
}

setOptions({ key: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || '', v: 'weekly' })

const regionOf = (r: { project_name?: string | null; section_name?: string | null }): MapLayerKey => {
  const s = `${r.section_name || ''} ${r.project_name || ''}`.toLowerCase()
  if (s.includes('calabar')) return 'calabar'
  if (s.includes('ogun'))    return 'ogun'
  if (s.includes('kebbi') || s.includes('sokoto')) return 'kebbi'
  return 'reports'
}

// Attaching (or detaching) hundreds-to-thousands of legacy Marker/Polyline
// instances to a map in one synchronous loop (via setMap()) blocks the main
// thread long enough to trigger a real browser "Page Unresponsive" dialog —
// confirmed live twice: once on a filtered view with ~1,800 report pins
// plus up to a few thousand road-asset pins attaching in the same tick (see
// the 2026-09-21 (5) changelog entry, markers only), and again on the plain
// *unfiltered* default view, which draws one Polyline per report with no
// chunking at all — measured a genuine 2.77s blocked main-thread task
// attaching ~3,860 lines synchronously (2026-09-22 (2) changelog entry).
// Generic over anything with a `setMap()` (both Marker and Polyline satisfy
// this) so one helper covers both overlay kinds. Spread the work across
// animation frames instead of doing less of it — for markers specifically,
// "individual pin per record" is the whole point of that rendering mode
// once it's chosen; the fix is to do the same amount of work without
// blocking. `isStale()` lets a newer effect run abort an in-flight chunked
// attachment from a previous, now-outdated pass (checked every frame, not
// just once).
function attachOverlaysChunked<T extends { setMap(map: google.maps.Map | null): void }>(
  overlays: T[], map: google.maps.Map | null, isStale: () => boolean, chunkSize = 120,
) {
  let i = 0
  const step = () => {
    if (isStale()) return
    const end = Math.min(i + chunkSize, overlays.length)
    for (; i < end; i++) overlays[i].setMap(map)
    if (i < overlays.length) requestAnimationFrame(step)
  }
  step()
}

/* ── Component ─────────────────────────────────────────────── */
export default function UnifiedMap({ chFrom, chTo, category, project, weather, initialSection, onLoadStats, onFilterRequest, showRoadAssets = true }: Props) {
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

  // The report a table row's click most recently focused — see the focus-
  // request effect below. Unlike focusRequest itself (consumed/cleared the
  // instant the camera moves), this persists so the render effect can keep
  // giving that one report a dedicated, unmistakable marker no matter how
  // many other reports happen to be nearby (2026-09-22 (8) changelog — a
  // focused report could otherwise render as one line among several other
  // unrelated reports' lines, or get folded into a grid-bucket bubble
  // representing thousands of other, unrelated reports).
  const [focusedId, setFocusedId] = useState<number | null>(null)

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
  // Markers attached directly to the map (bypassing MarkerClusterer) while a
  // filter is active — see the big comment where these are set for why.
  const directReportMarkersRef = useRef<google.maps.Marker[]>([])
  // Bumped every time the direct-attach path runs; a chunked attachment
  // loop captures its own value and aborts once it no longer matches,
  // so a superseded (filter changed again, or effect re-ran) in-flight
  // attachment can never keep drawing over a newer one — see
  // attachOverlaysChunked above.
  const reportAttachGenRef = useRef(0)
  const assetClustererRef  = useRef<MarkerClusterer | null>(null)
  const directAssetMarkersRef = useRef<google.maps.Marker[]>([])
  const assetAttachGenRef = useRef(0)
  // Same chunked-attach treatment for the unfiltered view's report-extent
  // Polylines (see the 2026-09-22 (2) changelog entry — up to ~3,860 lines
  // measured a genuine 2.77s blocked task attached synchronously before
  // this existed).
  const reportLineAttachGenRef = useRef(0)
  const designLinesRef   = useRef<google.maps.Polyline[]>([])
  // The one dedicated marker for whichever report is currently `focusedId`
  // (a table-row click) — always attached directly, never bucketed/clustered
  // or drawn as a line, regardless of how many other reports are nearby.
  const focusedMarkerRef = useRef<google.maps.Marker | null>(null)

  const mapReqKeyRef    = useRef<string>('')
  // Bumped on every /api/map request this effect issues (one per distinct
  // zoom/pan step during a real zoom gesture, since reports aren't bbox-
  // scoped server-side — every step still re-requests the full matching
  // set). Reports/stations aren't bbox-scoped in content, but STATIONS are
  // sampled at a resolution/extent tied to whichever bbox that specific
  // request asked for — so an older, in-flight request that resolves AFTER
  // a newer one (a real, observed race under rapid zooming, not a
  // hypothetical) can silently overwrite the correct current station set
  // with one scoped to a stale, wider or differently-positioned viewport.
  // Confirmed live (2026-09-22 (10) changelog): nearestStation() always
  // snaps to the *closest available* station regardless of true distance,
  // so a stale, coarser station set can make thousands of genuinely
  // far-away reports resolve onto whichever boundary station lands near
  // the CURRENT viewport — inflating the shown count back toward the full
  // unfiltered total instead of narrowing it. Only the response matching
  // the latest-issued request may ever call setReports/setCoastalStations.
  const mapFetchGenRef  = useRef(0)
  const kebbiFetchedRef = useRef(false)
  const designReqKeyRef = useRef<string>('')
  const designLineAttachGenRef = useRef(0)
  const lastFocusRef    = useRef<number | string | null>(null)
  // True once the map has fired its own first real 'idle' — a genuinely
  // later signal than mapRef.current/mapLoaded, both of which are set
  // synchronously the instant `new google.maps.Map(...)` returns, before
  // the browser has painted the container or Google has computed a
  // projection. Confirmed live (2026-09-22 (10) changelog): calling
  // fitBounds()/panTo() that early is a real, silent no-op — a fresh
  // ?category=Earthworks load logged the fit call actually firing (correct
  // bounds, no errors) yet the camera never visually moved once across 15
  // full seconds of observation. Every programmatic camera-fit call site in
  // this file should gate on this, not just mapRef.current.
  const mapReadyRef     = useRef(false)
  const lastSectionFitRef = useRef<string | null>(null)
  const filterFitRef    = useRef<string | null>(null)
  const catFitRef       = useRef<string | null>(null)
  // Set just before any *programmatic* camera move (a filter/section/report
  // fit — panTo/fitBounds/setZoom/setCenter called from code, not the user
  // dragging/scrolling). The map's own 'idle' listener always fires after
  // one of these too, so without this flag every such fit would get written
  // to the persisted camera in localStorage exactly like a manual pan would.
  // That's what caused a real reported bug: applying (or ever having
  // applied) a category/project/weather/chainage filter, or clicking a
  // report row, permanently overwrote the persisted view with that tight
  // filtered zoom — so a *later*, completely unfiltered page load (or the
  // same session after clearing the filter) silently restored that stale
  // close-up instead of the user's actual last manual view. The flag lets
  // the map visually move (panTo/fitBounds are unaffected) while the 'idle'
  // handler skips persisting just that one settle.
  const programmaticMoveRef = useRef(false)

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
    const key = `${layers.reports}|${category || ''}|${project || ''}|${weather || ''}|${initialSection || ''}|${viewState?.zoom ?? ''}|${b ? `${b.swLat.toFixed(2)},${b.swLng.toFixed(2)},${b.neLat.toFixed(2)},${b.neLng.toFixed(2)}` : 'wide'}`
    if (mapReqKeyRef.current === key) return
    mapReqKeyRef.current = key

    const p = new URLSearchParams({ project: project || COASTAL_PROJECT })
    if (!project) p.set('all', '1')
    if (category) p.set('category', category)
    if (weather) p.set('weather', weather)
    // Never actually wired in before (2026-09-22 (5) changelog): the
    // dashboard's Section dropdown never narrowed the map's own reports at
    // all, so e.g. "Section 1-A" still fetched (and grid-bucketed) every
    // Coastal report instead of that section's real, much smaller set.
    if (initialSection) p.set('section', initialSection)
    if (viewState) p.set('zoom', String(viewState.zoom))
    if (b) { p.set('swLat', String(b.swLat)); p.set('swLng', String(b.swLng)); p.set('neLat', String(b.neLat)); p.set('neLng', String(b.neLng)) }

    setReportsLoading(true)
    const gen = ++mapFetchGenRef.current
    fetch(`/api/map?${p.toString()}`)
      .then(r => r.json())
      .then(d => {
        // A newer request has been issued since this one went out — this
        // response is stale (an out-of-order resolution, not a hypothetical
        // — see mapFetchGenRef's comment) and must never touch state.
        if (mapFetchGenRef.current !== gen) return

        // Never let an EMPTY station response clobber an already-loaded,
        // non-empty one — see the 2026-09-22 (9) changelog entry. Stations
        // are bbox-scoped once zoomed in (map_chainage_line's own
        // viewport gate), and report positions are resolved by SNAPPING
        // to this same station set (nearestStation, both in the render
        // effect and the viewport-filter above it) — not just for drawing
        // the visible road line. If a fit-to-filter camera lands its
        // center even slightly off the true road alignment, a tight
        // enough zoom's bbox can miss every sampled station entirely
        // (confirmed live: a Section 1-B zoom sequence's station count
        // went 125 → 63 → 0 across three narrowing bboxes, not a gradual
        // decline to a genuinely sparse-but-real result) — and since
        // nearestStation() over an EMPTY set resolves nothing, EVERY
        // report that depends on chainage-snapping (effectively all of
        // them) loses its position and gets dropped, which is what made
        // "the report markers ... display for a few seconds then vanish."
        // Stations are static survey data, so keeping the last known-good
        // set as a fallback is always safe — it's never stale in a way
        // that matters, only occasionally missing a station or two right
        // at the tightest zoom's edge.
        setCoastalStations(prev => (d.stations && d.stations.length > 0) ? d.stations : prev)
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
        // The map's own async init (loading the Maps JS API, constructing
        // the google.maps.Map instance) can genuinely still be in flight
        // when this fetch's response lands — confirmed live (2026-09-22
        // (10) changelog): a fresh ?category=Earthworks load never fit the
        // camera at all, ever, across 15 full seconds of observation, with
        // zero errors and correct data arriving in under a second. Bail
        // BEFORE touching catFitRef when that's the case, so this filterKey
        // isn't marked "already handled" — a later, actually map-ready
        // response gets a real chance to perform the fit instead of losing
        // it permanently to a race the user can't see or retry.
        if (!mapRef.current) return
        const filterKey = `${category || ''}|${project || ''}|${weather || ''}|${initialSection || ''}`
        const hasFilter = !!category || !!project || !!weather || !!initialSection
        if (catFitRef.current === null) {
          catFitRef.current = filterKey
          if (!hasFilter) return
        } else {
          if (catFitRef.current === filterKey) return
          catFitRef.current = filterKey
        }
        if (!hasFilter) return
        const secRegion = initialSection ? sectionRegion(initialSection) : ''
        if (secRegion === 'calabar' || secRegion === 'ogun' || secRegion === 'kebbi') return

        // Actually applying the fit is pulled into its own function so it
        // can be deferred to the map's first real 'idle' rather than always
        // run synchronously here — see mapReadyRef's comment. mapRef.current
        // is re-read inside (not closed over as `map` at the call site)
        // since a deferred call runs later, after this outer callback has
        // already returned.
        const applyFit = () => {
          const map = mapRef.current
          if (!map) return

          // Resolve each report's position the SAME way the render effect
          // does (nearest-chainage-station snap for Coastal reports, raw
          // GPS only as a fallback) — not raw start_chainage_lat/long
          // directly. That field is known-unreliable at scale (2026-07-22
          // changelog: a single stuck/cached GPS value is reused across
          // thousands of reports spanning completely different chainages)
          // — computing bounds from it can pull the fit toward a location
          // that has nothing to do with where the pins actually render.
          // Sorted once, binary-searched per report — same fix, same
          // reason as the render effect's nearestStation (see its
          // comment).
          const sortedStationsForFit = [...(d.stations ?? []) as Station[]].sort((a, b) => a.label - b.label)
          const nearestStationForFit = (targetLabel: number): Station | undefined => {
            if (sortedStationsForFit.length === 0) return undefined
            let lo = 0, hi = sortedStationsForFit.length - 1
            while (lo < hi) {
              const mid = (lo + hi) >> 1
              if (sortedStationsForFit[mid].label < targetLabel) lo = mid + 1
              else hi = mid
            }
            const nearest = (lo > 0 && Math.abs(sortedStationsForFit[lo - 1].label - targetLabel) <= Math.abs(sortedStationsForFit[lo].label - targetLabel))
              ? sortedStationsForFit[lo - 1] : sortedStationsForFit[lo]
            // See MAX_STATION_SNAP_DISTANCE_M's comment — same guard as the
            // render effect's nearestStation, so a too-far match can't pull
            // the camera-fit bounds toward a boundary station either.
            return Math.abs(nearest.label - targetLabel) <= MAX_STATION_SNAP_DISTANCE_M ? nearest : undefined
          }
          const chainageNumForFit = (val?: number | null, text?: number | null): number | null => {
            if (val != null && !isNaN(val)) return val
            if (text != null) { const n = Number(String(text).replace('+', '')); if (!isNaN(n)) return n }
            return null
          }

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
          programmaticMoveRef.current = true
          if (points === 1 || b.getNorthEast().equals(b.getSouthWest())) {
            map.panTo(b.getCenter())
            map.setZoom(16)
          } else {
            map.fitBounds(b, 70)
            google.maps.event.addListenerOnce(map, 'bounds_changed', () => { if ((map.getZoom() ?? 0) > 16) map.setZoom(16) })
          }
        }

        if (mapReadyRef.current) applyFit()
        else google.maps.event.addListenerOnce(mapRef.current, 'idle', applyFit)
      })
      .catch(() => { if (mapFetchGenRef.current === gen) setError('Failed to load map data') })
      .finally(() => { if (mapFetchGenRef.current === gen) setReportsLoading(false) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layers.coastalLine, layers.reports, category, project, weather, initialSection, viewState])

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
    if (!showRoadAssets) { setAssetClusters([]); return }
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
  }, [showRoadAssets, layers.calabar, layers.ogun, layers.kebbi, viewState])

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

      localMap.addListener('click', () => { setSelReport(null); setSelDesign(null); setSelCell(null); setFocusedId(null) })
      localMap.addListener('idle', () => {
        mapReadyRef.current = true
        const b = localMap.getBounds()
        if (!b) return
        const sw = b.getSouthWest(), ne = b.getNorthEast()
        const c = localMap.getCenter()
        const z = localMap.getZoom() ?? start.zoom
        setViewState({ zoom: z, swLat: sw.lat(), swLng: sw.lng(), neLat: ne.lat(), neLng: ne.lng() })
        // A programmatic fit (filter/section/report-focus) still needs
        // viewState updated above (bbox-scoped fetches depend on it), but
        // must NOT overwrite the persisted "last manual view" camera — see
        // programmaticMoveRef's comment above.
        if (programmaticMoveRef.current) { programmaticMoveRef.current = false; return }
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
    if (cam) { programmaticMoveRef.current = true; mapRef.current.setCenter({ lat: cam.lat, lng: cam.lng }); mapRef.current.setZoom(cam.zoom) }
  }, [mapLoaded, initialSection])

  /* ── Render: Coastal line, ticks, highlight, report pins ───── */
  useEffect(() => {
    if (!mapLoaded || !mapRef.current) return
    const map = mapRef.current

    primaryLineRef.current?.setMap(null)
    secondaryLineRef.current?.setMap(null)
    highlightLinesRef.current.forEach(l => l.setMap(null)); highlightLinesRef.current = []
    tickMarkersRef.current.forEach(m => m.setMap(null)); tickMarkersRef.current = []
    // Chunked, not a plain forEach — the unfiltered view can hold thousands
    // of these (see attachOverlaysChunked's comment). Never aborted, same
    // reasoning as every other detach call in this file: removing overlays
    // nobody references anymore is always safe regardless of what starts
    // afterward.
    attachOverlaysChunked(reportLinesRef.current, null, () => false)
    reportLinesRef.current = []
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

    // Sorted once per effect run (not per report) so nearestStation can
    // binary-search instead of scanning every station for every report.
    // Measured live via profiling: the old O(reports × stations) linear
    // scan cost ~750ms per render pass at 1,793 filtered reports — the
    // real bottleneck behind "very slow to render" once markers actually
    // started rendering (2026-09-21 (5) changelog) — this measured under
    // 5ms for the same input.
    const sortedStations = [...coastalStations].sort((a, b) => a.label - b.label)
    const nearestStation = (targetLabel: number): Station | undefined => {
      if (sortedStations.length === 0) return undefined
      let lo = 0, hi = sortedStations.length - 1
      while (lo < hi) {
        const mid = (lo + hi) >> 1
        if (sortedStations[mid].label < targetLabel) lo = mid + 1
        else hi = mid
      }
      const nearest = (lo > 0 && Math.abs(sortedStations[lo - 1].label - targetLabel) <= Math.abs(sortedStations[lo].label - targetLabel))
        ? sortedStations[lo - 1] : sortedStations[lo]
      // See MAX_STATION_SNAP_DISTANCE_M's comment — refuse a match that's
      // too far by chainage to be a real snap, rather than silently
      // placing the report at whatever edge station happens to be closest.
      return Math.abs(nearest.label - targetLabel) <= MAX_STATION_SNAP_DISTANCE_M ? nearest : undefined
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
      // narrow which reports actually render — but "narrow" can still mean
      // thousands of reports spread nationwide (a broad category), which
      // is exactly what made the map slow (2026-09-22 changelog): dumping
      // every one of those onto the map as its own marker, even chunked
      // (2026-09-21 (5) entry), is still a real cost and an unreadable
      // wall of dots. `hasActiveFilter` here only decides the point-vs-line
      // rendering shape below and feeds the individual-vs-clustered
      // decision further down (which additionally checks the real matched
      // count against INDIVIDUAL_PIN_THRESHOLD).
      const chF = chFrom ? Number(chFrom) : NaN
      const chT = chTo ? Number(chTo) : NaN
      const chActive = !isNaN(chF) && !isNaN(chT) && chT > chF
      const hasActiveFilter = !!category || !!project || !!weather || chActive

      // Measured live via a real CPU profile (2026-09-22 (2) changelog
      // entry): chunking each setMap() call keeps *my own* JS fast, but
      // Google Maps' own internal engine still does real, expensive
      // per-overlay bookkeeping in response — ~4-5s of self-time showed up
      // inside Google's own main.js bundle for the plain unfiltered view
      // (~9,700 reports), and switching those from Polylines to Markers
      // (chunked-attached, then handed to MarkerClusterer) barely moved
      // the number. Root cause: MarkerClusterer.renderClusters() itself
      // calls setMap(null) on every non-representative marker in a
      // cluster in one uninterruptible synchronous loop — so the cost
      // scales with the *raw* marker count fed into the clusterer, not
      // the small number of bubbles it ends up showing. Chunking can't
      // reach inside the library's own loop, and neither construction nor
      // individual setMap() calls were ever the actual bottleneck (both
      // measured under 0.2ms each) — the only real fix is to never
      // construct that many Marker objects in the first place.
      //
      // Past this many CANDIDATES, pre-aggregate into a small number of
      // grid-cell buckets *before* constructing any markers at all (see
      // the bucketing block below) — MarkerClusterer (or the
      // individual-pin path) then only ever has to handle a few dozen to
      // a few hundred real Marker objects regardless of how many
      // thousands of underlying reports there are.
      //
      // "Candidates" is deliberately NOT reports.length (2026-09-22 (6)
      // changelog entry — a real bug, not a tuning tweak): a Section
      // filter like "Section 1-B" can still match thousands of reports
      // total, and this effect never had `viewState` in its own dependency
      // array, so panning/zooming never re-ran it at all — the same one
      // big bucket sat there however far the user zoomed in. Fixed in two
      // parts: (1) `viewState` is now a dependency of this effect (see the
      // bottom of the file), so a pan/zoom genuinely re-buckets; (2) once
      // zoomed in past the same zoom>=12 threshold this file already uses
      // for viewport-scoped queries elsewhere, candidates are first
      // filtered to a padded version of the current viewport — so the
      // bucket-vs-individual decision reflects what's actually on screen,
      // not the whole filtered dataset. A user who zooms in on one small
      // stretch of a busy section now sees that stretch's real (small)
      // count, which — once under the threshold below — renders as real
      // individual pins, exactly as the overview→detail design intends.
      const vzoom = viewState?.zoom ?? null
      const useViewportFilter = vzoom !== null && vzoom >= 12 && !!viewState
      let vb: { swLat: number; swLng: number; neLat: number; neLng: number } | null = null
      if (useViewportFilter && viewState) {
        const latPad = (viewState.neLat - viewState.swLat) * 0.25
        const lngPad = (viewState.neLng - viewState.swLng) * 0.25
        vb = {
          swLat: viewState.swLat - latPad, neLat: viewState.neLat + latPad,
          swLng: viewState.swLng - lngPad, neLng: viewState.neLng + lngPad,
        }
      }

      interface Candidate { r: ActivityReport; region: ReturnType<typeof regionOf>; startLat: number; startLng: number; endLat?: number; endLng?: number }
      const candidates: Candidate[] = []
      // Pulled out of the normal candidate flow entirely (never bucketed,
      // never drawn as a line, never viewport-filtered out) — see
      // focusedMarkerRef's comment and the dedicated-marker block below.
      let focusedCandidate: { r: ActivityReport; startLat: number; startLng: number } | null = null
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

          if (focusedId != null && r.id === focusedId) {
            focusedCandidate = { r, startLat, startLng }
            return
          }

          if (vb && (startLat < vb.swLat || startLat > vb.neLat || startLng < vb.swLng || startLng > vb.neLng)) return

          candidates.push({ r, region, startLat, startLng, endLat, endLng })
        })

      const useGridBuckets = candidates.length > 300

      interface Bucket { latSum: number; lngSum: number; count: number; cats: Map<string, number> }
      const buckets = useGridBuckets ? new Map<string, Bucket>() : null
      const GRID_SIZE_DEG = 0.4 // ~44km — coarse on purpose; this tier only
        // applies when there are still this many candidates in view at
        // once, and the viewport filter above (plus the fit/zoom effects)
        // narrows the working set — dropping out of this tier — well
        // before a finer grid would matter visually.

      const markers: google.maps.Marker[] = []
      const lines: google.maps.Polyline[] = []
      candidates.forEach(({ r, startLat, startLng, endLat, endLng }) => {
          // Bucket, don't build a Marker at all — see useGridBuckets'
          // comment above for why this has to happen before any Marker
          // object exists, not just before it's shown.
          if (useGridBuckets) {
            const key = `${Math.round(startLat / GRID_SIZE_DEG)},${Math.round(startLng / GRID_SIZE_DEG)}`
            let b = buckets!.get(key)
            if (!b) { b = { latSum: 0, lngSum: 0, count: 0, cats: new Map() }; buckets!.set(key, b) }
            b.latSum += startLat; b.lngSum += startLng; b.count++
            const cat = r.activity_category || 'Other'
            b.cats.set(cat, (b.cats.get(cat) ?? 0) + 1)
            return
          }

          const endTooFar = endLat != null && endLng != null && !isNaN(endLat) && !isNaN(endLng)
            && Math.hypot(endLng - startLng, endLat - startLat) > 0.05
          // While a filter narrows the view, always render a single point
          // per report (ArcGIS/Power BI convention — one dot per record)
          // rather than a line spanning its start→end chainage. The
          // unfiltered default view keeps the extent-line at a moderate
          // report count (useful context for browsing all activity along
          // the road at once).
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
            // Stashed for the cluster renderer's tooltip below — cheaper
            // than re-deriving category breakdowns from report ids per
            // cluster render pass.
            ;(m as MarkerWithMeta).__cat = r.activity_category || 'Other'
            markers.push(m)
          } else {
            // google.maps.Polyline has no native `title`/hover-tooltip
            // support (Marker-only) — lines only ever appear in the
            // unfiltered default view now (see samePoint above), so this is
            // click-only; a custom cursor-following overlay wasn't worth
            // the complexity for the secondary case. Not attached here
            // (`map` deliberately omitted) — the unfiltered view can hold
            // thousands of these, so attachment is chunked below instead
            // of happening synchronously per-line during construction.
            const line = new google.maps.Polyline({
              path: [{ lat: startLat, lng: startLng }, { lat: endLat!, lng: endLng! }],
              strokeColor: color, strokeOpacity: 0.85, strokeWeight: 6, clickable: true, zIndex: 4,
            })
            line.addListener('click', () => { setSelReport(r); setSelCell(null); setSelDesign(null) })
            lines.push(line)
          }
        })

      // Turn each occupied grid cell into exactly one real Marker — the
      // only Marker objects ever constructed for a large unfiltered set,
      // which is the actual fix (see useGridBuckets' comment above).
      if (buckets) {
        for (const b of buckets.values()) {
          const top = [...b.cats.entries()].sort((a, c) => c[1] - a[1]).slice(0, 3)
          const topLine = top.map(([k, v]) => `${k} (${v})`).join(', ') + (b.cats.size > 3 ? ', …' : '')
          const pos = { lat: b.latSum / b.count, lng: b.lngSum / b.count }
          const m = new google.maps.Marker({
            title: `${b.count.toLocaleString()} report${b.count === 1 ? '' : 's'}\n${topLine}\nClick to zoom in`,
            position: pos,
            icon: { path: google.maps.SymbolPath.CIRCLE, fillColor: D.amber, fillOpacity: 0.85, strokeColor: 'rgba(0,0,0,0.5)', strokeWeight: 2, scale: b.count >= 500 ? 22 : b.count >= 100 ? 17 : b.count >= 25 ? 13 : 9 },
            label: { text: String(b.count), color: '#000', fontSize: '10px', fontFamily: 'var(--font-mono)' },
            zIndex: 500 + b.count,
          })
          // A grid bucket isn't one report — clicking it zooms in (like a
          // real cluster bubble) rather than opening a detail popup that
          // wouldn't make sense for hundreds of reports at once.
          m.addListener('click', () => {
            map.panTo(pos)
            map.setZoom(Math.min((map.getZoom() ?? 6) + 3, 14))
          })
          ;(m as MarkerWithMeta).__cat = top[0]?.[0] ?? 'Other'
          markers.push(m)
        }
      }

      reportLinesRef.current = lines
      // In grid-bucket mode `markers.length` is the (small) bucket count,
      // not the real number of matched reports — sum the buckets' own
      // counts instead so the "N reports" readout stays honest.
      setVisibleReportCount((buckets ? [...buckets.values()].reduce((sum, b) => sum + b.count, 0) : markers.length + lines.length) + (focusedCandidate ? 1 : 0))
      {
        const gen = ++reportLineAttachGenRef.current
        attachOverlaysChunked(lines, map, () => reportLineAttachGenRef.current !== gen)
      }

      // Clear whatever was directly attached on the previous pass — chunked
      // too, since detaching thousands of markers synchronously is itself a
      // real cost (see the attach-side comment below and the 2026-09-21 (5)
      // changelog entry). Never aborted by a later generation bump: unlike
      // attaching (where a stale, superseded loop must stop so it can't
      // draw the wrong markers), detaching old markers nobody references
      // anymore is always safe to let run to completion regardless of what
      // starts afterward.
      attachOverlaysChunked(directReportMarkersRef.current, null, () => false)
      directReportMarkersRef.current = []

      // Individual pins only for a genuinely small matched set — see
      // INDIVIDUAL_PIN_THRESHOLD's comment. `@googlemaps/markerclusterer`'s
      // NoopAlgorithm (the old way this was forced for every filter,
      // regardless of count — see the 2026-09-21 (4)/(5) changelog
      // entries) can never actually draw anything at all (its calculate()
      // always reports changed:false, and the library's render() only
      // attaches markers when changed is true/undefined) — not relevant
      // here since NoopAlgorithm is no longer used anywhere in this file,
      // but worth remembering if a future change is tempted to reach for
      // it again for some other "no clustering" case.
      const useIndividual = markers.length > 0 && markers.length <= INDIVIDUAL_PIN_THRESHOLD
      if (useIndividual) {
        if (reportClustererRef.current) {
          reportClustererRef.current.setMap(null)
          reportClustererRef.current = null
        }
        directReportMarkersRef.current = markers
        const gen = ++reportAttachGenRef.current
        attachOverlaysChunked(markers, map, () => reportAttachGenRef.current !== gen)
      } else if (reportClustererRef.current) {
        reportClustererRef.current.clearMarkers()
        reportClustererRef.current.addMarkers(markers)
      } else {
        reportClustererRef.current = new MarkerClusterer({
          map, markers,
          renderer: { render: (cluster) => {
            const { count, position, markers: clusterMarkers } = cluster
            const radius = count >= 500 ? 30 : count >= 100 ? 24 : count >= 25 ? 18 : 14
            // A real "overview with tooltips" — the top few categories in
            // this bubble, not just a bare count — so a broad filter still
            // gives a useful glance before drilling in (click to zoom, or
            // narrow the filter further until it drops under the
            // individual-pin threshold above).
            const counts = new Map<string, number>()
            for (const mk of clusterMarkers as MarkerWithMeta[]) {
              const c = mk.__cat || 'Other'
              counts.set(c, (counts.get(c) ?? 0) + 1)
            }
            const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
            const topLine = top.map(([k, v]) => `${k} (${v})`).join(', ') + (counts.size > 3 ? ', …' : '')
            return new google.maps.Marker({
              position,
              title: `${count.toLocaleString()} reports\n${topLine}\nClick to zoom in`,
              icon: { path: google.maps.SymbolPath.CIRCLE, fillColor: D.amber, fillOpacity: 0.85, strokeColor: 'rgba(0,0,0,0.5)', strokeWeight: 2, scale: radius },
              label: { text: String(count), color: '#000', fontSize: '11px', fontFamily: 'var(--font-mono)' },
              zIndex: 1000 + count,
            })
          } },
        })
      }
      ;(window as any).__debugReportClusterer = reportClustererRef.current

      // The dedicated "you clicked this one" marker — built last so it's
      // never a candidate for bucketing/clustering above, and always drawn
      // regardless of the layer's normal density rules. Old marker cleared
      // unconditionally first (covers focus cleared, report scrolled out of
      // the fetched set, or a different report now focused).
      focusedMarkerRef.current?.setMap(null)
      focusedMarkerRef.current = null
      if (focusedCandidate) {
        const { r: fr, startLat: fLat, startLng: fLng } = focusedCandidate as { r: ActivityReport; startLat: number; startLng: number }
        const fm = new google.maps.Marker({
          position: { lat: fLat, lng: fLng },
          title: `${fr.activity_category} · ${fr.activity_type}\n${fr.activity_status} · ${fr.section_name || fr.project_name}\n(selected)`,
          icon: {
            path: google.maps.SymbolPath.CIRCLE, fillColor: colorFor(fr), fillOpacity: 1,
            strokeColor: '#ffffff', strokeWeight: 3, scale: 11,
          },
          zIndex: 10000,
          map,
        })
        fm.addListener('click', () => { setSelReport(fr); setSelCell(null); setSelDesign(null) })
        focusedMarkerRef.current = fm
      }
    } else {
      setVisibleReportCount(0)
    }
  }, [mapLoaded, coastalStations, kebbiStations, reports, colorBy, category, project, weather, chFrom, chTo, layers.coastalLine, layers.reports, layers.kebbi, hiddenCategories, hiddenStatuses, viewState, focusedId])

  /* ── Render: road-asset clusters ──────────────────────────── */
  useEffect(() => {
    if (!mapLoaded || !mapRef.current) return
    const map = mapRef.current

    // Individual pins only for a genuinely small matched set — same
    // count-based rule as the report pins above, not "any filter is
    // active" (which category/project/weather/chFrom/chTo mostly aren't
    // for this layer anyway — road_assets has no activity_category or
    // project_name column matching the reports side; only initialSection
    // actually narrows which Calabar/Ogun/Kebbi section is fetched). See
    // INDIVIDUAL_PIN_THRESHOLD's comment and the 2026-09-22 changelog
    // entry — a whole-map-consistency tradeoff from 2026-09-17 (6) is
    // superseded here by the same real-count rule the report layer uses.
    const markers = assetClusters.map(c => {
      const single = c.count === 1 && c.id != null
      const m = new google.maps.Marker({
        title: single ? `${c.entityType || 'Asset'} · ${c.section || c.layer}` : `Cluster of ${c.count.toLocaleString()} — ${c.layer}`,
        position: { lat: c.lat, lng: c.lng },
        icon: { path: google.maps.SymbolPath.CIRCLE, fillColor: single ? D.green : D.blue, fillOpacity: 0.85, strokeColor: 'rgba(0,0,0,0.55)', strokeWeight: 2, scale: single ? 6 : 8 },
        zIndex: single ? 400 : 90,
      })
      m.addListener('click', () => { setSelCell(c); setSelReport(null); setSelDesign(null) })
      ;(m as MarkerWithMeta).__cat = c.entityType || c.layer || 'Asset'
      return m
    })

    // Clear whatever was directly attached (bypassing the clusterer) on the
    // previous pass — chunked and never aborted, same as the report-pins
    // effect's identical detach call above.
    attachOverlaysChunked(directAssetMarkersRef.current, null, () => false)
    directAssetMarkersRef.current = []

    const useIndividual = markers.length > 0 && markers.length <= INDIVIDUAL_PIN_THRESHOLD
    if (useIndividual) {
      if (assetClustererRef.current) {
        assetClustererRef.current.setMap(null)
        assetClustererRef.current = null
      }
      directAssetMarkersRef.current = markers
      const gen = ++assetAttachGenRef.current
      attachOverlaysChunked(markers, map, () => assetAttachGenRef.current !== gen)
      return
    }
    if (assetClustererRef.current) {
      assetClustererRef.current.clearMarkers()
      assetClustererRef.current.addMarkers(markers)
    } else {
      assetClustererRef.current = new MarkerClusterer({
        map, markers,
        renderer: { render: (cluster) => {
          const { count, position, markers: clusterMarkers } = cluster
          const radius = count >= 500 ? 30 : count >= 100 ? 24 : count >= 25 ? 18 : 14
          const counts = new Map<string, number>()
          for (const mk of clusterMarkers as MarkerWithMeta[]) {
            const c = mk.__cat || 'Asset'
            counts.set(c, (counts.get(c) ?? 0) + 1)
          }
          const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
          const topLine = top.map(([k, v]) => `${k} (${v})`).join(', ') + (counts.size > 3 ? ', …' : '')
          return new google.maps.Marker({
            position,
            title: `${count.toLocaleString()} assets\n${topLine}\nClick to zoom in`,
            icon: { path: google.maps.SymbolPath.CIRCLE, fillColor: D.blue, fillOpacity: 0.8, strokeColor: 'rgba(0,0,0,0.5)', strokeWeight: 2, scale: radius },
            label: { text: String(count), color: '#000', fontSize: '11px', fontFamily: 'var(--font-mono)' },
            zIndex: 900 + count,
          })
        } },
      })
    }
    ;(window as any).__debugAssetClusterer = assetClustererRef.current
  }, [mapLoaded, assetClusters])

  /* ── Render: ArcGIS road-design overlay ───────────────────── */
  useEffect(() => {
    if (!mapLoaded || !mapRef.current) return
    const map = mapRef.current
    // Chunked, not a plain forEach — this layer alone can hold 1,000+
    // Polylines for a real project (Coastal Road's Section 1c design CAD
    // overlay), loaded by default on every /dashboard view. See the
    // 2026-09-22 (2) changelog entry.
    attachOverlaysChunked(designLinesRef.current, null, () => false)
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
            icons, clickable: true, zIndex: layer.zIndex,
          })
          line.addListener('click', () => { setSelDesign({ feature, layer }); setSelReport(null); setSelCell(null) })
          lines.push(line)
        })
      })
    })
    designLinesRef.current = lines
    const gen = ++designLineAttachGenRef.current
    attachOverlaysChunked(lines, map, () => designLineAttachGenRef.current !== gen)
  }, [mapLoaded, designData, layers.design, hiddenDesignLayers])

  /* ── Consume a focus request (report row clicked elsewhere) ── */
  useEffect(() => {
    if (!focusRequest || !mapLoaded || !mapRef.current) return
    const sig = focusRequest.reportId ?? `${focusRequest.lat},${focusRequest.lng}`
    if (lastFocusRef.current === sig) return
    lastFocusRef.current = sig

    if (focusRequest.reportId != null) setFocusedId(focusRequest.reportId)
    if (focusRequest.enableLayer) setLayer(focusRequest.enableLayer, true)

    // Prefer a chainage-snapped position over the request's raw lat/lng —
    // see MapFocusRequest.startChainage's comment. Mirrors the report-pin
    // render effect's own nearestStation resolution (binary search over
    // stations sorted by label) so "zoom to this report" always lands on
    // the exact same spot the report's own marker is actually drawn at,
    // not wherever its raw (often stuck/reused) GPS field points.
    let focusLat = focusRequest.lat, focusLng = focusRequest.lng
    if (focusRequest.startChainage != null && !isNaN(focusRequest.startChainage) && coastalStations.length > 0) {
      const sorted = [...coastalStations].sort((a, b) => a.label - b.label)
      let lo = 0, hi = sorted.length - 1
      const target = focusRequest.startChainage
      while (lo < hi) {
        const mid = (lo + hi) >> 1
        if (sorted[mid].label < target) lo = mid + 1
        else hi = mid
      }
      const nearest = lo > 0 && Math.abs(sorted[lo - 1].label - target) <= Math.abs(sorted[lo].label - target)
        ? sorted[lo - 1] : sorted[lo]
      // Same guard as the render effect's nearestStation — coastalStations
      // may currently be scoped to whatever bbox was last fetched, not
      // necessarily anywhere near this report; fall back to raw lat/lng
      // rather than confidently panning to a wrong, too-far station.
      if (nearest && Math.abs(nearest.label - target) <= MAX_STATION_SNAP_DISTANCE_M) {
        focusLat = nearest.latitude; focusLng = nearest.longitude
      }
    }
    if (!isNaN(focusLat) && !isNaN(focusLng)) {
      programmaticMoveRef.current = true
      mapRef.current.panTo({ lat: focusLat, lng: focusLng })
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
  }, [focusRequest, mapLoaded, setLayer, clearFocusRequest, coastalStations])

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

    // See mapReadyRef's comment — mapLoaded/mapRef.current are both set
    // synchronously at map construction, before the map has a real
    // projection; fitBounds/panTo called that early can silently no-op.
    const applyFit = () => {
      const map = mapRef.current
      if (!map) return
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
      programmaticMoveRef.current = true
      if (points === 1 || b.getNorthEast().equals(b.getSouthWest())) {
        map.panTo(b.getCenter())
        map.setZoom(16)
      } else {
        map.fitBounds(b, 70)
        google.maps.event.addListenerOnce(map, 'bounds_changed', () => { if ((map.getZoom() ?? 0) > 16) map.setZoom(16) })
      }
    }
    if (mapReadyRef.current) applyFit()
    else google.maps.event.addListenerOnce(mapRef.current, 'idle', applyFit)
  }, [mapLoaded, category, chFrom, chTo, coastalStations, initialSection])

  /* ── Render ───────────────────────────────────────────────── */
  const legendItems = colorBy === 'category' ? Object.entries(CAT_COLORS) : Object.entries(STATUS_COLORS)
  const busy = reportsLoading || assetsRefreshing

  // Calabar/Ogun/Kebbi (road_assets survey points) chips only shown when
  // showRoadAssets is on — /dashboard passes false (see that prop's
  // comment: a real point-resolution bug in that layer's own server-side
  // clustering, 2026-09-22 (3) entry, made it a source of confusion there
  // rather than useful context, and the direct ask was to keep that page
  // showing only activity reports for clarity). /planning-implementation
  // still needs these — that page's whole purpose is road_assets data.
  const LAYER_CHIPS: { k: MapLayerKey; label: string }[] = [
    { k: 'coastalLine', label: 'Road line' },
    { k: 'reports',     label: 'Reports' },
    ...(showRoadAssets ? [
      { k: 'calabar' as const, label: 'Calabar' },
      { k: 'ogun'    as const, label: 'Ogun' },
      { k: 'kebbi'   as const, label: 'Kebbi' },
    ] : []),
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
          {visibleReportCount.toLocaleString()} reports
          {showRoadAssets && ` · ${assetClusters.length.toLocaleString()} asset points`}
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

      {/* Legend — clickable, PowerBI/ArcGIS-style series toggling. */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 16px', marginTop: 12 }}>
        {showRoadAssets && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 10, height: 10, borderRadius: '50%', background: D.blue }} />
            <span style={{ fontSize: 10, color: D.muted, fontFamily: 'var(--font-mono)' }}>Road assets (Calabar/Ogun/Kebbi)</span>
          </div>
        )}
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
