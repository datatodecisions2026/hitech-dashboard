'use client'

import dynamic from 'next/dynamic'
const UnifiedMap = dynamic(() => import('@/components/UnifiedMap'), { ssr: false })

import { useEffect, useRef, useState, useCallback, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useTheme } from '@/lib/theme'
import { useMapView } from '@/lib/map-view'

/* ── motion ────────────────────────────────────────────────── */
const EASE = 'cubic-bezier(0.16,1,0.3,1)'

const WEATHER_ICON: Record<string, string> = {
  Sunny: '☀', Clear: '☀', 'Sunny/Cloudy': '🌤', Sunny_cloudy: '🌤',
  Cloudy: '🌥', Overcast: '⛅', Rainy: '🌧', Rain: '🌧',
  Stormy: '⛈', Windy: '💨', Unknown: '—',
}

interface MediaItem { file: string; media_type: string; project_name: string }
interface MapPoint { lat: number; lng: number; lat2: number | null; lng2: number | null; project: string; category: string; status: string }
interface CalDay { date: string; count: number; projects: string[] }
interface DashData {
  summary: { totalReports: number; reportsThisMonth: number; activeProjects: number; totalPhotos: number; uniqueReporters: number; completionRate: number }
  byCategory:   Array<{ name: string; count: number }>
  byProject:    Array<{ name: string; count: number }>
  byDay:        Array<{ date: string; count: number }>
  byWeather:    Array<{ name: string; count: number }>
  byStatus:     Array<{ name: string; count: number }>
  byMachine:    Array<{ name: string; count: number }>
  byEmployee:   Array<{ name: string; count: number }>
  byEngineer:   Array<{ name: string; count: number }>
  bySupervisor: Array<{ name: string; count: number }>
  byOwnership:  Array<{ name: string; count: number }>
  unattributed?: Record<string, number>
  mediaItems:   MediaItem[]
  mapPoints:    MapPoint[]
  activityCalendar: CalDay[]
  recentReports: Array<{
    id: number; date_of_activity: string; reporter_name: string; project_name: string; section_name: string
    activity_category: string; activity_type: string; activity_status: string; comment_activity: string; weather?: string
    start_chainage?: number | null; end_chainage?: number | null
    start_chainage_lat?: string | null; start_chainage_long?: string | null
    end_chainage_lat?: string | null;   end_chainage_long?: string | null
  }>
  filterOptions: { categories: string[]; projects: string[]; sections: string[] }
  activeFilters: {
    filterCategory: string; filterProject: string; filterSection: string; filterDateFrom: string; filterDateTo: string; filterChFrom: string; filterChTo: string; filterSearch: string
    filterWeather: string; filterMachine: string; filterEmployee: string; filterEngineer: string; filterSupervisor: string
  }
}

/* ── animated counter (motion only) ───────────────────────── */
function useCountUp(target: number, duration = 1100, delay = 0) {
  const [val, setVal] = useState(0)
  useEffect(() => {
    if (target === 0) { setVal(0); return }
    const start = Date.now() + delay
    let raf: number
    const tick = () => {
      const p = Math.min(Math.max(0, Date.now() - start) / duration, 1)
      setVal(Math.round((1 - Math.pow(1 - p, 4)) * target))
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, duration, delay])
  return val
}

/* ── primitives ───────────────────────────────────────────── */
function useAccentRGB() {
  const { theme } = useTheme()
  return theme === 'light' ? '3,105,161' : '56,189,248'
}

function EmptyState({ label }: { label: string }) {
  const { colors: D } = useTheme()
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: '28px 0', animation: `fadeIn 0.3s ${EASE}` }}>
      <div style={{ width: 32, height: 32, borderRadius: 8, background: D.panel2, border: `1px solid ${D.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: D.sub }}>
        <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><line x1="9" y1="9" x2="15" y2="15" /><line x1="15" y1="9" x2="9" y2="15" /></svg>
      </div>
      <div style={{ color: D.muted, fontSize: 13, textAlign: 'center' }}>{label}</div>
    </div>
  )
}

function Reveal({ children, delay = 0, style: st }: { children: React.ReactNode; delay?: number; style?: React.CSSProperties }) {
  const ref = useRef<HTMLDivElement>(null)
  const [vis, setVis] = useState(false)
  useEffect(() => {
    const el = ref.current; if (!el) return
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setVis(true); obs.disconnect() } }, { threshold: 0.05 })
    obs.observe(el); return () => obs.disconnect()
  }, [])
  return (
    <div ref={ref} style={{ opacity: vis ? 1 : 0, transform: vis ? 'translateY(0)' : 'translateY(14px)', transition: `opacity 0.5s ease ${delay}ms, transform 0.5s ${EASE} ${delay}ms`, ...st }}>
      {children}
    </div>
  )
}

function Card({ children, title, sub, action, style: st, bodyPad = true }: { children: React.ReactNode; title?: string; sub?: string; action?: React.ReactNode; style?: React.CSSProperties; bodyPad?: boolean }) {
  const { colors: D, shadows: SH } = useTheme()
  return (
    <div className="ui-card" style={{ background: D.panel, border: `1px solid ${D.border}`, borderRadius: 12, boxShadow: SH.card, display: 'flex', flexDirection: 'column', transition: `box-shadow 0.18s ${EASE}, border-color 0.18s ${EASE}, transform 0.18s ${EASE}`, ...st }}>
      {title && (
        <div style={{ padding: '14px 16px 8px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600, letterSpacing: '-0.02em', color: D.text }}>{title}</h3>
            {sub && <div style={{ fontSize: 12, color: D.muted, marginTop: 2, fontFamily: 'var(--font-body)', letterSpacing: 0 }}>{sub}</div>}
          </div>
          {action}
        </div>
      )}
      <div style={{ padding: bodyPad ? (title ? '4px 16px 16px' : 16) : 0 }}>{children}</div>
    </div>
  )
}

function Pill({ kind, children }: { kind: 'ok' | 'accent' | 'crit' | 'mut'; children: React.ReactNode }) {
  const { colors: D } = useTheme()
  const map = {
    ok:     { c: D.green, b: `${D.green}1f` },
    accent: { c: D.amber, b: `${D.amber}1f` },
    crit:   { c: D.red,   b: `${D.red}1f` },
    mut:    { c: D.muted, b: D.panel2 },
  }[kind]
  return (
    <span style={{
      fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase',
      padding: '3px 6px', borderRadius: 5, whiteSpace: 'nowrap',
      color: map.c, background: map.b, border: `1px solid ${kind === 'mut' ? D.border : map.c + '3a'}`,
    }}>{children}</span>
  )
}

/* ── mini KPI grid ────────────────────────────────────────── */
function Mini({ k, value, delay = 0, i = 0 }: { k: string; value: number; delay?: number; i?: number }) {
  const { colors: D } = useTheme()
  const [vis, setVis] = useState(false)
  useEffect(() => { const t = setTimeout(() => setVis(true), delay); return () => clearTimeout(t) }, [delay])
  const shown = useCountUp(vis ? value : 0, 1100)
  return (
    <div className="mini-cell" style={{ paddingLeft: i === 0 ? 0 : 16, borderLeft: i === 0 ? 'none' : `1px solid ${D.border}` }}>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 600, letterSpacing: '0.09em', textTransform: 'uppercase', color: D.muted }}>{k}</div>
      <div style={{ fontFamily: 'var(--font-loader)', fontSize: 27, fontWeight: 600, letterSpacing: '-0.03em', color: D.text, fontVariantNumeric: 'tabular-nums', marginTop: 4, lineHeight: 1.05 }}>
        {shown.toLocaleString()}
      </div>
    </div>
  )
}

/* ── donut (single-hue ramp) ──────────────────────────────── */
function DonutChart({ data, activeName, onSliceClick }: { data: Array<{ name: string; count: number }>; activeName?: string; onSliceClick?: (name: string) => void }) {
  const { colors: D } = useTheme()
  const [ready, setReady] = useState(false)
  const [hov, setHov] = useState<number | null>(null)
  useEffect(() => { const t = setTimeout(() => setReady(true), 180); return () => clearTimeout(t) }, [])
  const RAMP = [D.amber, `${D.amber}c8`, `${D.amber}96`, `${D.amber}64`, D.muted, `${D.muted}b0`, `${D.muted}80`]
  const total = data.reduce((s, d) => s + d.count, 0)
  if (!total) return <EmptyState label="No category data" />
  const r = 78, sw = 24, gap = 2, circ = 2 * Math.PI * r
  let cumLen = 0
  const segments = data.map((d, i) => {
    const len = (d.count / total) * (circ - data.length * gap)
    const s = { ...d, offset: cumLen, len, color: RAMP[i % RAMP.length] }
    cumLen += len + gap
    return s
  })
  const hovSeg = hov !== null ? segments[hov] : null
  const hasActive = !!activeName
  const handleClick = (name: string) => onSliceClick?.(name === activeName ? '' : name)
  return (
    <div style={{ display: 'flex', gap: 24, alignItems: 'center', flexWrap: 'wrap' }}>
      <svg width={180} height={180} viewBox="-95 -95 190 190" style={{ flexShrink: 0 }} onMouseLeave={() => setHov(null)}>
        <circle r={r} fill="none" stroke={D.panel2} strokeWidth={sw} />
        {segments.map((seg, i) => {
          const isHov = hov === i
          const isActive = seg.name === activeName
          return <circle key={i} r={r} fill="none" stroke={seg.color} strokeWidth={isHov || isActive ? sw + 5 : sw}
            strokeDasharray={`${ready ? seg.len : 0} ${circ}`} strokeDashoffset={-(seg.offset)} strokeLinecap="butt"
            strokeOpacity={hasActive ? (isActive ? 1 : 0.2) : (hov !== null && !isHov ? 0.35 : 1)}
            style={{ transition: `stroke-dasharray 0.8s ${EASE} ${i * 0.06}s, stroke-width 0.2s ${EASE}, stroke-opacity 0.2s`, cursor: onSliceClick ? 'pointer' : 'default' }}
            onMouseEnter={() => setHov(i)} onClick={() => handleClick(seg.name)} />
        })}
        {hovSeg ? (<>
          <text x="0" y="-12" textAnchor="middle" fill={D.text} fontFamily="var(--font-loader)" fontSize="22" fontWeight="600">{hovSeg.count}</text>
          <text x="0" y="5" textAnchor="middle" fill={D.muted} fontFamily="var(--font-mono)" fontSize="9">{Math.round(hovSeg.count / total * 100)}%</text>
          <text x="0" y="19" textAnchor="middle" fill={D.sub} fontFamily="var(--font-mono)" fontSize="7.5">{hovSeg.name.length > 15 ? hovSeg.name.slice(0, 14) + '…' : hovSeg.name}</text>
        </>) : (<>
          <text x="0" y="-4" textAnchor="middle" fill={D.text} fontFamily="var(--font-loader)" fontSize="26" fontWeight="600">{total}</text>
          <text x="0" y="14" textAnchor="middle" fill={D.muted} fontFamily="var(--font-mono)" fontSize="8" letterSpacing="1.5">TOTAL</text>
        </>)}
      </svg>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1, minWidth: 150 }}>
        {segments.map((seg, i) => {
          const isHov = hov === i
          const isActive = seg.name === activeName
          return (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: onSliceClick ? 'pointer' : 'default', opacity: hasActive ? (isActive ? 1 : 0.4) : (hov !== null && !isHov ? 0.4 : 1), transition: 'opacity 0.2s' }}
              onMouseEnter={() => setHov(i)} onMouseLeave={() => setHov(null)} onClick={() => handleClick(seg.name)}>
              <div style={{ width: 8, height: 8, borderRadius: 2, background: seg.color, flexShrink: 0 }} />
              <span style={{ fontSize: 12.5, color: isHov || isActive ? D.text : D.muted, flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{seg.name}</span>
              <span style={{ fontSize: 12.5, color: D.text, fontWeight: 600, fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>{seg.count}</span>
              <span style={{ fontSize: 11.5, color: D.sub, fontFamily: 'var(--font-mono)', flexShrink: 0 }}>{Math.round(seg.count / total * 100)}%</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* ── radial progress ──────────────────────────────────────── */
function RingStat({ label, pct, color }: { label: string; pct: number; color: string }) {
  const { colors: D } = useTheme()
  const [ready, setReady] = useState(false)
  useEffect(() => { const t = setTimeout(() => setReady(true), 250); return () => clearTimeout(t) }, [])
  const r = 52, sw = 11, circ = 2 * Math.PI * r
  const offset = circ - (ready ? Math.min(Math.max(pct, 0), 100) / 100 : 0) * circ
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', padding: '8px 0' }}>
      <svg width={132} height={132} viewBox="-66 -66 132 132">
        <circle r={r} fill="none" stroke={D.panel2} strokeWidth={sw} />
        <circle r={r} fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round"
          strokeDasharray={circ} strokeDashoffset={offset} transform="rotate(-90)"
          style={{ transition: `stroke-dashoffset 1s ${EASE}` }} />
        <text x="0" y="0" textAnchor="middle" fill={D.text} fontFamily="var(--font-loader)" fontSize="24" fontWeight="600">{pct}%</text>
        <text x="0" y="18" textAnchor="middle" fill={D.muted} fontFamily="var(--font-mono)" fontSize="7.5" letterSpacing="1">{label.toUpperCase()}</text>
      </svg>
    </div>
  )
}

/* ── timeline bars ────────────────────────────────────────── */
function TimelineChart({ data }: { data: Array<{ date: string; count: number }> }) {
  const { colors: D } = useTheme()
  const [ready, setReady] = useState(false)
  const [hov, setHov] = useState<number | null>(null)
  useEffect(() => { const t = setTimeout(() => setReady(true), 300); return () => clearTimeout(t) }, [])
  const maxVal = Math.max(...data.map(d => d.count), 1)
  const W = 720, H = 150, padL = 28, padB = 28, padR = 6, padT = 10
  const chartW = W - padL - padR, chartH = H - padB - padT
  const barW = Math.max(2, chartW / data.length - 2)
  const step = chartW / data.length
  const gridLines = [0.25, 0.5, 0.75, 1].map(f => Math.round(f * maxVal))
  const fmtD = (d: string) => { const dt = new Date(d); return `${dt.getDate()} ${dt.toLocaleString('en', { month: 'short' })}` }
  return (
    <div style={{ width: '100%', overflowX: 'auto' }}>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ display: 'block', minWidth: 320 }}>
        {gridLines.map((v, gi) => { const y = padT + chartH - (v / maxVal) * chartH; return <g key={gi}><line x1={padL} y1={y} x2={W - padR} y2={y} stroke={D.border} strokeWidth={1} /><text x={padL - 4} y={y + 3} textAnchor="end" fill={D.sub} fontSize="7" fontFamily="var(--font-mono)">{v}</text></g> })}
        <line x1={padL} y1={padT + chartH} x2={W - padR} y2={padT + chartH} stroke={D.border} strokeWidth={1} />
        {data.map((d, i) => {
          const barH = (d.count / maxVal) * chartH
          const x = padL + i * step + (step - barW) / 2
          const y = padT + chartH - barH
          const isHov = hov === i
          return (
            <g key={d.date} onMouseEnter={() => setHov(i)} onMouseLeave={() => setHov(null)}>
              <rect x={x} y={ready ? y : padT + chartH} width={barW} height={ready ? barH : 0} fill={isHov ? D.amberL : D.amber} rx={1.5}
                style={{ transition: `y 0.5s ${EASE} ${i * 0.006}s, height 0.5s ${EASE} ${i * 0.006}s, fill 0.15s` }} />
              {isHov && d.count > 0 && (() => {
                const tx = Math.min(Math.max(x - 22, padL), W - padR - 70)
                const ty = Math.max(padT + 2, y - 26)
                return <g>
                  <rect x={tx} y={ty} width={70} height={19} rx={4} fill={D.panel} stroke={D.border} strokeWidth={1} />
                  <text x={tx + 35} y={ty + 13} textAnchor="middle" fill={D.text} fontSize="9" fontFamily="var(--font-mono)">{fmtD(d.date)}: {d.count}</text>
                </g>
              })()}
            </g>
          )
        })}
        {data.filter((_, i) => i % 5 === 0 || i === data.length - 1).map(d => { const i = data.indexOf(d); return <text key={d.date} x={padL + i * step + step / 2} y={H - 4} textAnchor="middle" fill={D.sub} fontSize="7.5" fontFamily="var(--font-mono)">{fmtD(d.date)}</text> })}
      </svg>
    </div>
  )
}

/* ── horizontal bars ──────────────────────────────────────── */
function HBarChart({ data, activeName, onBarClick }: { data: Array<{ name: string; count: number }>; activeName?: string; onBarClick?: (name: string) => void }) {
  const { colors: D } = useTheme()
  const [ready, setReady] = useState(false)
  const [hov, setHov] = useState<number | null>(null)
  useEffect(() => { const t = setTimeout(() => setReady(true), 250); return () => clearTimeout(t) }, [])
  const max = Math.max(...data.map(d => d.count), 1)
  const total = data.reduce((s, d) => s + d.count, 0) || 1
  const hasActive = !!activeName
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7, width: '100%' }}>
      {data.map((d, i) => {
        const pct = Math.round((d.count / total) * 100)
        const barPct = (d.count / max) * 100
        const isHov = hov === i
        const isTop = i < 3
        const isActive = d.name === activeName
        return (
          <div key={d.name} onMouseEnter={() => setHov(i)} onMouseLeave={() => setHov(null)}
            onClick={() => onBarClick?.(d.name === activeName ? '' : d.name)}
            style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: onBarClick ? 'pointer' : 'default', opacity: hasActive ? (isActive ? 1 : 0.4) : (hov !== null && !isHov ? 0.45 : 1), transition: 'opacity 0.2s' }}>
            <div style={{ width: 18, height: 18, borderRadius: 5, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: isTop ? `${D.amber}14` : 'transparent', border: `1px solid ${isTop ? D.amber + '33' : 'transparent'}`, fontSize: 9, fontFamily: 'var(--font-mono)', color: isTop ? D.amber : D.sub, fontWeight: isTop ? 700 : 400 }}>{i + 1}</div>
            <span style={{ width: 140, fontSize: 12.5, color: isHov || isActive ? D.text : D.muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flexShrink: 0 }} title={d.name}>{d.name}</span>
            <div style={{ flex: 1, height: 5, background: D.panel2, borderRadius: 6, overflow: 'hidden', position: 'relative' }}>
              <div style={{ position: 'absolute', inset: 0, right: 'auto', width: ready ? `${barPct}%` : '0%', background: isTop ? D.amber : `${D.muted}88`, borderRadius: 6, transition: `width 0.8s ${EASE} ${i * 0.03}s` }} />
            </div>
            <span style={{ width: 32, textAlign: 'right', fontSize: 12.5, color: isHov || isActive ? D.amber : D.text, fontWeight: 700, fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>{d.count}</span>
            <span style={{ width: 30, textAlign: 'right', fontSize: 11, color: D.sub, fontFamily: 'var(--font-mono)', flexShrink: 0 }}>{pct}%</span>
          </div>
        )
      })}
    </div>
  )
}

/* ── weather bars (neutral) ───────────────────────────────── */
function WeatherBars({ data, activeName, onBarClick }: { data: Array<{ name: string; count: number }>; activeName?: string; onBarClick?: (name: string) => void }) {
  const { colors: D } = useTheme()
  const [ready, setReady] = useState(false)
  const [hov, setHov] = useState<number | null>(null)
  useEffect(() => { const t = setTimeout(() => setReady(true), 400); return () => clearTimeout(t) }, [])
  const total = data.reduce((s, d) => s + d.count, 0) || 1
  const hasActive = !!activeName
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {data.map((d, i) => {
        const pct = Math.round((d.count / total) * 100)
        const isHov = hov === i
        const isActive = d.name === activeName
        return (
          <div key={d.name} onMouseEnter={() => setHov(i)} onMouseLeave={() => setHov(null)}
            onClick={() => onBarClick?.(d.name === activeName ? '' : d.name)}
            style={{ cursor: onBarClick ? 'pointer' : 'default', opacity: hasActive ? (isActive ? 1 : 0.4) : 1, transition: 'opacity 0.2s' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
              <span style={{ fontSize: 12.5, color: isHov || isActive ? D.text : D.muted, display: 'flex', gap: 7, alignItems: 'center' }}><span>{WEATHER_ICON[d.name] || '🌡'}</span><span>{d.name}</span></span>
              <span style={{ fontSize: 12.5, color: D.text, fontVariantNumeric: 'tabular-nums' }}>{d.count} <span style={{ color: D.sub }}>({pct}%)</span></span>
            </div>
            <div style={{ height: 4, background: D.panel2, borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: ready ? `${pct}%` : '0%', background: isActive || isHov ? D.amber : `${D.muted}99`, borderRadius: 3, transition: `width 0.7s ${EASE} ${i * 0.06}s, background 0.15s` }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

/* ── media gallery ────────────────────────────────────────── */
function MediaGallery({ items, activeFilters }: { items: MediaItem[]; activeFilters: DashData['activeFilters'] }) {
  const hasAnyFilter = !!(
    activeFilters.filterProject || activeFilters.filterCategory || activeFilters.filterSection ||
    activeFilters.filterWeather || activeFilters.filterDateFrom || activeFilters.filterDateTo ||
    activeFilters.filterChFrom || activeFilters.filterChTo || activeFilters.filterSearch ||
    activeFilters.filterMachine || activeFilters.filterEmployee || activeFilters.filterEngineer || activeFilters.filterSupervisor
  )
  const filterKey = JSON.stringify(activeFilters)
  const images = items.filter(m => m.media_type !== 'video')
  const videos = items.filter(m => m.media_type === 'video')
  if (!hasAnyFilter) return <EmptyState label="Select a filter (project, category, section, …) to view site media" />
  if (!images.length && !videos.length) return <EmptyState label="No media matches the active filters" />
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <MediaBox label="Photos" items={images} filterKey={filterKey} />
      <MediaBox label="Videos" items={videos} filterKey={filterKey} />
    </div>
  )
}

function MediaBox({ label, items, filterKey }: { label: string; items: MediaItem[]; filterKey: string }) {
  const { colors: D } = useTheme()
  const [lightbox, setLightbox] = useState<MediaItem | null>(null)
  const [page, setPage] = useState(0)
  const PAGE_SIZE = 12
  const totalPages = Math.ceil(items.length / PAGE_SIZE)
  const pageItems = items.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE)

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setLightbox(null); return }
      if (!lightbox) return
      const idx = items.indexOf(lightbox)
      if (e.key === 'ArrowRight' && idx < items.length - 1) setLightbox(items[idx + 1])
      if (e.key === 'ArrowLeft' && idx > 0) setLightbox(items[idx - 1])
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [lightbox, items])
  useEffect(() => { setPage(0); setLightbox(null) }, [filterKey])

  const pagerBtn: React.CSSProperties = {
    background: D.panel, color: D.text, border: `1px solid ${D.border}`, borderRadius: 8,
    padding: '6px 14px', fontSize: 12, fontFamily: 'var(--font-mono)', cursor: 'pointer', transition: 'background 0.15s',
  }
  return (
    <div style={{ background: D.panel2, border: `1px solid ${D.border}`, borderRadius: 10, padding: 12 }}>
      <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: D.muted, marginBottom: 10, display: 'flex', justifyContent: 'space-between', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
        <span>{label} · {items.length}</span>
        {items.length > 0 && <span style={{ color: D.sub, textTransform: 'none', letterSpacing: 'normal' }}>Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, items.length)} of {items.length}</span>}
      </div>
      {!items.length ? <EmptyState label={`No ${label.toLowerCase()} match the active filters`} /> : (
        <div className="media-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
          {pageItems.map((item, i) => {
            const isVideo = item.media_type === 'video'
            return (
              <div key={`${filterKey}-${page}-${i}`} onClick={() => setLightbox(item)}
                style={{ aspectRatio: '4/3', borderRadius: 8, overflow: 'hidden', cursor: 'pointer', position: 'relative', background: D.panel, border: `1px solid ${D.border}`, transition: 'box-shadow 0.15s' }}
                onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.boxShadow = `0 0 0 2px ${D.amber}` }}
                onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.boxShadow = 'none' }}>
                {isVideo
                  ? <video src={item.file} muted playsInline preload="metadata" onLoadedMetadata={e => { (e.currentTarget as HTMLVideoElement).currentTime = 0.1 }} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', background: '#000' }} />
                  : <img src={item.file} alt="" loading="lazy" decoding="async" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />}
                {isVideo && <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}><div style={{ width: 32, height: 32, borderRadius: '50%', background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><svg width={13} height={13} viewBox="0 0 24 24" fill="#fff"><polygon points="5,3 19,12 5,21" /></svg></div></div>}
              </div>
            )
          })}
        </div>
      )}
      {totalPages > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 14 }}>
          <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} style={{ ...pagerBtn, opacity: page === 0 ? 0.4 : 1, cursor: page === 0 ? 'not-allowed' : 'pointer' }}>‹ Prev</button>
          <span style={{ fontSize: 11, color: D.sub, fontFamily: 'var(--font-mono)' }}>{page + 1} / {totalPages}</span>
          <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page === totalPages - 1} style={{ ...pagerBtn, opacity: page === totalPages - 1 ? 0.4 : 1, cursor: page === totalPages - 1 ? 'not-allowed' : 'pointer' }}>Next ›</button>
        </div>
      )}
      {lightbox && (() => {
        const lbIdx = items.indexOf(lightbox)
        return (
          <div onClick={() => setLightbox(null)} style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.92)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40, backdropFilter: 'blur(8px)', animation: 'fadeIn 0.2s ease' }}>
            {lightbox.media_type === 'video'
              ? <video key={lightbox.file} src={lightbox.file} autoPlay controls playsInline onClick={e => e.stopPropagation()} style={{ maxWidth: '90vw', maxHeight: '88vh', borderRadius: 10 }} />
              : <img src={lightbox.file} alt="" onClick={e => e.stopPropagation()} style={{ maxWidth: '90vw', maxHeight: '88vh', objectFit: 'contain', borderRadius: 10 }} />}
            {lbIdx > 0 && <button onClick={e => { e.stopPropagation(); setLightbox(items[lbIdx - 1]) }} style={{ position: 'absolute', top: '50%', left: 16, transform: 'translateY(-50%)', background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)', color: '#fff', width: 44, height: 44, borderRadius: 10, cursor: 'pointer', fontSize: '1.3rem' }}>‹</button>}
            {lbIdx < items.length - 1 && <button onClick={e => { e.stopPropagation(); setLightbox(items[lbIdx + 1]) }} style={{ position: 'absolute', top: '50%', right: 16, transform: 'translateY(-50%)', background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)', color: '#fff', width: 44, height: 44, borderRadius: 10, cursor: 'pointer', fontSize: '1.3rem' }}>›</button>}
            <div style={{ position: 'absolute', bottom: 20, left: '50%', transform: 'translateX(-50%)', color: 'rgba(255,255,255,0.7)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>{lbIdx + 1} / {items.length}</div>
            <button onClick={() => setLightbox(null)} style={{ position: 'absolute', top: 20, right: 24, background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)', color: '#fff', width: 38, height: 38, borderRadius: 9, cursor: 'pointer', fontSize: '1.1rem' }}>✕</button>
          </div>
        )
      })()}
    </div>
  )
}

/* ── report feed ──────────────────────────────────────────── */
function ReportFeed({ reports, onSelect }: { reports: DashData['recentReports']; onSelect?: (r: DashData['recentReports'][number]) => void }) {
  const { colors: D } = useTheme()
  const [page, setPage] = useState(0)
  const PAGE_SIZE = 15
  useEffect(() => { setPage(0) }, [reports])
  const totalPages = Math.max(1, Math.ceil(reports.length / PAGE_SIZE))
  const pageItems = reports.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE)
  const th: React.CSSProperties = { padding: '8px 12px', textAlign: 'left', color: D.muted, fontFamily: 'var(--font-mono)', fontSize: 10.5, letterSpacing: '0.06em', textTransform: 'uppercase', fontWeight: 600, background: D.panel2, whiteSpace: 'nowrap', borderBottom: `1px solid ${D.border}` }
  const td: React.CSSProperties = { padding: '9px 12px', borderBottom: `1px solid ${D.border}`, whiteSpace: 'nowrap' }
  const statusKind = (s: string): 'ok' | 'accent' | 'mut' => /complete/i.test(s) ? 'ok' : /progress|ongoing/i.test(s) ? 'accent' : 'mut'
  const pagerBtn: React.CSSProperties = { background: D.panel, color: D.text, border: `1px solid ${D.border}`, borderRadius: 8, padding: '6px 14px', fontSize: 12, fontFamily: 'var(--font-mono)', cursor: 'pointer' }
  return (
    <div>
      {reports.length > PAGE_SIZE && (
        <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: D.muted, marginBottom: 10 }}>
          Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, reports.length)} of {reports.length}
        </div>
      )}
      <div style={{ width: '100%', overflowX: 'auto', border: `1px solid ${D.border}`, borderRadius: 10 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, minWidth: 640 }}>
          <thead><tr>{['Date', 'Project', 'Section', 'Category', 'Type', 'Reporter', 'Status'].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
          <tbody>
            {pageItems.map((r, i) => {
              const dt = r.date_of_activity ? new Date(r.date_of_activity).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' }) : '—'
              return (
                <tr key={r.id} className="tbl-row" onClick={() => onSelect?.(r)} title={onSelect ? 'View on map' : undefined}
                  style={{ cursor: onSelect ? 'pointer' : 'default', opacity: 0, animation: `fadeIn 0.3s ${EASE} ${Math.min(i, 12) * 0.03}s forwards` }}>
                  <td style={{ ...td, color: D.muted, fontFamily: 'var(--font-mono)' }}>{dt}</td>
                  <td style={{ ...td, color: D.text, fontWeight: 600, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.project_name || '—'}</td>
                  <td style={{ ...td, color: D.muted, maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.section_name || '—'}</td>
                  <td style={td}>{r.activity_category ? <Pill kind="mut">{r.activity_category}</Pill> : <span style={{ color: D.sub }}>—</span>}</td>
                  <td style={{ ...td, color: D.muted, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.activity_type || '—'}</td>
                  <td style={{ ...td, color: D.text }}>{r.reporter_name || '—'}</td>
                  <td style={td}>{r.activity_status ? <Pill kind={statusKind(r.activity_status)}>{r.activity_status}</Pill> : <span style={{ color: D.sub }}>—</span>}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {totalPages > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 14 }}>
          <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} style={{ ...pagerBtn, opacity: page === 0 ? 0.4 : 1 }}>‹ Prev</button>
          <span style={{ fontSize: 11, color: D.sub, fontFamily: 'var(--font-mono)' }}>{page + 1} / {totalPages}</span>
          <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page === totalPages - 1} style={{ ...pagerBtn, opacity: page === totalPages - 1 ? 0.4 : 1 }}>Next ›</button>
        </div>
      )}
    </div>
  )
}

/* ── activity calendar (accent intensity) ─────────────────── */
function ActivityCalendar({ data }: { data: CalDay[] }) {
  const { colors: D } = useTheme()
  const rgb = useAccentRGB()
  const [hovDay, setHovDay] = useState<(CalDay & { x: number; y: number }) | null>(null)
  if (!data.length) return <EmptyState label="No activity data" />
  const calMap = new Map(data.map(d => [d.date, d]))
  const maxCount = Math.max(...data.map(d => d.count), 1)
  const start = new Date(data[0].date); start.setDate(start.getDate() - start.getDay())
  const end = new Date()
  const CELL = 12, GAP = 2
  const weeks: Date[][] = []
  const cur = new Date(start)
  while (cur <= end) { const week: Date[] = []; for (let d = 0; d < 7; d++) { week.push(new Date(cur)); cur.setDate(cur.getDate() + 1) } weeks.push(week) }
  const monthLabels: { label: string; col: number }[] = []
  weeks.forEach((week, wi) => { const first = week.find(d => d.getDate() <= 7); if (first) monthLabels.push({ label: first.toLocaleString('en', { month: 'short' }), col: wi }) })
  return (
    <div>
      <div style={{ overflowX: 'auto', paddingBottom: 6 }}>
        <div style={{ display: 'flex', gap: GAP, marginBottom: 4, paddingLeft: 22 }}>
          {weeks.map((_, wi) => { const ml = monthLabels.find(m => m.col === wi); return <div key={wi} style={{ width: CELL, flexShrink: 0, fontSize: 8.5, color: ml ? D.muted : 'transparent', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>{ml?.label ?? '.'}</div> })}
        </div>
        <div style={{ display: 'flex', gap: 0 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: GAP, marginRight: 6 }}>
            {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => <div key={i} style={{ width: 14, height: CELL, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', paddingRight: 2, fontSize: 8, color: i % 2 === 0 ? D.sub : 'transparent', fontFamily: 'var(--font-mono)' }}>{d}</div>)}
          </div>
          <div style={{ display: 'flex', gap: GAP }}>
            {weeks.map((week, wi) => (
              <div key={wi} style={{ display: 'flex', flexDirection: 'column', gap: GAP }}>
                {week.map((date, di) => {
                  const key = date.toISOString().split('T')[0]
                  const entry = calMap.get(key)
                  const count = entry?.count ?? 0
                  const isFuture = date > new Date()
                  const intensity = count > 0 ? 0.15 + (count / maxCount) * 0.85 : 0
                  return <div key={di}
                    onMouseEnter={e => { if (!entry) return; const rect = e.currentTarget.getBoundingClientRect(); setHovDay({ ...entry, x: rect.left + rect.width / 2, y: rect.top }) }}
                    onMouseLeave={() => setHovDay(null)}
                    style={{ width: CELL, height: CELL, borderRadius: 2, flexShrink: 0, background: count > 0 ? `rgba(${rgb},${intensity})` : isFuture ? 'transparent' : D.panel2, border: `1px solid ${count > 0 ? `rgba(${rgb},${intensity * 0.6})` : D.border}`, cursor: count > 0 ? 'pointer' : 'default', transition: 'transform 0.12s' }} />
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10 }}>
        <span style={{ fontSize: 9, color: D.sub, fontFamily: 'var(--font-mono)' }}>Less</span>
        {[0, 0.2, 0.45, 0.7, 1].map((v, i) => <div key={i} style={{ width: 10, height: 10, borderRadius: 2, background: v === 0 ? D.panel2 : `rgba(${rgb},${0.15 + v * 0.85})` }} />)}
        <span style={{ fontSize: 9, color: D.sub, fontFamily: 'var(--font-mono)' }}>More</span>
        <span style={{ marginLeft: 'auto', fontSize: 9, color: D.sub, fontFamily: 'var(--font-mono)' }}>{data.length} active days · {data.reduce((s, d) => s + d.count, 0)} reports</span>
      </div>
      {hovDay && <div style={{ position: 'fixed', left: hovDay.x - 85, top: hovDay.y - 84, width: 175, background: D.panel, border: `1px solid ${D.border}`, borderRadius: 8, padding: '8px 12px', pointerEvents: 'none', zIndex: 9100, boxShadow: '0 8px 28px rgba(0,0,0,0.18)' }}>
        <div style={{ fontSize: 10.5, color: D.amber, fontFamily: 'var(--font-mono)', marginBottom: 4 }}>{new Date(hovDay.date + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</div>
        <div style={{ fontSize: 13, color: D.text, fontFamily: 'var(--font-mono)', fontWeight: 700, marginBottom: 4 }}>{hovDay.count} {hovDay.count === 1 ? 'report' : 'reports'}</div>
        {hovDay.projects.length > 0 && <div style={{ fontSize: 10, color: D.muted, fontFamily: 'var(--font-mono)', lineHeight: 1.6 }}>{hovDay.projects.slice(0, 3).join(' · ')}{hovDay.projects.length > 3 ? ` +${hovDay.projects.length - 3} more` : ''}</div>}
      </div>}
    </div>
  )
}

/* ── filter bar ───────────────────────────────────────────── */
function FilterBar({ data, onFilter }: { data: DashData; onFilter: (key: string, val: string) => void }) {
  const { colors: D } = useTheme()
  const active = data.activeFilters
  const hasFilters = !!(active.filterCategory || active.filterProject || active.filterSection || active.filterDateFrom || active.filterDateTo || active.filterChFrom || active.filterChTo || active.filterSearch || active.filterWeather || active.filterMachine || active.filterEmployee || active.filterEngineer || active.filterSupervisor)
  const [chFrom, setChFrom] = useState(active.filterChFrom || '')
  const [chTo, setChTo] = useState(active.filterChTo || '')
  const [search, setSearch] = useState(active.filterSearch || '')
  useEffect(() => { setChFrom(active.filterChFrom || '') }, [active.filterChFrom])
  useEffect(() => { setChTo(active.filterChTo || '') }, [active.filterChTo])
  useEffect(() => { setSearch(active.filterSearch || '') }, [active.filterSearch])
  useEffect(() => {
    const t = setTimeout(() => { if (search !== (active.filterSearch || '')) onFilter('search', search) }, 450)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  const applyChFilter = () => {
    const from = chFrom.trim(), to = chTo.trim()
    if (from && to && !isNaN(Number(from)) && !isNaN(Number(to)) && Number(to) > Number(from))
      onFilter('__ch_range__', `${from},${to}`)
  }

  const field: React.CSSProperties = { font: 'inherit', color: D.text, background: D.panel2, border: `1px solid ${D.border}`, borderRadius: 7, padding: '6px 9px', fontSize: 12.5, outline: 'none' }
  const sel: React.CSSProperties = { ...field, minWidth: 160, cursor: 'pointer' }
  const inp: React.CSSProperties = { ...field, minWidth: 120 }
  const lbl: React.CSSProperties = { fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: D.muted, marginBottom: 5 }

  return (
    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end', padding: '12px 14px', background: D.panel, border: `1px solid ${D.border}`, borderRadius: 10, marginBottom: 20 }}>
      <span style={{ alignSelf: 'center', fontFamily: 'var(--font-mono)', fontSize: 10.5, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase', color: D.muted }}>Filters</span>
      <div style={{ display: 'flex', flexDirection: 'column', flex: '1 1 200px', minWidth: 170 }}>
        <span style={lbl}>Search</span>
        <input type="text" placeholder="Reporter, project, comment…" value={search} onChange={e => setSearch(e.target.value)} style={{ ...inp, width: '100%', minWidth: 0 }} />
      </div>
      {[
        { l: 'Category', el: <select value={active.filterCategory || ''} onChange={e => onFilter('category', e.target.value)} style={sel}><option value="">All Categories</option>{data.filterOptions.categories.map(c => <option key={c} value={c}>{c}</option>)}</select> },
        { l: 'Project', el: <select value={active.filterProject || ''} onChange={e => onFilter('project', e.target.value)} style={sel}><option value="">All Projects</option>{data.filterOptions.projects.map(p => <option key={p} value={p}>{p}</option>)}</select> },
        { l: 'Section', el: <select value={active.filterSection || ''} onChange={e => onFilter('section', e.target.value)} style={sel}><option value="">All Sections</option>{data.filterOptions.sections.map(s => <option key={s} value={s}>{s}</option>)}</select> },
        { l: 'Date From', el: <input type="date" value={active.filterDateFrom || ''} onChange={e => onFilter('date_from', e.target.value)} style={inp} /> },
        { l: 'Date To', el: <input type="date" value={active.filterDateTo || ''} onChange={e => onFilter('date_to', e.target.value)} style={inp} /> },
        { l: 'Chainage From', el: <input type="number" placeholder="20000" value={chFrom} onChange={e => setChFrom(e.target.value)} onBlur={applyChFilter} onKeyDown={e => { if (e.key === 'Enter') applyChFilter() }} style={{ ...inp, minWidth: 110 }} /> },
        { l: 'Chainage To', el: <input type="number" placeholder="30000" value={chTo} onChange={e => setChTo(e.target.value)} onBlur={applyChFilter} onKeyDown={e => { if (e.key === 'Enter') applyChFilter() }} style={{ ...inp, minWidth: 110 }} /> },
      ].map(({ l, el }) => <div key={l} style={{ display: 'flex', flexDirection: 'column' }}><span style={lbl}>{l}</span>{el}</div>)}

      {hasFilters && (
        <button onClick={() => { setChFrom(''); setChTo(''); setSearch(''); onFilter('__clear__', '') }}
          style={{ ...field, color: D.amber, background: 'transparent', border: `1px solid ${D.amber}55`, cursor: 'pointer', fontFamily: 'var(--font-mono)', letterSpacing: '0.04em' }}>✕ Clear</button>
      )}
      {hasFilters && (
        <span style={{ alignSelf: 'center', fontFamily: 'var(--font-mono)', fontSize: 11, color: D.muted, display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 5, height: 5, borderRadius: '50%', background: D.amber, flexShrink: 0 }} />
          <span style={{ color: D.text, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{data.summary.totalReports.toLocaleString()}</span> matched
        </span>
      )}
    </div>
  )
}

/* ── skeleton ─────────────────────────────────────────────── */
function Skel({ h, style: st }: { h: number; style?: React.CSSProperties }) {
  const { colors: D } = useTheme()
  return (
    <div style={{ height: h, borderRadius: 10, background: D.panel, position: 'relative', overflow: 'hidden', border: `1px solid ${D.border}`, ...st }}>
      <div style={{ position: 'absolute', inset: 0, background: `linear-gradient(90deg, transparent 0%, ${D.panel2} 50%, transparent 100%)`, animation: 'shimmer 1.6s ease-in-out infinite' }} />
    </div>
  )
}
function DashSkeleton() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Skel h={110} />
      <div className="grid-responsive" style={{ display: 'grid', gridTemplateColumns: '1fr 2fr 0.8fr', gap: 14 }}><Skel h={230} /><Skel h={230} /><Skel h={230} /></div>
      <div className="grid-responsive" style={{ display: 'grid', gridTemplateColumns: '3fr 2fr', gap: 14 }}><Skel h={200} /><Skel h={200} /></div>
      <Skel h={160} /><Skel h={320} /><Skel h={240} />
    </div>
  )
}

/* ── page ─────────────────────────────────────────────────── */
function DashboardPageInner() {
  const { colors: D, shadows: SH } = useTheme()
  const router = useRouter()
  const searchParams = useSearchParams()
  const [data, setData] = useState<DashData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [firstName, setFirstName] = useState('')
  const { setFocusRequest } = useMapView()
  const requestIdRef = useRef(0)
  const pendingExtraRef = useRef<{ reqId: number; x: Partial<DashData> } | null>(null)
  const mapPanelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetch('/api/auth/me').then(r => r.json()).then(d => { if (d?.user?.first_name) setFirstName(d.user.first_name) }).catch(() => {})
  }, [])

  // Two parallel fetches: /api/dashboard (core: KPIs + charts, clears the
  // skeleton) and /api/dashboard/extra (map points / media / calendar / recent
  // feed, merged in once it lands). See the 2026-09-08 changelog.
  const loadData = useCallback(() => {
    const reqId = ++requestIdRef.current
    setLoading(true)
    pendingExtraRef.current = null
    const suffix = searchParams.toString() ? `?${searchParams.toString()}` : ''
    const EMPTY_HEAVY = { mapPoints: [], mediaItems: [], activityCalendar: [], recentReports: [] }

    fetch(`/api/dashboard${suffix}`)
      .then(r => { if (r.status === 401) { router.replace('/login'); return null } return r.json() })
      .then(d => {
        if (!d || reqId !== requestIdRef.current) return
        if (d.error) { setError(d.error); setLoading(false); return }
        setError('')
        const merged: DashData = { ...EMPTY_HEAVY, ...d }
        if (pendingExtraRef.current?.reqId === reqId) Object.assign(merged, pendingExtraRef.current.x)
        pendingExtraRef.current = null
        setData(merged)
        setLoading(false)
      })
      .catch(() => { if (reqId === requestIdRef.current) { setError('Failed to load dashboard data'); setLoading(false) } })

    fetch(`/api/dashboard/extra${suffix}`)
      .then(r => (r.ok ? r.json() : null))
      .then(x => {
        if (!x || x.error || reqId !== requestIdRef.current) return
        setData(prev => {
          if (!prev) { pendingExtraRef.current = { reqId, x }; return prev }
          return { ...prev, ...x }
        })
      })
      .catch(() => {})
  }, [searchParams, router])

  useEffect(() => { loadData() }, [loadData])

  function handleFilter(key: string, val: string) {
    const p = new URLSearchParams(searchParams.toString())
    if (key === '__clear__') {
      ['category', 'project', 'section', 'date_from', 'date_to', 'ch_from', 'ch_to', 'search', 'weather', 'machine', 'employee', 'engineer', 'supervisor'].forEach(k => p.delete(k))
    } else if (key === '__ch_range__') {
      const [from, to] = val.split(',')
      p.set('ch_from', from); p.set('ch_to', to)
    } else if (val) {
      p.set(key, val)
    } else {
      p.delete(key)
    }
    router.push(`/dashboard?${p.toString()}`)
    if (key === 'category' && val) mapPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  function handleSelectReport(r: DashData['recentReports'][number]) {
    // Zoom the shared map to this report's real location. Calabar/Kebbi/Ogun
    // reports carry real GPS; Section 1 reports are positioned by chainage on
    // the map itself, so passing their raw GPS (also present) is fine here.
    const s = `${r.section_name || ''} ${r.project_name || ''}`.toLowerCase()
    const enableLayer =
      s.includes('calabar') ? 'calabar' as const :
      s.includes('ogun')    ? 'ogun' as const :
      (s.includes('kebbi') || s.includes('sokoto')) ? 'kebbi' as const :
      'reports' as const
    const lat = r.start_chainage_lat  ? parseFloat(r.start_chainage_lat)  : NaN
    const lng = r.start_chainage_long ? parseFloat(r.start_chainage_long) : NaN
    setFocusRequest({
      lat, lng, zoom: 16, reportId: r.id, enableLayer,
      popup: {
        activity_category: r.activity_category, activity_type: r.activity_type,
        activity_status: r.activity_status, reporter_name: r.reporter_name,
        section_name: r.section_name, date_of_activity: r.date_of_activity,
        start_chainage: r.start_chainage, end_chainage: r.end_chainage,
      },
    })
    mapPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
  const latestWeather = data?.recentReports.find(r => r.weather)?.weather

  return (
    <div style={{ minHeight: '100%', background: D.bg, color: D.text }}>
      <div className="dash-content" style={{ padding: '28px 36px', width: '100%' }}>

        <div style={{ marginBottom: 18, display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 22, fontWeight: 600, letterSpacing: '-0.025em', color: D.text }}>{greeting}{firstName ? `, ${firstName}` : ''}</h2>
            <p style={{ margin: 0, marginTop: 4, fontSize: 13, color: D.muted }}>Field-activity overview across all sites.</p>
          </div>
          {latestWeather && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, background: D.panel, border: `1px solid ${D.border}`, borderRadius: 8, padding: '7px 12px' }}>
              <span style={{ fontSize: '1.2rem', lineHeight: 1 }}>{WEATHER_ICON[latestWeather] || '🌡'}</span>
              <div>
                <div style={{ fontSize: 12.5, fontWeight: 600, color: D.text }}>{latestWeather}</div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, color: D.muted, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Latest logged</div>
              </div>
            </div>
          )}
        </div>

        {error && <div style={{ background: `${D.red}12`, border: `1px solid ${D.red}3a`, borderRadius: 10, padding: '12px 16px', color: D.red, fontFamily: 'var(--font-mono)', fontSize: 13, marginBottom: 20 }}>{error}</div>}

        {data && <FilterBar data={data} onFilter={handleFilter} />}
        {loading && !data && <DashSkeleton />}

        {data && (
          <div style={{ opacity: loading ? 0.6 : 1, pointerEvents: loading ? 'none' : 'auto', transition: `opacity 0.25s ${EASE}` }}>

            {/* overview mini-grid */}
            <Card title="Overview" sub="Current activity across every site" style={{ marginBottom: 16 }}>
              <div className="exec-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '18px 0' }}>
                <Mini i={0} k="Total reports" value={data.summary.totalReports} />
                <Mini i={1} k="This month" value={data.summary.reportsThisMonth} delay={60} />
                <Mini i={2} k="Active projects" value={data.summary.activeProjects} delay={120} />
                <Mini i={3} k="Site photos" value={data.summary.totalPhotos} delay={180} />
                <Mini i={4} k="Unique reporters" value={data.summary.uniqueReporters} delay={240} />
                <div className="mini-cell" style={{ paddingLeft: 16, borderLeft: `1px solid ${D.border}` }}>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 600, letterSpacing: '0.09em', textTransform: 'uppercase', color: D.muted }}>Completion</div>
                  <div style={{ fontFamily: 'var(--font-loader)', fontSize: 27, fontWeight: 600, letterSpacing: '-0.03em', color: D.text, fontVariantNumeric: 'tabular-nums', marginTop: 4, lineHeight: 1.05 }}>{data.summary.completionRate}%</div>
                  <div style={{ marginTop: 8, height: 4, borderRadius: 3, background: D.panel2, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${Math.min(100, Math.max(0, data.summary.completionRate))}%`, background: D.green, borderRadius: 3, transition: `width 0.9s ${EASE}` }} />
                  </div>
                </div>
              </div>
            </Card>

            <Reveal style={{ marginBottom: 16 }}>
              <div className="grid-responsive" style={{ display: 'grid', gridTemplateColumns: '1fr 2fr 0.8fr', gap: 14 }}>
                <Card title="Activity by Category"><DonutChart data={data.byCategory} activeName={data.activeFilters.filterCategory} onSliceClick={name => handleFilter('category', name)} /></Card>
                <Card title="Reports per Day" sub="Last 30 days"><TimelineChart data={data.byDay} /></Card>
                <Card title="Completion Rate"><RingStat label="Completed" pct={data.summary.completionRate} color={D.green} /></Card>
              </div>
            </Reveal>

            <Reveal delay={60} style={{ marginBottom: 16 }}>
              <div className="grid-responsive" style={{ display: 'grid', gridTemplateColumns: '3fr 2fr', gap: 14 }}>
                <Card title="Top Projects by Reports"><HBarChart data={data.byProject} activeName={data.activeFilters.filterProject} onBarClick={name => handleFilter('project', name)} /></Card>
                <Card title="Weather Conditions" sub={data.unattributed?.byWeather ? `No weather recorded: ${data.unattributed.byWeather.toLocaleString()} not shown in ranking` : undefined}><WeatherBars data={data.byWeather} activeName={data.activeFilters.filterWeather} onBarClick={name => handleFilter('weather', name)} /></Card>
              </div>
            </Reveal>

            {data.activityCalendar.length > 0 && (
              <Reveal style={{ marginBottom: 16 }}>
                <Card title="Activity Calendar" sub="Full history"><ActivityCalendar data={data.activityCalendar} /></Card>
              </Reveal>
            )}

            <Reveal style={{ marginBottom: 16 }}>
              <div ref={mapPanelRef}>
                <Card title="Activity Map" sub="All sections — road line, activity reports, and surveyed assets" bodyPad={false}>
                  <div style={{ padding: 12 }}>
                    <UnifiedMap
                      chFrom={data.activeFilters.filterChFrom}
                      chTo={data.activeFilters.filterChTo}
                      category={data.activeFilters.filterCategory}
                    />
                  </div>
                </Card>
              </div>
            </Reveal>

            <Reveal style={{ marginBottom: 16 }}>
              <Card title="Site Media" sub={`${data.summary.totalPhotos.toLocaleString()} photos`}>
                <MediaGallery items={data.mediaItems} activeFilters={data.activeFilters} />
              </Card>
            </Reveal>

            {(data.recentReports.length > 0 || Object.values(data.activeFilters).some(Boolean)) && (
              <Reveal>
                <Card title={data.activeFilters.filterSearch ? `Search Results for "${data.activeFilters.filterSearch}"` : 'Recent Activity Reports'}>
                  {data.recentReports.length > 0
                    ? <ReportFeed reports={data.recentReports} onSelect={handleSelectReport} />
                    : <EmptyState label={data.activeFilters.filterSearch ? 'No reports match your search' : 'No reports match your filters'} />}
                </Card>
              </Reveal>
            )}
          </div>
        )}
      </div>

      <style>{`
        @keyframes fadeIn  { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:translateY(0); } }
        @keyframes shimmer { 0% { transform:translateX(-100%); } 100% { transform:translateX(400%); } }
        select:focus, input:focus { border-color: ${D.amber} !important; box-shadow: 0 0 0 3px ${D.amber}22 !important; }
        select option { background: ${D.panel}; color: ${D.text}; }
        input[type='date']::-webkit-calendar-picker-indicator { cursor:pointer; opacity:0.6; }
        .ui-card:hover { box-shadow: ${SH.cardLg}; border-color: ${D.amber}44; transform: translateY(-1px); }
        .tbl-row { transition: background 0.12s ease; }
        .tbl-row:nth-child(even) { background: ${D.panel2}66; }
        .tbl-row:hover { background: ${D.amber}12 !important; }
        @media (max-width: 1200px) {
          .dash-content { padding: 24px 24px !important; }
        }
        @media (max-width: 1024px) {
          .grid-responsive { grid-template-columns: 1fr !important; }
          .exec-grid { grid-template-columns: repeat(3, 1fr) !important; row-gap: 20px !important; }
          .exec-grid .mini-cell:nth-child(3n+1) { border-left: none !important; padding-left: 0 !important; }
        }
        @media (max-width: 640px) {
          .dash-content { padding: 16px !important; }
          .exec-grid { grid-template-columns: repeat(2, 1fr) !important; }
          .exec-grid .mini-cell { border-left: none !important; padding-left: 0 !important; }
          .media-grid { grid-template-columns: repeat(3, 1fr) !important; }
        }
      `}</style>
    </div>
  )
}

export default function DashboardPage() {
  const { colors: D } = useTheme()
  return (
    <Suspense fallback={<div style={{ minHeight: '100vh', background: D.bg, padding: '28px 36px' }}><DashSkeleton /></div>}>
      <DashboardPageInner />
    </Suspense>
  )
}
