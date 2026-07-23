'use client'

import { useEffect, useRef, useState } from 'react'
import { setOptions, importLibrary } from '@googlemaps/js-api-loader'
import { MarkerClusterer } from '@googlemaps/markerclusterer'

/* ── Design tokens ─────────────────────────────────────────── */
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

// Road-alignment line colors — deliberately outside the activity palette above
// so a road line is never mistaken for an activity marker/segment.
const ROAD_PRIMARY   = '#ffffff' // active project's own road
const ROAD_SECONDARY = '#7d8590' // the other known road, shown dimmed as background context
const HL_FILTER      = '#6366f1' // chainage range(s) covered by an active category/chainage filter — deep indigo, deliberately deeper/more saturated than Construction's pastel blue or Surveying's pastel purple so it doesn't blend into either, and reads clearly against Google's gold-toned road rendering
const HL_SELECTED    = '#ff2ec4' // the one currently-selected report's own segment

// The two roads with dense-enough data to always show together (Coastal Road
// as the "home" project, Sokoto Badagry as its background pair) — matches
// PROJECT_ID_MAP's Coastal Road / SBS Sokoto Badagry highway entries in
// src/app/api/map/route.ts. Any other project shows on its own, no pairing.
const COASTAL = 'Coastal Road'
const SOKOTO  = 'SBS Sokoto Badagry highway'
const isKnownRoad = (p: string) => {
  const s = p.toLowerCase()
  return s.includes('coastal') || s.includes('sokoto') || s.includes('sbs')
}
const matchRoad = (p: string): string => p.toLowerCase().includes('sokoto') || p.toLowerCase().includes('sbs') ? SOKOTO : COASTAL


/* ── Types ─────────────────────────────────────────────────── */
interface Station {
  label:      number
  chainage:   string
  latitude:   number
  longitude:  number
  project_id: number
}

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

interface MapData {
  stations: Station[]
  reports:  ActivityReport[]
  project:  string
  category?: string
}

/* ── Props ─────────────────────────────────────────────────── */
interface Props {
  project: string
  chFrom?: string   // chainage filter from — zooms map when both set
  chTo?:   string   // chainage filter to
  category?: string // filters the map's own reports to this category and zooms to fit them
  // Set this (e.g. from a click on a report row elsewhere on the dashboard)
  // to pan/zoom the map to that report's location and open its popup.
  focusReport?: ActivityReport | null
}

interface ViewState {
  zoom:  number
  swLat: number
  swLng: number
  neLat: number
  neLng: number
}

// setOptions() must run before any importLibrary() call — module scope
// guarantees that regardless of render/mount order.
setOptions({ key: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || '', v: 'weekly' })

/* ── Component ─────────────────────────────────────────────── */
export default function HitechMap({ project, chFrom, chTo, category, focusReport }: Props) {
  const mapContainer = useRef<HTMLDivElement>(null)
  const mapRef       = useRef<google.maps.Map | null>(null)
  const [mapData,    setMapData]    = useState<MapData | null>(null)
  const [secondaryStations, setSecondaryStations] = useState<Station[]>([])
  const [loading,    setLoading]    = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error,      setError]      = useState('')
  const [colorBy,    setColorBy]    = useState<'category' | 'status'>('category')
  const [selReport,  setSelReport]  = useState<ActivityReport | null>(null)
  const [mapLoaded,  setMapLoaded]  = useState(false)
  const [viewState,  setViewState]  = useState<ViewState | null>(null)
  const prevProjectRef  = useRef<string | null>(null)
  const prevCategoryRef = useRef<string | undefined>(undefined)
  const lastFitKeyRef   = useRef<string>('')
  const lastFocusIdRef  = useRef<number | null>(null)
  const secondaryFetchedRef = useRef<string | null>(null)

  // Overlay objects have no Mapbox-style setData() — each rebuild clears and
  // recreates them, so refs track what's currently on the map to clear.
  const primaryLineRef   = useRef<google.maps.Polyline | null>(null)
  const secondaryLineRef = useRef<google.maps.Polyline | null>(null)
  const highlightLinesRef = useRef<google.maps.Polyline[]>([])
  const tickMarkersRef  = useRef<google.maps.Marker[]>([])
  const reportLinesRef  = useRef<google.maps.Polyline[]>([])
  const reportMarkersRef = useRef<google.maps.Marker[]>([])
  const clustererRef    = useRef<MarkerClusterer | null>(null)

  /* ── Load data from API ──────────────────────────────────
     First load (or a project switch) fetches a coarse, whole-road view and
     shows the full loading overlay. Once the map settles on that view,
     `idle` reports the real zoom/bounds back here (see the map-init effect
     below), which refetches at the appropriate detail level for what's
     actually visible — silently, via `refreshing`, not the big overlay.
     This is what keeps a 400k+-row chainage table from ever being pulled in
     one shot: only the current view's detail tier is fetched.
  ─────────────────────────────────────────────────────────── */
  useEffect(() => {
    const projectChanged  = prevProjectRef.current !== project
    const categoryChanged = prevCategoryRef.current !== category
    prevProjectRef.current  = project
    prevCategoryRef.current = category
    const isFreshFilter = projectChanged || categoryChanged

    if (isFreshFilter) {
      setLoading(true)
      setSelReport(null)
    } else {
      setRefreshing(true)
    }

    const params = new URLSearchParams({ project })
    if (category) params.set('category', category)
    if (viewState && !isFreshFilter) {
      params.set('zoom',  String(viewState.zoom))
      params.set('swLat', String(viewState.swLat))
      params.set('swLng', String(viewState.swLng))
      params.set('neLat', String(viewState.neLat))
      params.set('neLng', String(viewState.neLng))
    }

    fetch(`/api/map?${params.toString()}`)
      .then(r => r.json())
      .then(d => { setMapData(d); setLoading(false); setRefreshing(false) })
      .catch(() => { setError('Failed to load map data'); setLoading(false); setRefreshing(false) })
  }, [project, category, viewState])

  /* ── Load the "other" known road's line as static background context ────
     Only fires when the active project is one of the two paired roads
     (Coastal Road / Sokoto Badagry) — anything else shows on its own, no
     pairing. Fetched once per distinct secondary road (a fixed coarse zoom,
     not tied to the viewport — it's static context, not something the user
     pans around on directly), so switching between the two paired projects
     doesn't re-fetch a line already held in state. */
  useEffect(() => {
    if (!isKnownRoad(project)) { setSecondaryStations([]); secondaryFetchedRef.current = null; return }
    const activeRoad    = matchRoad(project)
    const secondaryRoad = activeRoad === COASTAL ? SOKOTO : COASTAL
    if (secondaryFetchedRef.current === secondaryRoad) return
    secondaryFetchedRef.current = secondaryRoad

    fetch(`/api/map?${new URLSearchParams({ project: secondaryRoad, zoom: '9' }).toString()}`)
      .then(r => r.json())
      .then(d => setSecondaryStations(d.stations ?? []))
      .catch(() => {})
  }, [project])

  /* ── Initialise Google Maps once ─────────────────────────── */
  useEffect(() => {
    if (!mapContainer.current || mapRef.current) return

    if (!process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY) {
      setError('Google Maps API key not set (NEXT_PUBLIC_GOOGLE_MAPS_API_KEY missing)')
      setLoading(false)
      return
    }

    let cancelled = false

    importLibrary('maps')
      .then(({ Map }) => {
        if (cancelled || !mapContainer.current) return

        let localMap: google.maps.Map
        try {
          localMap = new Map(mapContainer.current, {
            center: { lat: 6.432, lng: 3.627 },
            zoom: 11,
            mapTypeId: 'hybrid', // satellite imagery + road/place labels — kept per explicit request
            mapTypeControl: false,   // no Map/Satellite toggle — wasn't in the original
            streetViewControl: false,
            fullscreenControl: false,
            scaleControl: true,      // equivalent to Mapbox's ScaleControl
            zoomControl: true,       // equivalent to Mapbox's NavigationControl
            zoomControlOptions: { position: google.maps.ControlPosition.RIGHT_TOP },
            clickableIcons: false,
          })
        } catch (err: any) {
          setError(`Map init failed: ${err?.message || String(err)}`)
          setLoading(false)
          return
        }

        mapRef.current = localMap
        ;(window as any).__debugMap = localMap
        setMapLoaded(true)

        // Clicking empty map area clears the selected-report popup — actual
        // report markers/lines stopPropagation implicitly via their own
        // click listeners (added in the layer-building effect below).
        localMap.addListener('click', () => setSelReport(null))

        // Reports the settled view back to the data-fetch effect above, so
        // it can refetch chainage detail scoped to what's actually on
        // screen instead of the whole road every time.
        localMap.addListener('idle', () => {
          const b = localMap.getBounds()
          if (!b) return
          const sw = b.getSouthWest(), ne = b.getNorthEast()
          setViewState({
            zoom:  localMap.getZoom() ?? 11,
            swLat: sw.lat(), swLng: sw.lng(),
            neLat: ne.lat(), neLng: ne.lng(),
          })
        })
      })
      .catch((err: any) => {
        if (!cancelled) {
          setError(`Failed to load Google Maps: ${err?.message || String(err)}`)
          setLoading(false)
        }
      })

    return () => {
      cancelled = true
      primaryLineRef.current?.setMap(null)
      secondaryLineRef.current?.setMap(null)
      highlightLinesRef.current.forEach(l => l.setMap(null))
      tickMarkersRef.current.forEach(m => m.setMap(null))
      reportLinesRef.current.forEach(l => l.setMap(null))
      clustererRef.current?.clearMarkers()
      mapRef.current = null
      setMapLoaded(false)
    }
  }, [])

  /* ── Add / update overlays when map + data ready ─────────── */
  useEffect(() => {
    if (!mapLoaded || !mapRef.current || !mapData) return
    const map = mapRef.current

    // Full rebuild each time — report volume here is bounded (≤1000, see
    // /api/map), so this is cheap; there's no Mapbox-style setData() to
    // patch overlays in place.
    primaryLineRef.current?.setMap(null)
    secondaryLineRef.current?.setMap(null)
    highlightLinesRef.current.forEach(l => l.setMap(null))
    tickMarkersRef.current.forEach(m => m.setMap(null))
    reportLinesRef.current.forEach(l => l.setMap(null))
    clustererRef.current?.clearMarkers()

    /* Secondary (background) road — the other of the two paired roads, drawn
       first / lower zIndex so the active project's own line always sits on
       top of it. Not shown at all for projects outside the known pair. */
    if (secondaryStations.length > 0) {
      const sortedSecondary = [...secondaryStations].sort((a, b) => a.label - b.label)
      secondaryLineRef.current = new google.maps.Polyline({
        path: sortedSecondary.map(s => ({ lat: s.latitude, lng: s.longitude })),
        strokeColor:   ROAD_SECONDARY,
        strokeOpacity: 0.75,
        strokeWeight:  2.5,
        clickable: false,
        zIndex: 1,
        map,
      })
    }

    /* Primary (active project) road line */
    const sortedStations = [...mapData.stations].sort((a, b) => a.label - b.label)
    primaryLineRef.current = new google.maps.Polyline({
      path: sortedStations.map(s => ({ lat: s.latitude, lng: s.longitude })),
      strokeColor:   ROAD_PRIMARY,
      strokeOpacity: 0.9,
      strokeWeight:  3,
      clickable: false,
      zIndex: 2,
      map,
    })

    /* Chainage tick marks every 1 km — label sits above the point, matching
       Mapbox's text-offset:[0,-1.2] / text-anchor:'bottom'. Bold + slightly
       larger than before so labels stay legible over satellite imagery. */
    tickMarkersRef.current = mapData.stations
      .filter(s => s.label % 1000 === 0)
      .map(s => new google.maps.Marker({
        position: { lat: s.latitude, lng: s.longitude },
        map,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 0, strokeOpacity: 0, fillOpacity: 0,
          anchor: new google.maps.Point(0, 0),
          labelOrigin: new google.maps.Point(0, -8),
        },
        label: { text: s.chainage, color: D.amber, fontSize: '13px', fontWeight: '700', fontFamily: 'var(--font-mono)' },
        clickable: false,
        zIndex: 2,
      }))

    // Position reports by chainage (nearest sampled station) rather than by
    // their raw GPS fields — those turn out to be unreliable at scale: e.g.
    // one single coordinate on Coastal Road is reused, unchanged, across
    // 2,018 reports spanning completely different chainages (looks like a
    // stuck/cached GPS fix in the field-collection app, not a real per-
    // report reading). Chainage values, by contrast, always land correctly
    // on the road because they're looked up against the same station table
    // used to draw the road line itself. `mapData.stations` is a sampled
    // subset (see /api/map), so this is a nearest-label match, not exact —
    // still far more accurate than a possibly-stale GPS pin.
    const nearestStation = (targetLabel: number): Station | undefined => {
      let best: Station | undefined
      let bestDist = Infinity
      for (const s of mapData!.stations) {
        const d = Math.abs(s.label - targetLabel)
        if (d < bestDist) { best = s; bestDist = d }
      }
      return best
    }
    const chainageNum = (val: number | null | undefined, text: number | null | undefined): number | null => {
      if (val != null && !isNaN(val)) return val
      if (text != null) {
        const n = Number(String(text).replace('+', ''))
        if (!isNaN(n)) return n
      }
      return null
    }
    const colorFor = (r: ActivityReport) => colorBy === 'category' ? catColor(r.activity_category) : statusColor(r.activity_status)

    /* ── Filter highlight: paint the road line itself where the active
       filter's reports fall ──────────────────────────────────────────
       Category filter → merge every matching report's [start, end] chainage
       into as few continuous stretches as possible (adjacent/overlapping
       ranges combine), so a category matching hundreds or thousands of
       reports still renders as a handful of polylines, not one per report.
       Chainage-range filter → the range is already explicit, no merging
       needed. Category takes priority when both are active, same order the
       fitBounds zoom below already uses, so the zoom and the highlight
       always agree on which one "wins". */
    const HL_MERGE_GAP = 500 // metres — ranges within this of each other merge into one stretch
    const mergeRanges = (ranges: [number, number][]): [number, number][] => {
      if (ranges.length === 0) return []
      const sorted = [...ranges].sort((a, b) => a[0] - b[0])
      const merged: [number, number][] = [[...sorted[0]] as [number, number]]
      for (let i = 1; i < sorted.length; i++) {
        const [s, e] = sorted[i]
        const last = merged[merged.length - 1]
        if (s <= last[1] + HL_MERGE_GAP) last[1] = Math.max(last[1], e)
        else merged.push([s, e])
      }
      return merged
    }
    const chainagePath = (fromCh: number, toCh: number) => {
      const lo = Math.min(fromCh, toCh), hi = Math.max(fromCh, toCh)
      const within = mapData!.stations.filter(s => s.label >= lo && s.label <= hi).sort((a, b) => a.label - b.label)
      const startS = nearestStation(lo)
      const endS   = nearestStation(hi)
      const pts = [...within]
      if (startS && pts[0]?.label !== startS.label) pts.unshift(startS)
      if (endS && pts[pts.length - 1]?.label !== endS.label) pts.push(endS)
      return pts.map(s => ({ lat: s.latitude, lng: s.longitude }))
    }

    let highlightRanges: [number, number][] = []
    if (category) {
      const raw: [number, number][] = []
      mapData.reports.forEach(r => {
        const s = chainageNum(r.start_chainage_val, r.start_chainage)
        const e = chainageNum(r.end_chainage_val, r.end_chainage)
        if (s != null && e != null) raw.push([Math.min(s, e), Math.max(s, e)])
      })
      highlightRanges = mergeRanges(raw)
    } else {
      const chFromNum = chFrom ? Number(chFrom) : null
      const chToNum   = chTo   ? Number(chTo)   : null
      if (chFromNum != null && chToNum != null && !isNaN(chFromNum) && !isNaN(chToNum) && chToNum > chFromNum) {
        highlightRanges = [[chFromNum, chToNum]]
      }
    }

    ;(window as any).__debugHighlightRanges = highlightRanges
    highlightLinesRef.current = highlightRanges
      .map(([lo, hi]) => chainagePath(lo, hi))
      .filter(path => path.length >= 2)
      .map(path => new google.maps.Polyline({
        path,
        strokeColor:   HL_FILTER,
        strokeOpacity: 0.9,
        strokeWeight:  6,
        clickable: false,
        zIndex: 3,
        map,
      }))
    ;(window as any).__debugHighlightLines = highlightLinesRef.current.map(l => ({ onMap: !!l.getMap(), pathLen: l.getPath().getLength() }))

    const reportLines: google.maps.Polyline[] = []
    const reportMarkers: google.maps.Marker[] = []

    mapData.reports
      .filter(r => r.start_chainage != null || r.start_chainage_val != null || r.start_chainage_lat != null)
      .forEach(r => {
        const startCh = chainageNum(r.start_chainage_val, r.start_chainage)
        const startStation = startCh != null ? nearestStation(startCh) : undefined
        const startLng = startStation?.longitude ?? (r.start_chainage_long ? parseFloat(r.start_chainage_long) : undefined)
        const startLat = startStation?.latitude  ?? (r.start_chainage_lat  ? parseFloat(r.start_chainage_lat)  : undefined)

        const endCh = chainageNum(r.end_chainage_val, r.end_chainage)
        const endStation = endCh != null ? nearestStation(endCh) : undefined
        const endLng = endStation?.longitude ?? (r.end_chainage_long ? parseFloat(r.end_chainage_long) : undefined)
        const endLat = endStation?.latitude  ?? (r.end_chainage_lat  ? parseFloat(r.end_chainage_lat)  : undefined)

        if (!startLng || !startLat || isNaN(startLng) || isNaN(startLat)) return

        // Some report rows have an implausibly distant end coordinate (data
        // entry/conversion error — e.g. an end lat identical to the start
        // lat but a longitude tens of km away, which draws a straight line
        // that cuts across open water instead of following the actual
        // road). A real single-activity segment is at most a few km; treat
        // anything further as bad end data and fall back to a point at the
        // start location rather than draw a nonsensical line.
        const endTooFar = endLng != null && endLat != null && !isNaN(endLng) && !isNaN(endLat)
          && Math.hypot(endLng - startLng, endLat - startLat) > 0.05 // ≈5-6km at this latitude

        const samePoint = !endLng || !endLat || (startLng === endLng && startLat === endLat) || endTooFar
        const color = colorFor(r)

        if (samePoint) {
          const marker = new google.maps.Marker({
            position: { lat: startLat, lng: startLng },
            icon: {
              path: google.maps.SymbolPath.CIRCLE,
              fillColor: color, fillOpacity: 0.9,
              strokeColor: 'rgba(0,0,0,0.6)', strokeWeight: 2,
              scale: 7,
            },
            zIndex: 5,
          })
          marker.addListener('click', () => setSelReport(r))
          reportMarkers.push(marker)
        } else {
          const line = new google.maps.Polyline({
            path: [{ lat: startLat, lng: startLng }, { lat: endLat!, lng: endLng! }],
            strokeColor: color, strokeOpacity: 0.85, strokeWeight: 6,
            clickable: true, zIndex: 4, map,
          })
          line.addListener('click', () => setSelReport(r))
          line.addListener('mouseover', () => { if (mapContainer.current) mapContainer.current.style.cursor = 'pointer' })
          line.addListener('mouseout',  () => { if (mapContainer.current) mapContainer.current.style.cursor = '' })
          reportLines.push(line)
        }
      })

    reportLinesRef.current = reportLines

    // Clustered: nearby report points bundle into a bubble at low zoom and
    // split apart on click/zoom, instead of every point rendering as its
    // own marker. clearMarkers() above already emptied the previous set.
    // Custom renderer matches the original amber step-sized bubble design
    // (14/18/24/30px by count) instead of MarkerClusterer's default look.
    reportMarkersRef.current = reportMarkers
    if (clustererRef.current) {
      clustererRef.current.addMarkers(reportMarkers)
    } else {
      clustererRef.current = new MarkerClusterer({
        map, markers: reportMarkers,
        renderer: {
          render: ({ count, position }) => {
            const radius = count >= 500 ? 30 : count >= 100 ? 24 : count >= 25 ? 18 : 14
            return new google.maps.Marker({
              position,
              icon: {
                path: google.maps.SymbolPath.CIRCLE,
                fillColor: D.amber, fillOpacity: 0.85,
                strokeColor: 'rgba(0,0,0,0.5)', strokeWeight: 2,
                scale: radius,
              },
              label: { text: String(count), color: '#000', fontSize: '11px', fontFamily: 'var(--font-mono)' },
              zIndex: 1000 + count,
            })
          },
        },
      })
    }

    /* ── Fit map bounds ─────────────────────────────────────
       If a category filter is active → zoom to that category's reports.
       Else if a chainage filter is active → zoom to that range.
       Otherwise → fit the entire road.
       Only runs once per distinct (project, category, chFrom, chTo) — NOT
       on every mapData refresh. Panning/zooming triggers a viewport-scoped
       refetch (see the data-fetch effect) that updates these overlays in
       place; without this guard, that refresh would re-trigger fitBounds,
       which fires another `idle`, which refetches again — an infinite loop.
    ────────────────────────────────────────────────────────── */
    const fitKey = `${project}|${category || ''}|${chFrom || ''}|${chTo || ''}`
    if (mapData.stations.length > 0 && lastFitKeyRef.current !== fitKey) {
      lastFitKeyRef.current = fitKey

      const categoryBounds = new google.maps.LatLngBounds()
      let hasCategoryPoint = false
      if (category) {
        mapData.reports.forEach(r => {
          const lat = r.start_chainage_lat  ? parseFloat(r.start_chainage_lat)  : null
          const lng = r.start_chainage_long ? parseFloat(r.start_chainage_long) : null
          if (lat != null && lng != null && !isNaN(lat) && !isNaN(lng)) {
            categoryBounds.extend({ lat, lng })
            hasCategoryPoint = true
          }
        })
      }

      if (hasCategoryPoint) {
        map.fitBounds(categoryBounds, 80)
        google.maps.event.addListenerOnce(map, 'bounds_changed', () => {
          if ((map.getZoom() ?? 0) > 16) map.setZoom(16)
        })
      } else {
        const chFromNum = chFrom ? Number(chFrom) : null
        const chToNum   = chTo   ? Number(chTo)   : null
        const hasChFilter = chFromNum != null && chToNum != null &&
                            !isNaN(chFromNum) && !isNaN(chToNum) &&
                            chToNum > chFromNum

        const bounds = new google.maps.LatLngBounds()
        if (hasChFilter) {
          const rangeStations = mapData.stations.filter(s => s.label >= chFromNum! && s.label <= chToNum!)
          const target = rangeStations.length > 0 ? rangeStations : mapData.stations
          target.forEach(s => bounds.extend({ lat: s.latitude, lng: s.longitude }))
        } else {
          mapData.stations.forEach(s => bounds.extend({ lat: s.latitude, lng: s.longitude }))
        }
        map.fitBounds(bounds, 70)

        if (hasChFilter) {
          // Google's fitBounds has no maxZoom option — clamp after the fact
          google.maps.event.addListenerOnce(map, 'bounds_changed', () => {
            if ((map.getZoom() ?? 0) > 16) map.setZoom(16)
          })
        }
      }
    }
  }, [mapLoaded, mapData, secondaryStations, colorBy, project, category, chFrom, chTo])

  /* ── Focus a specific report (e.g. clicked from a list elsewhere on the
     dashboard) ─────────────────────────────────────────────
     Pans/zooms straight to that report's coordinates and opens its popup.
     Guarded by lastFocusIdRef so this only fires once per distinct focus
     request — without it, every unrelated mapData refresh (a normal
     viewport-driven refetch while the user is freely panning afterward)
     would re-run this effect and yank the camera back.
     If the report belongs to a different project than what's currently
     loaded, the caller (dashboard page) is expected to also change the
     `project` prop; this effect waits for `mapData.project` to actually
     reflect that before panning, rather than acting on stale/wrong data. ── */
  useEffect(() => {
    if (!focusReport || !mapLoaded || !mapRef.current) return
    if (lastFocusIdRef.current === focusReport.id) return

    if (mapData?.project && focusReport.project_name) {
      const wantWord = focusReport.project_name.split(' ')[0].toLowerCase()
      if (!mapData.project.toLowerCase().includes(wantWord)) return // wait for the right project's data to load
    }

    const lat = focusReport.start_chainage_lat  ? parseFloat(focusReport.start_chainage_lat)  : null
    const lng = focusReport.start_chainage_long ? parseFloat(focusReport.start_chainage_long) : null
    if (lat == null || lng == null || isNaN(lat) || isNaN(lng)) return

    lastFocusIdRef.current = focusReport.id
    mapRef.current.panTo({ lat, lng })
    mapRef.current.setZoom(17)
    setSelReport(focusReport)
  }, [focusReport, mapLoaded, mapData])

  /* ── Render ─────────────────────────────────────────────── */
  const legendItems = colorBy === 'category' ? Object.entries(CAT_COLORS) : Object.entries(STATUS_COLORS)
  const hasReports  = mapData && mapData.reports.some(r => r.start_chainage != null || r.start_chainage_lat != null)

  return (
    <div style={{ position: 'relative', width: '100%' }}>

      {/* Controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, color: D.muted, fontFamily: 'var(--font-mono)', letterSpacing: 1 }}>COLOR BY</span>
        {(['category', 'status'] as const).map(opt => (
          <button key={opt} onClick={() => setColorBy(opt)} style={{
            background: colorBy === opt ? D.amber : 'transparent',
            color:      colorBy === opt ? '#000'  : D.muted,
            border:     `1px solid ${colorBy === opt ? D.amber : D.sub}`,
            borderRadius: 5, padding: '4px 14px', fontSize: 11,
            cursor: 'pointer', fontFamily: 'var(--font-mono)',
            letterSpacing: 1, textTransform: 'uppercase', transition: 'all 0.2s',
            boxShadow: colorBy === opt ? SH_RAISED : 'none',
          }}>{opt}</button>
        ))}

        {/* Active chainage range badge */}
        {chFrom && chTo && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: `${D.amber}15`, border: `1px solid ${D.amber}44`, borderRadius: 5, padding: '4px 10px' }}>
            <span style={{ fontSize: 10, color: D.amber, fontFamily: 'var(--font-mono)', letterSpacing: 0.5 }}>
              CH {Number(chFrom).toLocaleString()} → {Number(chTo).toLocaleString()}
            </span>
          </div>
        )}

        {mapData && (
          <span style={{ marginLeft: 'auto', fontSize: 11, color: D.sub, fontFamily: 'var(--font-mono)', display: 'flex', alignItems: 'center', gap: 8 }}>
            {mapData.reports.length} reports · {mapData.stations.length.toLocaleString()} chainage points
            {refreshing && <span style={{ color: D.amber }}>· refining detail…</span>}
          </span>
        )}
      </div>

      {/* Map */}
      <div className="hitech-map-frame" style={{ position: 'relative', borderRadius: 10, overflow: 'hidden', height: 500, boxShadow: SH_WELL }}>
        <div ref={mapContainer} style={{ width: '100%', height: '100%' }} />

        {/* Loading overlay */}
        {(loading || !mapLoaded) && (
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(33,33,36,0.88)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12, zIndex: 10 }}>
            <div style={{ width: 32, height: 32, border: `3px solid ${D.sub}`, borderTop: `3px solid ${D.amber}`, borderRadius: '50%', animation: 'mapSpin 0.8s linear infinite' }} />
            <span style={{ color: D.muted, fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: 1 }}>
              {loading ? 'LOADING DATA…' : 'INITIALISING MAP…'}
            </span>
          </div>
        )}

        {/* Error */}
        {error && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(33,33,36,0.95)', color: D.red, fontFamily: 'var(--font-mono)', fontSize: 12, zIndex: 20, textAlign: 'center', padding: 24 }}>
            {error}
          </div>
        )}

        {/* No chainage notice */}
        {mapData && !hasReports && !loading && (
          <div style={{ position: 'absolute', bottom: 16, left: '50%', transform: 'translateX(-50%)', background: 'rgba(10,8,5,0.92)', border: `1px solid ${D.amber}44`, borderRadius: 8, padding: '8px 16px', fontSize: 11, color: D.muted, fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap', zIndex: 10 }}>
            ⚠ Road line shown · Activity segments will appear once chainage data is synced
          </div>
        )}

        {/* Selected report popup */}
        {selReport && (
          <div style={{ position: 'absolute', top: 12, left: 12, zIndex: 20, background: 'rgba(10,8,5,0.96)', border: `1px solid ${catColor(selReport.activity_category)}55`, borderRadius: 10, padding: '14px 16px', minWidth: 240, maxWidth: 300, boxShadow: '0 12px 40px rgba(0,0,0,0.7)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
              <span style={{ fontSize: 10, color: catColor(selReport.activity_category), fontFamily: 'var(--font-mono)', letterSpacing: 1, textTransform: 'uppercase', fontWeight: 700 }}>
                {selReport.activity_category}
              </span>
              <button onClick={() => setSelReport(null)} style={{ background: 'none', border: 'none', color: D.sub, cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: 0, marginLeft: 8 }}>✕</button>
            </div>
            <div style={{ fontSize: 13, color: D.text, fontWeight: 600, marginBottom: 8 }}>{selReport.activity_type}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <InfoRow label="Status"   value={selReport.activity_status}  color={statusColor(selReport.activity_status)} />
              <InfoRow label="Reporter" value={selReport.reporter_name} />
              <InfoRow label="Section"  value={selReport.section_name} />
              <InfoRow label="Date"     value={selReport.date_of_activity} />
              {selReport.start_chainage != null && (
                <InfoRow label="Chainage" value={`${selReport.start_chainage} → ${selReport.end_chainage}`} />
              )}
            </div>
          </div>
        )}
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 16px', marginTop: 12 }}>
        {legendItems.map(([name, color]) => (
          <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 10, height: 10, borderRadius: 2, background: color }} />
            <span style={{ fontSize: 10, color: D.muted, fontFamily: 'var(--font-mono)' }}>{name}</span>
          </div>
        ))}
      </div>

      <style>{`
        @media (max-width: 640px) { .hitech-map-frame { height: 340px !important; } }
        @keyframes mapSpin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
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
