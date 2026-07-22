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
  start_chainage:       number | null
  end_chainage:         number | null
  start_chainage_val:   number | null
  end_chainage_val:     number | null
  activity_category:    string
  activity_type:        string
  activity_status:      string
  reporter_name:        string
  date_of_activity:     string
  project_name:         string
  section_name:         string
  start_chainage_lat:   string | null
  start_chainage_long:  string | null
  end_chainage_lat:     string | null
  end_chainage_long:    string | null
}

interface MapData {
  stations: Station[]
  reports:  ActivityReport[]
  project:  string
}

/* ── Props ─────────────────────────────────────────────────── */
interface Props {
  project: string
  chFrom?: string   // chainage filter from — zooms map when both set
  chTo?:   string   // chainage filter to
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
export default function HitechMap({ project, chFrom, chTo }: Props) {
  const mapContainer = useRef<HTMLDivElement>(null)
  const mapRef       = useRef<google.maps.Map | null>(null)
  const [mapData,    setMapData]    = useState<MapData | null>(null)
  const [loading,    setLoading]    = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error,      setError]      = useState('')
  const [colorBy,    setColorBy]    = useState<'category' | 'status'>('category')
  const [selReport,  setSelReport]  = useState<ActivityReport | null>(null)
  const [mapLoaded,  setMapLoaded]  = useState(false)
  const [viewState,  setViewState]  = useState<ViewState | null>(null)
  const prevProjectRef = useRef<string | null>(null)
  const lastFitKeyRef   = useRef<string>('')

  // Overlay objects have no Mapbox-style setData() — each rebuild clears and
  // recreates them, so refs track what's currently on the map to clear.
  const stationLineRef  = useRef<google.maps.Polyline | null>(null)
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
    const projectChanged = prevProjectRef.current !== project
    prevProjectRef.current = project

    if (projectChanged) {
      setLoading(true)
      setSelReport(null)
    } else {
      setRefreshing(true)
    }

    const params = new URLSearchParams({ project })
    if (viewState && !projectChanged) {
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
  }, [project, viewState])

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
            mapTypeId: 'hybrid', // satellite imagery + road/place labels
            mapTypeControl: true,
            streetViewControl: false,
            fullscreenControl: false,
            clickableIcons: false,
          })
        } catch (err: any) {
          setError(`Map init failed: ${err?.message || String(err)}`)
          setLoading(false)
          return
        }

        mapRef.current = localMap
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
      stationLineRef.current?.setMap(null)
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
    stationLineRef.current?.setMap(null)
    tickMarkersRef.current.forEach(m => m.setMap(null))
    reportLinesRef.current.forEach(l => l.setMap(null))
    clustererRef.current?.clearMarkers()

    /* Station road line */
    const sortedStations = [...mapData.stations].sort((a, b) => a.label - b.label)
    stationLineRef.current = new google.maps.Polyline({
      path: sortedStations.map(s => ({ lat: s.latitude, lng: s.longitude })),
      strokeColor:   '#ffffff',
      strokeOpacity: 0.001, // near-invisible solid — the dashed look comes from the icons pattern below
      strokeWeight:  1.5,
      icons: [{
        icon:   { path: 'M 0,-1 0,1', strokeOpacity: 0.35, strokeColor: '#ffffff', scale: 2 },
        offset: '0',
        repeat: '12px',
      }],
      clickable: false,
      zIndex: 1,
      map,
    })

    /* Chainage tick marks every 1 km */
    tickMarkersRef.current = mapData.stations
      .filter(s => s.label % 1000 === 0)
      .map(s => new google.maps.Marker({
        position: { lat: s.latitude, lng: s.longitude },
        map,
        icon: { path: google.maps.SymbolPath.CIRCLE, scale: 0, strokeOpacity: 0, fillOpacity: 0 },
        label: { text: s.chainage, color: D.amber, fontSize: '10px', fontFamily: 'var(--font-mono)', className: 'chainage-tick-label' },
        clickable: false,
        zIndex: 2,
      }))

    /* Build lookup: label → station, for reports without direct lat/lng */
    const stMap = new Map(mapData.stations.map(s => [s.label, s]))
    const colorFor = (r: ActivityReport) => colorBy === 'category' ? catColor(r.activity_category) : statusColor(r.activity_status)

    const reportLines: google.maps.Polyline[] = []
    const reportMarkers: google.maps.Marker[] = []

    mapData.reports
      .filter(r => r.start_chainage != null || r.start_chainage_lat != null)
      .forEach(r => {
        const startLng = r.start_chainage_long
          ? parseFloat(r.start_chainage_long)
          : stMap.get(Math.round(r.start_chainage ?? r.start_chainage_val ?? 0))?.longitude
        const startLat = r.start_chainage_lat
          ? parseFloat(r.start_chainage_lat)
          : stMap.get(Math.round(r.start_chainage ?? r.start_chainage_val ?? 0))?.latitude
        const endLng = r.end_chainage_long
          ? parseFloat(r.end_chainage_long)
          : stMap.get(Math.round(r.end_chainage ?? r.end_chainage_val ?? 0))?.longitude
        const endLat = r.end_chainage_lat
          ? parseFloat(r.end_chainage_lat)
          : stMap.get(Math.round(r.end_chainage ?? r.end_chainage_val ?? 0))?.latitude

        if (!startLng || !startLat || isNaN(startLng) || isNaN(startLat)) return

        const samePoint = !endLng || !endLat || (startLng === endLng && startLat === endLat)
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
    reportMarkersRef.current = reportMarkers
    if (clustererRef.current) {
      clustererRef.current.addMarkers(reportMarkers)
    } else {
      clustererRef.current = new MarkerClusterer({ map, markers: reportMarkers })
    }

    /* ── Fit map bounds ─────────────────────────────────────
       If chainage filter is active → zoom to that range.
       Otherwise → fit the entire road.
       Only runs once per distinct (project, chFrom, chTo) — NOT on every
       mapData refresh. Panning/zooming triggers a viewport-scoped refetch
       (see the data-fetch effect) that updates these overlays in place;
       without this guard, that refresh would re-trigger fitBounds, which
       fires another `idle`, which refetches again — an infinite loop.
    ────────────────────────────────────────────────────────── */
    const fitKey = `${project}|${chFrom || ''}|${chTo || ''}`
    if (mapData.stations.length > 0 && lastFitKeyRef.current !== fitKey) {
      lastFitKeyRef.current = fitKey
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
  }, [mapLoaded, mapData, colorBy, project, chFrom, chTo])

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
