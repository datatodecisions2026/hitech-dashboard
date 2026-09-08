'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { MAP_VIEW_STORAGE_KEY } from './theme-constants'

/**
 * Shared state for the one <UnifiedMap> used on every page that has a map
 * (/dashboard, /planning-implementation). Lifting camera + layer prefs here
 * means navigating between those pages restores the same view even though the
 * Google Maps instance itself re-mounts on a route change.
 *
 * Same pattern as src/lib/sidebar.tsx: 'use client', localStorage-persisted
 * prefs hydrated one render after mount to avoid a hydration mismatch.
 */

export type MapLayerKey = 'coastalLine' | 'reports' | 'calabar' | 'ogun' | 'kebbi' | 'design'
export type MapColorBy = 'category' | 'status'

export interface MapCamera { lat: number; lng: number; zoom: number }

export interface MapFocusRequest {
  lat: number
  lng: number
  zoom?: number
  reportId?: number
  /** Turn this layer on so the focused point has visible context around it. */
  enableLayer?: MapLayerKey
  /** Minimal report fields so the popup can render without the report being in
     the currently-loaded viewport set. */
  popup?: {
    activity_category?: string
    activity_type?: string
    activity_status?: string
    reporter_name?: string
    section_name?: string
    date_of_activity?: string
    start_chainage?: string | number | null
    end_chainage?: string | number | null
  }
}

const DEFAULT_LAYERS: Record<MapLayerKey, boolean> = {
  coastalLine: true, reports: true, calabar: true, ogun: true, kebbi: true, design: true,
}

interface MapViewContextValue {
  /** Last settled map view. Persisted to localStorage so it also survives a
     full page load — the app navigates with plain <a href> (not SPA), so
     context alone would reset on every page change. */
  camera: MapCamera | null
  setCamera: (c: MapCamera) => void
  layers: Record<MapLayerKey, boolean>
  toggleLayer: (k: MapLayerKey) => void
  setLayer: (k: MapLayerKey, on: boolean) => void
  colorBy: MapColorBy
  setColorBy: (c: MapColorBy) => void
  /** Set by a report-row click elsewhere; the map consumes it once then clears. */
  focusRequest: MapFocusRequest | null
  setFocusRequest: (r: MapFocusRequest) => void
  clearFocusRequest: () => void
}

const MapViewContext = createContext<MapViewContextValue | null>(null)

interface Persisted { layers?: Partial<Record<MapLayerKey, boolean>>; colorBy?: MapColorBy; camera?: MapCamera }

function loadPersisted(): Persisted {
  try {
    const raw = localStorage.getItem(MAP_VIEW_STORAGE_KEY)
    if (!raw) return {}
    const p = JSON.parse(raw)
    return p && typeof p === 'object' ? p : {}
  } catch { return {} }
}

/** Synchronous read for the map's init effect — a child effect runs before
   this provider's hydrate effect, so the context `camera` is still null then. */
export function readPersistedCamera(): MapCamera | null {
  const c = loadPersisted().camera
  return c && typeof c.lat === 'number' && typeof c.lng === 'number' && typeof c.zoom === 'number' ? c : null
}

export function MapViewProvider({ children }: { children: React.ReactNode }) {
  const [camera, setCameraState] = useState<MapCamera | null>(null)
  const [layers, setLayers] = useState<Record<MapLayerKey, boolean>>(DEFAULT_LAYERS)
  const [colorBy, setColorByState] = useState<MapColorBy>('category')
  const [focusRequest, setFocusRequestState] = useState<MapFocusRequest | null>(null)

  useEffect(() => {
    const p = loadPersisted()
    if (p.layers) setLayers(l => ({ ...l, ...p.layers }))
    if (p.colorBy === 'category' || p.colorBy === 'status') setColorByState(p.colorBy)
    const cam = readPersistedCamera()
    if (cam) setCameraState(cam)
  }, [])

  const persist = useCallback((next: Persisted) => {
    try {
      localStorage.setItem(MAP_VIEW_STORAGE_KEY, JSON.stringify({ ...loadPersisted(), ...next }))
    } catch {}
  }, [])

  const setCamera = useCallback((c: MapCamera) => { setCameraState(c); persist({ camera: c }) }, [persist])

  const toggleLayer = useCallback((k: MapLayerKey) => {
    setLayers(l => { const next = { ...l, [k]: !l[k] }; persist({ layers: next }); return next })
  }, [persist])

  const setLayer = useCallback((k: MapLayerKey, on: boolean) => {
    setLayers(l => { if (l[k] === on) return l; const next = { ...l, [k]: on }; persist({ layers: next }); return next })
  }, [persist])

  const setColorBy = useCallback((c: MapColorBy) => { setColorByState(c); persist({ colorBy: c }) }, [persist])

  const setFocusRequest = useCallback((r: MapFocusRequest) => setFocusRequestState(r), [])
  const clearFocusRequest = useCallback(() => setFocusRequestState(null), [])

  const value = useMemo<MapViewContextValue>(() => ({
    camera, setCamera, layers, toggleLayer, setLayer, colorBy, setColorBy,
    focusRequest, setFocusRequest, clearFocusRequest,
  }), [camera, setCamera, layers, toggleLayer, setLayer, colorBy, setColorBy, focusRequest, setFocusRequest, clearFocusRequest])

  return <MapViewContext.Provider value={value}>{children}</MapViewContext.Provider>
}

export function useMapView(): MapViewContextValue {
  const ctx = useContext(MapViewContext)
  if (!ctx) throw new Error('useMapView must be used within a MapViewProvider')
  return ctx
}
