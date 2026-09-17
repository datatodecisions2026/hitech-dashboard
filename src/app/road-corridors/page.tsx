'use client'

import dynamic from 'next/dynamic'
const RoadCorridorMap = dynamic(() => import('@/components/RoadCorridorMap'), { ssr: false })

import { useEffect, useState, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useTheme } from '@/lib/theme'

const EE_APP_URL = 'https://academic-matter-367309.projects.earthengine.app/view/roadcorridors'

type RegionKey = 'all' | 'calabar' | 'ogun' | 'kebbi'
interface RegionSummary { region: 'calabar' | 'ogun' | 'kebbi'; segmentCount: number; totalLengthM: number }

const REGIONS: { key: RegionKey; label: string; color?: string }[] = [
  { key: 'all', label: 'All Regions' },
  { key: 'calabar', label: 'Calabar', color: '#22e5ff' },
  { key: 'ogun', label: 'Ogun', color: '#d4ff00' },
  { key: 'kebbi', label: 'Kebbi', color: '#ff2ec8' },
]

function useCountUp(target: number, duration = 900) {
  const [val, setVal] = useState(0)
  useEffect(() => {
    if (!target) { setVal(0); return }
    const start = Date.now()
    let raf: number
    const tick = () => {
      const p = Math.min((Date.now() - start) / duration, 1)
      setVal(Math.round((1 - Math.pow(1 - p, 4)) * target))
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, duration])
  return val
}

function KPICard({ label, value, suffix = '', color }: { label: string; value: number; suffix?: string; color?: string }) {
  const { colors: D, shadows: SH } = useTheme()
  const n = useCountUp(value)
  return (
    <div style={{ background: D.panel, border: `1px solid ${D.border}`, borderRadius: 12, boxShadow: SH.card, padding: 16 }}>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: D.muted, marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 600, letterSpacing: '-0.01em', color: color || D.text, fontVariantNumeric: 'tabular-nums' }}>
        {n.toLocaleString()}{suffix}
      </div>
    </div>
  )
}

export default function RoadCorridorsPage() {
  const { colors: D, shadows: SH } = useTheme()
  const router = useRouter()
  const [region, setRegion] = useState<RegionKey>('all')
  const [summary, setSummary] = useState<RegionSummary[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [loadStats, setLoadStats] = useState<{ queryMs: number; clientMs: number; segments: number } | null>(null)
  const requestIdRef = useRef(0)

  const loadSummary = useCallback(() => {
    const reqId = ++requestIdRef.current
    setLoading(true)
    fetch('/api/road-corridors')
      .then(r => { if (r.status === 401) { router.replace('/login'); return null }; return r.json() })
      .then(d => {
        if (!d || reqId !== requestIdRef.current) return
        if (d.error) { setError(d.error); return }
        setSummary(d.summary ?? [])
      })
      .catch(() => { if (reqId === requestIdRef.current) setError('Failed to load road corridor summary.') })
      .finally(() => { if (reqId === requestIdRef.current) setLoading(false) })
  }, [router])

  useEffect(() => { loadSummary() }, [loadSummary])

  const byRegion = (r: string) => summary?.find(s => s.region === r)
  const totalSegments = summary?.reduce((a, s) => a + s.segmentCount, 0) ?? 0
  const totalLength = summary?.reduce((a, s) => a + s.totalLengthM, 0) ?? 0
  const activeSummary = region === 'all' ? null : byRegion(region)

  return (
    <div style={{ minHeight: '100%', background: D.bg, color: D.text }}>
      <div style={{ padding: '28px 36px', width: '100%' }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 14, marginBottom: 18 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600, letterSpacing: '-0.01em' }}>Road Corridors</h2>
            <p style={{ margin: 0, marginTop: 3, fontSize: 13, color: D.muted }}>
              Real survey-line data for Calabar, Ogun, and Kebbi — ingested directly from source shapefiles.
            </p>
          </div>
          <a href={EE_APP_URL} target="_blank" rel="noopener noreferrer" style={{
            display: 'inline-flex', alignItems: 'center', gap: 7,
            fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 500,
            color: D.muted, background: 'transparent', border: `1px solid ${D.border}`,
            borderRadius: 8, padding: '6px 11px', textDecoration: 'none',
          }}>
            Compare with the original Earth Engine app ↗
          </a>
        </div>

        {/* Region filter */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 18, flexWrap: 'wrap' }}>
          {REGIONS.map(r => (
            <button key={r.key} onClick={() => setRegion(r.key)} style={{
              display: 'inline-flex', alignItems: 'center', gap: 7,
              fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 600, letterSpacing: 0.3,
              color: region === r.key ? '#000' : D.text,
              background: region === r.key ? D.amber : D.panel2,
              border: `1px solid ${region === r.key ? D.amber : D.border}`,
              borderRadius: 8, padding: '7px 14px', cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}>
              {r.color && <span style={{ width: 8, height: 8, borderRadius: '50%', background: r.color, flexShrink: 0 }} />}
              {r.label}
            </button>
          ))}
        </div>

        {error && (
          <div style={{ padding: 14, borderRadius: 10, background: `${D.red}12`, border: `1px solid ${D.red}3a`, color: D.red, fontFamily: 'var(--font-mono)', fontSize: 12, marginBottom: 18 }}>{error}</div>
        )}

        {/* KPIs — real per-region or combined totals */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14, marginBottom: 18 }}>
          {region === 'all' ? (
            <>
              <KPICard label="Total Segments" value={totalSegments} />
              <KPICard label="Total Length" value={Math.round(totalLength)} suffix=" m" color={D.green} />
              <KPICard label="Regions Covered" value={summary?.length ?? 0} />
              {loadStats && <KPICard label="Map Load" value={loadStats.clientMs} suffix=" ms" />}
            </>
          ) : (
            <>
              <KPICard label={`${region[0].toUpperCase()}${region.slice(1)} Segments`} value={activeSummary?.segmentCount ?? 0} />
              <KPICard label="Total Length" value={Math.round(activeSummary?.totalLengthM ?? 0)} suffix=" m" color={D.green} />
              {loadStats && <KPICard label="Rendered on Map" value={loadStats.segments} />}
              {loadStats && <KPICard label="Query Time" value={loadStats.queryMs} suffix=" ms" />}
            </>
          )}
        </div>

        {/* Map */}
        <div style={{ background: D.panel, border: `1px solid ${D.border}`, borderRadius: 12, boxShadow: SH.card, overflow: 'hidden', height: 'calc(100vh - 340px)', minHeight: 460 }}>
          <RoadCorridorMap region={region} onLoadStats={setLoadStats} />
        </div>

        <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: D.muted, margin: '10px 2px 0', lineHeight: 1.6 }}>
          Segment counts and total length are real aggregates over every ingested survey-line fragment.
          The map itself only ever renders a bounded, zoom-scoped sample (never all {totalSegments.toLocaleString()} at once) — zoom in for denser detail.
          Source: shapefiles ingested via <code>sync_road_corridors.py</code>, not the Earth Engine app above.
        </p>
      </div>
    </div>
  )
}
