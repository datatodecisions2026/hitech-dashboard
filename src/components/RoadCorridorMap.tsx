'use client'

import { useEffect, useRef, useState } from 'react'
import { setOptions, importLibrary } from '@googlemaps/js-api-loader'

/* ──────────────────────────────────────────────────────────────
   Dedicated map for /road-corridors. Renders the real ingested
   road_corridors segments (see scripts/sql/add_road_corridors_infra.sql +
   sync_road_corridors.py) on a satellite basemap — deliberately NOT
   UnifiedMap, which is tightly coupled to the dashboard/planning-
   implementation's reports+road_assets concerns. Colors match the source
   Earth Engine app's own scheme (confirmed live 2026-09-17: "Ogun (Neon
   Yellow) / Calabar (Cyan) / Kebbi (Magenta)") for visual continuity with
   the app this replaces.
────────────────────────────────────────────────────────────── */

const REGION_COLOR: Record<string, string> = {
  ogun: '#d4ff00',
  calabar: '#22e5ff',
  kebbi: '#ff2ec8',
}
const REGION_CAMERA: Record<string, { lat: number; lng: number; zoom: number }> = {
  all: { lat: 8.2, lng: 5.6, zoom: 6 },
  calabar: { lat: 4.98, lng: 8.2, zoom: 10 },
  ogun: { lat: 6.37, lng: 4.47, zoom: 11 },
  kebbi: { lat: 11.83, lng: 4.47, zoom: 9 },
}

interface Segment { id: number; lengthM: number; npoints: number; path: { lat: number; lng: number }[] }
interface ViewState { zoom: number; swLat: number; swLng: number; neLat: number; neLng: number }

interface Props {
  region: 'all' | 'calabar' | 'ogun' | 'kebbi'
  onLoadStats?: (stats: { queryMs: number; clientMs: number; segments: number }) => void
}

setOptions({ key: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || '', v: 'weekly' })

export default function RoadCorridorMap({ region, onLoadStats }: Props) {
  const mapContainer = useRef<HTMLDivElement>(null)
  const mapRef = useRef<google.maps.Map | null>(null)
  const linesRef = useRef<google.maps.Polyline[]>([])
  const lastFitRef = useRef<string | null>(null)
  const reqKeyRef = useRef('')
  const reqIdRef = useRef(0)
  const idleDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [mapLoaded, setMapLoaded] = useState(false)
  const [viewState, setViewState] = useState<ViewState | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<{ region: string; seg: Segment } | null>(null)

  /* ── init map once ───────────────────────────────────────── */
  useEffect(() => {
    if (!mapContainer.current || mapRef.current) return
    if (!process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY) {
      setError('Google Maps API key not set (NEXT_PUBLIC_GOOGLE_MAPS_API_KEY missing)')
      return
    }
    let cancelled = false
    const start = REGION_CAMERA[region] ?? REGION_CAMERA.all

    importLibrary('maps').then(({ Map }) => {
      if (cancelled || !mapContainer.current) return
      const map = new Map(mapContainer.current, {
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
      mapRef.current = map
      setMapLoaded(true)
      // same debug-hook convention as UnifiedMap's window.__debugHighlightLines/
      // __debugDesignLines — lets a verification script drive the camera to an
      // exact real coordinate instead of guessing screen pixel positions.
      ;(window as any).__debugCorridorMap = map
      map.addListener('click', () => setSelected(null))
      map.addListener('idle', () => {
        // Debounced: Google Maps fires `idle` after every discrete pan/zoom
        // step, not just the final settled view — during a fast zoom-in
        // sequence (several scroll ticks or double-clicks in quick
        // succession) this collapses what would otherwise be one fetch per
        // intermediate step into a single fetch for wherever the user
        // actually stops, instead of redundantly querying/rendering several
        // viewports the user never stayed on.
        if (idleDebounceRef.current) clearTimeout(idleDebounceRef.current)
        idleDebounceRef.current = setTimeout(() => {
          const b = map.getBounds()
          if (!b) return
          const sw = b.getSouthWest(), ne = b.getNorthEast()
          setViewState({ zoom: map.getZoom() ?? start.zoom, swLat: sw.lat(), swLng: sw.lng(), neLat: ne.lat(), neLng: ne.lng() })
        }, 350)
      })
    }).catch((err: any) => {
      if (!cancelled) setError(`Failed to load Google Maps: ${err?.message || String(err)}`)
    })

    return () => {
      cancelled = true
      if (idleDebounceRef.current) clearTimeout(idleDebounceRef.current)
      linesRef.current.forEach(l => l.setMap(null))
      mapRef.current = null
      setMapLoaded(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* ── zoom to the selected region on filter change ───────────
     First run seeds without fitting (don't yank a fresh-load view). */
  useEffect(() => {
    if (lastFitRef.current === null) { lastFitRef.current = region; return }
    if (!mapLoaded || !mapRef.current || lastFitRef.current === region) return
    lastFitRef.current = region
    const cam = REGION_CAMERA[region] ?? REGION_CAMERA.all
    mapRef.current.panTo({ lat: cam.lat, lng: cam.lng })
    mapRef.current.setZoom(cam.zoom)
  }, [region, mapLoaded])

  /* ── fetch + render segments for the active region(s) ───────── */
  useEffect(() => {
    if (!mapLoaded) return
    const regions = region === 'all' ? (['calabar', 'ogun', 'kebbi'] as const) : ([region] as const)
    const b = viewState && viewState.zoom >= 9
      ? { swLat: viewState.swLat, swLng: viewState.swLng, neLat: viewState.neLat, neLng: viewState.neLng }
      : null
    const key = `${regions.join(',')}|${viewState?.zoom ?? ''}|${b ? `${b.swLat.toFixed(2)},${b.swLng.toFixed(2)},${b.neLat.toFixed(2)},${b.neLng.toFixed(2)}` : 'wide'}`
    if (reqKeyRef.current === key) return
    reqKeyRef.current = key

    // Guards against a slower earlier request resolving after a newer one —
    // without this, two overlapping fetch+render cycles (e.g. from two
    // quick zoom steps before the idle debounce above existed) could apply
    // out of order, leaving the map showing a stale, already-superseded
    // viewport's lines.
    const reqId = ++reqIdRef.current

    setLoading(true)
    const t0 = performance.now()
    Promise.all(regions.map(r => {
      const p = new URLSearchParams({ region: r })
      if (viewState) p.set('zoom', String(viewState.zoom))
      if (b) { p.set('swLat', String(b.swLat)); p.set('swLng', String(b.swLng)); p.set('neLat', String(b.neLat)); p.set('neLng', String(b.neLng)) }
      return fetch(`/api/road-corridors?${p.toString()}`).then(r2 => r2.json()).then(d => ({ region: r, d }))
    })).then(results => {
      if (reqId !== reqIdRef.current) return // a newer request has already started — discard this stale result
      const map = mapRef.current
      if (!map) return
      linesRef.current.forEach(l => l.setMap(null))
      const lines: google.maps.Polyline[] = []
      let queryMs = 0
      let totalSegs = 0
      for (const { region: r, d } of results) {
        queryMs = Math.max(queryMs, d.queryMs ?? 0)
        const color = REGION_COLOR[r] || '#ffffff'
        for (const seg of (d.segments ?? []) as Segment[]) {
          totalSegs++
          const line = new google.maps.Polyline({
            path: seg.path, strokeColor: color, strokeOpacity: 0.9, strokeWeight: 3,
            clickable: true, zIndex: 5, map,
          })
          line.addListener('click', () => setSelected({ region: r, seg }))
          lines.push(line)
        }
      }
      linesRef.current = lines
      onLoadStats?.({ queryMs, clientMs: Math.round(performance.now() - t0), segments: totalSegs })
    }).catch(() => { if (reqId === reqIdRef.current) setError('Failed to load road corridor data') })
      .finally(() => { if (reqId === reqIdRef.current) setLoading(false) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapLoaded, region, viewState])

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={mapContainer} style={{ width: '100%', height: '100%' }} />

      {!mapLoaded && !error && (
        <div style={{ position: 'absolute', inset: 0, background: 'rgba(20,20,24,0.9)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12, zIndex: 10 }}>
          <div style={{ width: 30, height: 30, border: '3px solid #444', borderTopColor: '#d4a040', borderRadius: '50%', animation: 'rcm-spin 0.8s linear infinite' }} />
          <span style={{ color: '#999', fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: 1, textTransform: 'uppercase' }}>Initialising map…</span>
        </div>
      )}
      {error && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(20,20,24,0.95)', color: '#f87171', fontFamily: 'var(--font-mono)', fontSize: 12, textAlign: 'center', padding: 24, zIndex: 20 }}>
          {error}
        </div>
      )}
      {loading && mapLoaded && (
        <div style={{ position: 'absolute', top: 10, right: 54, zIndex: 10, background: 'rgba(0,0,0,0.65)', color: '#d4a040', fontFamily: 'var(--font-mono)', fontSize: 10.5, letterSpacing: 0.5, padding: '5px 10px', borderRadius: 6 }}>
          refining…
        </div>
      )}

      {selected && (
        <div style={{ position: 'absolute', top: 12, left: 12, zIndex: 20, background: 'rgba(10,8,5,0.94)', border: `1px solid ${REGION_COLOR[selected.region]}66`, borderRadius: 10, padding: '12px 14px', minWidth: 200, boxShadow: '0 12px 40px rgba(0,0,0,0.7)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
            <span style={{ fontSize: 10, color: REGION_COLOR[selected.region], fontFamily: 'var(--font-mono)', letterSpacing: 1, textTransform: 'uppercase', fontWeight: 700 }}>
              {selected.region}
            </span>
            <button onClick={() => setSelected(null)} style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontSize: 13, lineHeight: 1, padding: 0, marginLeft: 8 }}>✕</button>
          </div>
          <div style={{ fontSize: 11, color: '#ccc', fontFamily: 'var(--font-mono)', display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span>Segment length: {selected.seg.lengthM.toLocaleString(undefined, { maximumFractionDigits: 0 })} m</span>
            <span>Vertices: {selected.seg.npoints}</span>
          </div>
        </div>
      )}

      <style>{`@keyframes rcm-spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}
