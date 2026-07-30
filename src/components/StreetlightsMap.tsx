'use client'

import { useEffect, useRef, useState } from 'react'
import { setOptions, importLibrary } from '@googlemaps/js-api-loader'
import { MarkerClusterer } from '@googlemaps/markerclusterer'
import { useTheme } from '@/lib/theme'

/* ── Types ─────────────────────────────────────────────────── */
interface ClusterCell {
  lat: number
  lng: number
  count: number
  objectid?: number
  side?: string
  section?: string
  station?: string
  imageVariant?: number
  isSynthetic?: boolean
  imageUrl?: string
  imageLabel?: string
}

interface ViewState {
  zoom:  number
  swLat: number
  swLng: number
  neLat: number
  neLng: number
}

interface Props {
  section: string // '' = all sections
  onLoadStats?: (stats: { queryMs: number; clientMs: number; count: number; mode: 'live' | 'mv' }) => void
}

// setOptions() must run before any importLibrary() call — module scope
// guarantees that regardless of render/mount order. Same pattern as
// HitechMap.tsx.
setOptions({ key: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || '', v: 'weekly' })

/* ── Component ─────────────────────────────────────────────── */
export default function StreetlightsMap({ section, onLoadStats }: Props) {
  const { colors: D, shadows: SH } = useTheme()

  const mapContainer = useRef<HTMLDivElement>(null)
  const mapRef        = useRef<google.maps.Map | null>(null)
  const clustererRef   = useRef<MarkerClusterer | null>(null)
  const markersRef     = useRef<google.maps.Marker[]>([])
  const lastFitKeyRef   = useRef<string>('')
  const prevSectionRef = useRef<string | null>(null)

  const [clusters,   setClusters]   = useState<ClusterCell[]>([])
  const [loading,    setLoading]    = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error,      setError]      = useState('')
  const [viewState,  setViewState]  = useState<ViewState | null>(null)
  const [mapLoaded,  setMapLoaded]  = useState(false)
  const [selCell,    setSelCell]    = useState<ClusterCell | null>(null)

  /* ── Load data from API ──────────────────────────────────
     Same coarse-then-refined pattern as HitechMap: a fresh filter (section
     change) blocks with `loading`; a viewport-only refresh (idle firing
     after a pan/zoom) just sets `refreshing`, no full-screen overlay. ── */
  useEffect(() => {
    const isFreshFilter = prevSectionRef.current !== section
    prevSectionRef.current = section
    if (isFreshFilter) { setLoading(true); setSelCell(null) } else { setRefreshing(true) }

    const params = new URLSearchParams()
    if (section) params.set('section', section)
    if (viewState && !isFreshFilter) {
      params.set('zoom',  String(viewState.zoom))
      params.set('swLat', String(viewState.swLat))
      params.set('swLng', String(viewState.swLng))
      params.set('neLat', String(viewState.neLat))
      params.set('neLng', String(viewState.neLng))
    }

    const t0 = performance.now()
    fetch(`/api/streetlights?${params.toString()}`)
      .then(r => r.json())
      .then(d => {
        setClusters(d.clusters ?? [])
        setLoading(false)
        setRefreshing(false)
        onLoadStats?.({
          queryMs: d.queryMs ?? 0,
          clientMs: Math.round(performance.now() - t0),
          count: (d.clusters ?? []).length,
          mode: d.clusterMode ?? 'mv',
        })
      })
      .catch(() => { setError('Failed to load streetlight data'); setLoading(false); setRefreshing(false) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section, viewState])

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
            center: { lat: 9.0, lng: 8.0 }, // Nigeria-wide default — streetlights span many sections nationwide
            zoom: 6,
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
          setLoading(false)
          return
        }

        mapRef.current = localMap
        setMapLoaded(true)

        localMap.addListener('click', () => setSelCell(null))

        localMap.addListener('idle', () => {
          const b = localMap.getBounds()
          if (!b) return
          const sw = b.getSouthWest(), ne = b.getNorthEast()
          setViewState({
            zoom:  localMap.getZoom() ?? 6,
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
      clustererRef.current?.clearMarkers()
      markersRef.current.forEach(m => m.setMap(null))
      mapRef.current = null
      setMapLoaded(false)
    }
  }, [])

  /* ── Add / update markers when map + data ready ──────────── */
  useEffect(() => {
    if (!mapLoaded || !mapRef.current) return
    const map = mapRef.current

    // No Mapbox-style setData() — full clear-and-rebuild each run, same
    // constraint HitechMap already documents.
    clustererRef.current?.clearMarkers()
    markersRef.current.forEach(m => m.setMap(null))

    const markers = clusters.map(c => {
      const isSingle = c.count === 1 && c.objectid != null
      const marker = new google.maps.Marker({
        position: { lat: c.lat, lng: c.lng },
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          fillColor: isSingle ? D.green : D.amber,
          fillOpacity: 0.9,
          strokeColor: 'rgba(0,0,0,0.55)',
          strokeWeight: 2,
          scale: isSingle ? 6 : 9,
        },
        zIndex: isSingle ? 500 : 100,
      })
      marker.addListener('click', () => setSelCell(c))
      return marker
    })
    markersRef.current = markers

    if (clustererRef.current) {
      clustererRef.current.addMarkers(markers)
    } else {
      clustererRef.current = new MarkerClusterer({
        map, markers,
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

    // fitBounds only on a real filter (section) change, never on a
    // viewport-driven refresh — same rationale/guard as HitechMap's
    // lastFitKeyRef, prevents an infinite fitBounds -> idle -> refetch loop.
    const fitKey = section
    if (clusters.length > 0 && lastFitKeyRef.current !== fitKey) {
      lastFitKeyRef.current = fitKey
      const bounds = new google.maps.LatLngBounds()
      clusters.forEach(c => bounds.extend({ lat: c.lat, lng: c.lng }))
      map.fitBounds(bounds, 60)
    }
  }, [mapLoaded, clusters, D, section])

  /* ── Render ─────────────────────────────────────────────── */
  return (
    <div style={{ position: 'relative', width: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 10, color: D.muted, fontFamily: 'var(--font-mono)', letterSpacing: 1 }}>
          <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: D.amber, marginRight: 5 }} />
          CLUSTER
          <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: D.green, marginLeft: 12, marginRight: 5 }} />
          SINGLE LIGHT
        </span>
        {clusters.length > 0 && (
          <span style={{ marginLeft: 'auto', fontSize: 11, color: D.sub, fontFamily: 'var(--font-mono)', display: 'flex', alignItems: 'center', gap: 8 }}>
            {clusters.length.toLocaleString()} points shown
            {refreshing && <span style={{ color: D.amber }}>· refining detail…</span>}
          </span>
        )}
      </div>

      <div className="streetlights-map-frame" style={{ position: 'relative', borderRadius: 10, overflow: 'hidden', height: 520, boxShadow: SH.well }}>
        <div ref={mapContainer} style={{ width: '100%', height: '100%' }} />

        {(loading || !mapLoaded) && (
          <div style={{ position: 'absolute', inset: 0, background: `${D.bg}e0`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12, zIndex: 10 }}>
            <div style={{ width: 32, height: 32, border: `3px solid ${D.sub}`, borderTop: `3px solid ${D.amber}`, borderRadius: '50%', animation: 'slSpin 0.8s linear infinite' }} />
            <span style={{ color: D.muted, fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: 1 }}>
              {loading ? 'LOADING STREETLIGHTS…' : 'INITIALISING MAP…'}
            </span>
          </div>
        )}

        {error && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: `${D.bg}f0`, color: D.red, fontFamily: 'var(--font-mono)', fontSize: 12, zIndex: 20, textAlign: 'center', padding: 24 }}>
            {error}
          </div>
        )}

        {/* Selected cell popup */}
        {selCell && (
          <div style={{ position: 'absolute', top: 12, left: 12, zIndex: 20, background: D.panel2, border: `1px solid ${D.amber}55`, borderRadius: 10, padding: '14px 16px', minWidth: 220, maxWidth: 280, boxShadow: SH.cardLg }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
              <span style={{ fontSize: 10, color: D.amber, fontFamily: 'var(--font-mono)', letterSpacing: 1, textTransform: 'uppercase', fontWeight: 700 }}>
                {selCell.count === 1 ? 'Streetlight' : `Cluster of ${selCell.count.toLocaleString()}`}
              </span>
              <button onClick={() => setSelCell(null)} style={{ background: 'none', border: 'none', color: D.sub, cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: 0, marginLeft: 8 }}>✕</button>
            </div>

            {selCell.imageUrl && (
              <img
                src={selCell.imageUrl}
                alt={selCell.imageLabel || 'Streetlight'}
                loading="lazy"
                style={{ width: '100%', height: 110, objectFit: 'cover', borderRadius: 6, marginBottom: 10 }}
              />
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {selCell.section && <InfoRow D={D} label="Section" value={selCell.section} />}
              {selCell.side && <InfoRow D={D} label="Side" value={selCell.side} />}
              {selCell.station && <InfoRow D={D} label="Chainage" value={selCell.station} />}
              {selCell.objectid != null && <InfoRow D={D} label="ID" value={selCell.objectid} />}
              {selCell.count > 1 && (
                <div style={{ fontSize: 10, color: D.sub, fontFamily: 'var(--font-mono)', marginTop: 4 }}>
                  Showing 1 of {selCell.count.toLocaleString()} in this cluster — zoom in for exact positions
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <style>{`
        @media (max-width: 640px) { .streetlights-map-frame { height: 360px !important; } }
        @keyframes slSpin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  )
}

function InfoRow({ D, label, value }: { D: ReturnType<typeof useTheme>['colors']; label: string; value: string | number }) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
      <span style={{ fontSize: 10, color: D.sub, fontFamily: 'var(--font-mono)', width: 60, flexShrink: 0 }}>{label}</span>
      <span style={{ fontSize: 11, color: D.text, fontFamily: 'var(--font-mono)' }}>{String(value)}</span>
    </div>
  )
}
