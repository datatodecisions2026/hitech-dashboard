'use client'

import { useEffect, useRef, useState } from 'react'

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

/* ── Component ─────────────────────────────────────────────── */
interface ViewState {
  zoom:  number
  swLat: number
  swLng: number
  neLat: number
  neLng: number
}

export default function HitechMap({ project, chFrom, chTo }: Props) {
  const mapContainer = useRef<HTMLDivElement>(null)
  const mapRef       = useRef<any>(null)
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

  /* ── Load data from API ──────────────────────────────────
     First load (or a project switch) fetches a coarse, whole-road view and
     shows the full loading overlay. Once the map settles on that view,
     `moveend` reports the real zoom/bounds back here (see the map-init
     effect below), which refetches at the appropriate detail level for
     what's actually visible — silently, via `refreshing`, not the big
     overlay. This is what keeps a 400k+-row chainage table from ever being
     pulled in one shot: only the current view's detail tier is fetched.
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

  /* ── Initialise Mapbox once ─────────────────────────────── */
  useEffect(() => {
    if (!mapContainer.current || mapRef.current) return

    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN
    if (!token) {
      setError('Mapbox token not set (NEXT_PUBLIC_MAPBOX_TOKEN missing)')
      setLoading(false)
      return
    }

    let localMap: any = null

    import('mapbox-gl')
      .then(({ default: mapboxgl }) => {
        if (!mapContainer.current) return
        mapboxgl.accessToken = token

        try {
          localMap = new mapboxgl.Map({
            container: mapContainer.current,
            style:     'mapbox://styles/mapbox/dark-v11',
            center:    [3.627, 6.432],
            zoom:      11,
            attributionControl: false,
          })
        } catch (err: any) {
          setError(`Map init failed: ${err?.message || String(err)}`)
          setLoading(false)
          return
        }

        localMap.addControl(new mapboxgl.NavigationControl(),              'top-right')
        localMap.addControl(new mapboxgl.ScaleControl({ unit: 'metric' }), 'bottom-right')
        localMap.addControl(new mapboxgl.AttributionControl({ compact: true }), 'bottom-left')

        localMap.on('load', () => {
          mapRef.current = localMap
          setMapLoaded(true)
        })

        // Reports the settled view back to the data-fetch effect above, so
        // it can refetch chainage detail scoped to what's actually on screen
        // instead of the whole road every time.
        localMap.on('moveend', () => {
          const b = localMap.getBounds()
          setViewState({
            zoom:  localMap.getZoom(),
            swLat: b.getSouth(), swLng: b.getWest(),
            neLat: b.getNorth(), neLng: b.getEast(),
          })
        })

        localMap.on('error', (e: any) => {
          setError(`Map error: ${e?.error?.message || 'unknown'}`)
          setLoading(false)
        })
      })
      .catch((err: any) => {
        setError(`Failed to load Mapbox library: ${err?.message || String(err)}`)
        setLoading(false)
      })

    return () => {
      const m = localMap || mapRef.current
      if (m) {
        try { m.remove() } catch (_) {}
      }
      mapRef.current = null
      setMapLoaded(false)
    }
  }, [])

  /* ── Add / update layers when map + data ready ──────────── */
  useEffect(() => {
    if (!mapLoaded || !mapRef.current || !mapData) return
    const map = mapRef.current

    /* Station road line */
    const sortedStations = [...mapData.stations].sort((a, b) => a.label - b.label)
    const stationLineGJ: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: sortedStations.map(s => [s.longitude, s.latitude]) },
        properties: {},
      }],
    }

    /* Chainage tick marks every 1 km */
    const ticksGJ: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: mapData.stations
        .filter(s => s.label % 1000 === 0)
        .map(s => ({
          type:       'Feature' as const,
          geometry:   { type: 'Point' as const, coordinates: [s.longitude, s.latitude] },
          properties: { chainage: s.chainage, label: s.label },
        })),
    }

    /* Build lookup: label → station */
    const stMap = new Map(mapData.stations.map(s => [s.label, s]))

    /* Report segments + points */
    const allFeatures: GeoJSON.Feature[] = mapData.reports
      .filter(r => r.start_chainage != null || r.start_chainage_lat != null)
      .map(r => {
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

        if (!startLng || !startLat || isNaN(startLng) || isNaN(startLat)) return null

        const samePoint = !endLng || !endLat || (startLng === endLng && startLat === endLat)
        const props = {
          id: r.id, category: r.activity_category, type: r.activity_type,
          status: r.activity_status, reporter: r.reporter_name,
          date: r.date_of_activity, section: r.section_name,
          start_ch: r.start_chainage, end_ch: r.end_chainage,
          catColor: catColor(r.activity_category),
          statusColor: statusColor(r.activity_status),
        }
        return {
          type: 'Feature' as const,
          geometry: samePoint
            ? { type: 'Point' as const,      coordinates: [startLng, startLat] }
            : { type: 'LineString' as const, coordinates: [[startLng, startLat], [endLng!, endLat!]] },
          properties: props,
        }
      })
      .filter(Boolean) as GeoJSON.Feature[]

    const linesGJ:  GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: allFeatures.filter(f => f.geometry.type === 'LineString') }
    const pointsGJ: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: allFeatures.filter(f => f.geometry.type === 'Point') }

    /* Add / update sources */
    const upsertSource = (id: string, data: GeoJSON.FeatureCollection, extraOpts: Record<string, any> = {}) => {
      if (map.getSource(id)) (map.getSource(id) as any).setData(data)
      else map.addSource(id, { type: 'geojson', data, ...extraOpts })
    }
    upsertSource('station-line',  stationLineGJ)
    upsertSource('station-ticks', ticksGJ)
    upsertSource('report-lines',  linesGJ)
    // Clustered: nearby report points bundle into a bubble at low zoom and
    // split apart as you zoom in, instead of rendering every point as its
    // own feature. cluster options only take effect on the initial
    // addSource — later setData() calls (viewport refreshes, filter
    // changes) keep reclustering the new data automatically.
    upsertSource('report-points', pointsGJ, { cluster: true, clusterMaxZoom: 14, clusterRadius: 45 })

    /* Layers */
    const colorExpr = colorBy === 'category' ? ['get', 'catColor'] : ['get', 'statusColor']

    if (!map.getLayer('station-line-layer')) {
      map.addLayer({ id: 'station-line-layer', type: 'line', source: 'station-line',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint:  { 'line-color': '#ffffff', 'line-width': 1.5, 'line-opacity': 0.2, 'line-dasharray': [4, 3] } })
    }
    if (!map.getLayer('station-ticks-layer')) {
      map.addLayer({ id: 'station-ticks-layer', type: 'symbol', source: 'station-ticks',
        layout: { 'text-field': ['get', 'chainage'], 'text-size': 10, 'text-offset': [0, -1.2], 'text-anchor': 'bottom' },
        paint:  { 'text-color': '#d4a040', 'text-halo-color': 'rgba(0,0,0,0.85)', 'text-halo-width': 1.5 } })
    }
    if (!map.getLayer('report-lines-layer')) {
      map.addLayer({ id: 'report-lines-layer', type: 'line', source: 'report-lines',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint:  { 'line-color': colorExpr as any, 'line-width': 6, 'line-opacity': 0.85 } })
    } else {
      map.setPaintProperty('report-lines-layer', 'line-color', colorExpr)
    }
    if (!map.getLayer('report-clusters-layer')) {
      map.addLayer({ id: 'report-clusters-layer', type: 'circle', source: 'report-points',
        filter: ['has', 'point_count'],
        paint: {
          'circle-color':        D.amber,
          'circle-opacity':      0.85,
          'circle-stroke-width': 2,
          'circle-stroke-color': 'rgba(0,0,0,0.5)',
          'circle-radius':       ['step', ['get', 'point_count'], 14, 25, 18, 100, 24, 500, 30],
        } })
    }
    if (!map.getLayer('report-cluster-count-layer')) {
      map.addLayer({ id: 'report-cluster-count-layer', type: 'symbol', source: 'report-points',
        filter: ['has', 'point_count'],
        layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-size': 11,
                  'text-font': ['DIN Pro Medium', 'Arial Unicode MS Bold'] },
        paint:  { 'text-color': '#000' } })
    }
    if (!map.getLayer('report-points-layer')) {
      map.addLayer({ id: 'report-points-layer', type: 'circle', source: 'report-points',
        filter: ['!', ['has', 'point_count']],
        paint: { 'circle-color': colorExpr as any, 'circle-radius': 7,
                 'circle-stroke-width': 2, 'circle-stroke-color': 'rgba(0,0,0,0.6)', 'circle-opacity': 0.9 } })
    } else {
      map.setPaintProperty('report-points-layer', 'circle-color', colorExpr)
    }

    /* Click handler */
    const onClick = (e: any) => {
      // Cluster bubble → zoom in to expand it, don't try to show a popup
      const clusterHit = map.queryRenderedFeatures(e.point, { layers: ['report-clusters-layer'] })
      if (clusterHit.length) {
        const clusterId = clusterHit[0].properties?.cluster_id
        const src = map.getSource('report-points') as any
        src.getClusterExpansionZoom(clusterId, (err: any, zoom: number) => {
          if (err) return
          map.easeTo({ center: (clusterHit[0].geometry as any).coordinates, zoom, duration: 500 })
        })
        return
      }

      const features = map.queryRenderedFeatures(e.point, { layers: ['report-lines-layer', 'report-points-layer'] })
      if (!features.length) { setSelReport(null); return }
      const p = features[0].properties
      setSelReport({
        id: p.id, start_chainage: p.start_ch, end_chainage: p.end_ch,
        start_chainage_val: null, end_chainage_val: null,
        activity_category: p.category, activity_type: p.type,
        activity_status: p.status, reporter_name: p.reporter,
        date_of_activity: p.date, project_name: project,
        section_name: p.section,
        start_chainage_lat: null, start_chainage_long: null,
        end_chainage_lat: null,   end_chainage_long: null,
      })
    }
    map.on('click', onClick)
    map.on('mouseenter', 'report-lines-layer',    () => { map.getCanvas().style.cursor = 'pointer' })
    map.on('mouseleave', 'report-lines-layer',    () => { map.getCanvas().style.cursor = '' })
    map.on('mouseenter', 'report-points-layer',   () => { map.getCanvas().style.cursor = 'pointer' })
    map.on('mouseleave', 'report-points-layer',   () => { map.getCanvas().style.cursor = '' })
    map.on('mouseenter', 'report-clusters-layer', () => { map.getCanvas().style.cursor = 'pointer' })
    map.on('mouseleave', 'report-clusters-layer', () => { map.getCanvas().style.cursor = '' })

    /* ── Fit map bounds ─────────────────────────────────────
       If chainage filter is active → zoom to that range.
       Otherwise → fit the entire road.
       Only runs once per distinct (project, chFrom, chTo) — NOT on every
       mapData refresh. Panning/zooming triggers a viewport-scoped refetch
       (see the data-fetch effect) that updates the same sources in place;
       without this guard, that refresh would re-trigger fitBounds, which
       fires another moveend, which refetches again — an infinite loop.
    ────────────────────────────────────────────────────────── */
    const fitKey = `${project}|${chFrom || ''}|${chTo || ''}`
    if (mapData.stations.length > 0 && lastFitKeyRef.current !== fitKey) {
      lastFitKeyRef.current = fitKey
      const chFromNum = chFrom ? Number(chFrom) : null
      const chToNum   = chTo   ? Number(chTo)   : null
      const hasChFilter = chFromNum != null && chToNum != null &&
                          !isNaN(chFromNum) && !isNaN(chToNum) &&
                          chToNum > chFromNum

      if (hasChFilter) {
        // Zoom to the filtered chainage range
        const rangeStations = mapData.stations.filter(
          s => s.label >= chFromNum! && s.label <= chToNum!
        )
        const target = rangeStations.length > 0 ? rangeStations : mapData.stations
        const lngs = target.map(s => s.longitude)
        const lats = target.map(s => s.latitude)
        map.fitBounds(
          [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
          { padding: 80, duration: 1200, maxZoom: 16 }
        )
      } else {
        // Fit entire road
        const lngs = mapData.stations.map(s => s.longitude)
        const lats = mapData.stations.map(s => s.latitude)
        map.fitBounds(
          [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
          { padding: 60, duration: 1200 }
        )
      }
    }

    return () => { map.off('click', onClick) }
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
        .mapboxgl-ctrl-group { background: rgba(30,30,34,0.95) !important; border: 1px solid rgba(255,255,255,0.08) !important; }
        .mapboxgl-ctrl-group button { background: transparent !important; color: #848080 !important; }
        .mapboxgl-ctrl-group button:hover { background: rgba(255,255,255,0.06) !important; }
        .mapboxgl-ctrl-attrib { background: rgba(0,0,0,0.6) !important; color: #504e54 !important; font-size: 9px !important; }
        .mapboxgl-ctrl-attrib a { color: #504e54 !important; }
        .mapboxgl-ctrl-scale { background: rgba(0,0,0,0.5) !important; border-color: #504e54 !important; color: #848080 !important; font-size: 9px !important; }
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