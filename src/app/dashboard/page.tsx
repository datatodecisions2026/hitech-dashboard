'use client'



import dynamic from 'next/dynamic'
const HitechMapComponent = dynamic(() => import('@/components/HitechMap'), { ssr: false })

import { useEffect, useRef, useState, useCallback, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

/* ── Design tokens ─────────────────────────────────────────── */
const D = {
  bg:      '#212124',
  panel:   '#1e1e22',
  border:  'rgba(255,255,255,0.045)',
  text:    '#cac6be',
  muted:   '#848080',
  sub:     '#504e54',
  amber:   '#d4a040',
  red:     '#e31c3d',
  green:   '#34d399',
  blue:    '#60a5fa',
}

const SH_RAISED    = '3px 3px 10px rgba(0,0,0,0.78), -1px -1px 4px rgba(255,255,255,0.052), inset 0 1px 0 rgba(255,255,255,0.07)'
const SH_RAISED_LG = '5px 5px 18px rgba(0,0,0,0.82), -2px -2px 6px rgba(255,255,255,0.062), inset 0 1px 0 rgba(255,255,255,0.09)'
const SH_WELL      = 'inset 4px 4px 14px rgba(0,0,0,0.88), inset -1px -1px 3px rgba(255,255,255,0.03)'

const CAT_COLORS = [
  '#d4a040', '#e87040', '#60a5fa', '#34d399',
  '#a78bfa', '#e31c3d', '#f472b6',
]
const PROJECT_COLORS = ['#d4a040', '#60a5fa', '#34d399', '#e87040', '#a78bfa', '#f472b6', '#e31c3d', '#22d3ee']

const WEATHER_ICON: Record<string, string> = {
  Sunny: '☀', Clear: '☀', 'Sunny/Cloudy': '🌤', Sunny_cloudy: '🌤',
  Cloudy: '🌥', Overcast: '⛅', Rainy: '🌧', Rain: '🌧',
  Stormy: '⛈', Windy: '💨', Unknown: '—',
}

/* ── Types ─────────────────────────────────────────────────── */
interface MediaItem { file: string; media_type: string; project_name: string }
interface MapPoint {
  lat: number; lng: number
  lat2: number | null; lng2: number | null
  project: string; category: string; status: string
}
interface CalDay { date: string; count: number; projects: string[] }
interface DashData {
  summary: { totalReports: number; reportsThisMonth: number; activeProjects: number; totalPhotos: number; uniqueReporters: number }
  byCategory:   Array<{ name: string; count: number }>
  byProject:    Array<{ name: string; count: number }>
  byDay:        Array<{ date: string; count: number }>
  byWeather:    Array<{ name: string; count: number }>
  byMachine:    Array<{ name: string; count: number }>
  byEmployee:   Array<{ name: string; count: number }>
  byEngineer:   Array<{ name: string; count: number }>
  bySupervisor: Array<{ name: string; count: number }>
  mediaItems:   MediaItem[]
  mapPoints:    MapPoint[]
  activityCalendar: CalDay[]
  recentReports: Array<{
    id: number; date_of_activity: string; reporter_name: string
    project_name: string; section_name: string; activity_category: string
    activity_type: string; activity_status: string; comment_activity: string
  }>
  filterOptions: { categories: string[]; projects: string[] }
  activeFilters: { filterCategory: string; filterProject: string; filterDateFrom: string; filterDateTo: string }
}

/* ── Count-up hook ─────────────────────────────────────────── */
function useCountUp(target: number, duration = 1100, delay = 0) {
  const [val, setVal] = useState(0)
  useEffect(() => {
    if (target === 0) { setVal(0); return }
    const start = Date.now() + delay
    const tick = () => {
      const elapsed = Math.max(0, Date.now() - start)
      const p = Math.min(elapsed / duration, 1)
      const eased = 1 - Math.pow(1 - p, 3)
      setVal(Math.round(eased * target))
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    let raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, duration, delay])
  return val
}

/* ── Donut chart ───────────────────────────────────────────── */
function DonutChart({ data }: { data: Array<{ name: string; count: number }> }) {
  const [ready, setReady] = useState(false)
  const [hov, setHov] = useState<number | null>(null)
  useEffect(() => { const t = setTimeout(() => setReady(true), 200); return () => clearTimeout(t) }, [])

  const total = data.reduce((s, d) => s + d.count, 0)
  if (!total) return null

  const r = 78, sw = 26, gap = 2
  const circ = 2 * Math.PI * r

  let cumLen = 0
  const segments = data.map((d, i) => {
    const len = (d.count / total) * (circ - data.length * gap)
    const s = { ...d, offset: cumLen, len, color: CAT_COLORS[i % CAT_COLORS.length] }
    cumLen += len + gap
    return s
  })

  const hovSeg = hov !== null ? segments[hov] : null

  return (
    <div style={{ display: 'flex', gap: 28, alignItems: 'center', flexWrap: 'wrap' }}>
      <svg width={190} height={190} viewBox="-95 -95 190 190" style={{ flexShrink: 0, cursor: 'default' }} onMouseLeave={() => setHov(null)}>
        <circle r={r} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth={sw} />
        {segments.map((seg, i) => {
          const isHov = hov === i
          return (
            <circle key={i} r={r} fill="none" stroke={seg.color} strokeWidth={isHov ? sw + 5 : sw}
              strokeDasharray={`${ready ? seg.len : 0} ${circ}`} strokeDashoffset={-(seg.offset)} strokeLinecap="butt"
              strokeOpacity={hov !== null && !isHov ? 0.28 : 1}
              style={{ transition: `stroke-dasharray 0.7s cubic-bezier(0.4,0,0.2,1) ${i * 0.07}s, stroke-width 0.2s ease, stroke-opacity 0.2s ease`, cursor: 'pointer' }}
              onMouseEnter={() => setHov(i)} />
          )
        })}
        {hovSeg ? (
          <>
            <text x="0" y="-14" textAnchor="middle" fill={hovSeg.color} fontFamily="var(--font-loader)" fontSize="22" fontWeight="400">{hovSeg.count}</text>
            <text x="0" y="4" textAnchor="middle" fill={D.text} fontFamily="var(--font-mono)" fontSize="8" letterSpacing="1">{Math.round(hovSeg.count / total * 100)}%</text>
            <text x="0" y="18" textAnchor="middle" fill={D.muted} fontFamily="var(--font-mono)" fontSize="7" letterSpacing="0.5">{hovSeg.name.length > 14 ? hovSeg.name.slice(0, 13) + '…' : hovSeg.name}</text>
          </>
        ) : (
          <>
            <text x="0" y="-6" textAnchor="middle" fill={D.text} fontFamily="var(--font-loader)" fontSize="28" fontWeight="400">{total}</text>
            <text x="0" y="14" textAnchor="middle" fill={D.muted} fontFamily="var(--font-mono)" fontSize="8" letterSpacing="2">TOTAL</text>
          </>
        )}
      </svg>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7, flex: 1, minWidth: 140 }}>
        {segments.map((seg, i) => {
          const isHov = hov === i
          return (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', opacity: hov !== null && !isHov ? 0.35 : 1, transition: 'opacity 0.2s ease' }} onMouseEnter={() => setHov(i)} onMouseLeave={() => setHov(null)}>
              <div style={{ width: 10, height: 10, borderRadius: 2, background: seg.color, flexShrink: 0, transform: isHov ? 'scale(1.35)' : 'scale(1)', transition: 'transform 0.25s cubic-bezier(0.34,1.56,0.64,1)' }} />
              <span style={{ fontSize: '0.72rem', color: isHov ? D.text : D.muted, flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontFamily: 'var(--font-mono)', transition: 'color 0.2s ease' }}>{seg.name}</span>
              <span style={{ fontSize: '0.72rem', color: D.text, fontWeight: 600, fontFamily: 'var(--font-mono)', flexShrink: 0 }}>{seg.count}</span>
              <span style={{ fontSize: '0.65rem', color: D.sub, fontFamily: 'var(--font-mono)', flexShrink: 0 }}>{Math.round(seg.count / total * 100)}%</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* ── Timeline bar chart ────────────────────────────────────── */
function TimelineChart({ data }: { data: Array<{ date: string; count: number }> }) {
  const [ready, setReady] = useState(false)
  const [hov, setHov] = useState<number | null>(null)
  useEffect(() => { const t = setTimeout(() => setReady(true), 400); return () => clearTimeout(t) }, [])

  const maxVal = Math.max(...data.map(d => d.count), 1)
  const W = 720, H = 140, padL = 28, padB = 28, padR = 8, padT = 12
  const chartW = W - padL - padR, chartH = H - padB - padT
  const barW = Math.max(2, chartW / data.length - 2)
  const step = chartW / data.length
  const gridLines = [0.25, 0.5, 0.75, 1].map(f => Math.round(f * maxVal))
  const fmtDate = (d: string) => { const dt = new Date(d); return `${dt.getDate()} ${dt.toLocaleString('en', { month: 'short' })}` }

  return (
    <div style={{ position: 'relative', width: '100%', overflowX: 'auto' }}>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ display: 'block', minWidth: 320 }}>
        <defs>
          <linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={D.amber} stopOpacity="0.9" /><stop offset="100%" stopColor={D.amber} stopOpacity="0.15" /></linearGradient>
          <linearGradient id="barGradHov" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#f0c060" stopOpacity="1" /><stop offset="100%" stopColor={D.amber} stopOpacity="0.3" /></linearGradient>
        </defs>
        {gridLines.map(v => {
          const y = padT + chartH - (v / maxVal) * chartH
          return <g key={v}><line x1={padL} y1={y} x2={W - padR} y2={y} stroke="rgba(255,255,255,0.05)" strokeWidth={1} /><text x={padL - 4} y={y + 3} textAnchor="end" fill={D.sub} fontSize="7" fontFamily="var(--font-mono)">{v}</text></g>
        })}
        <line x1={padL} y1={padT + chartH} x2={W - padR} y2={padT + chartH} stroke="rgba(255,255,255,0.10)" strokeWidth={1} />
        {data.map((d, i) => {
          const barH = (d.count / maxVal) * chartH
          const x = padL + i * step + (step - barW) / 2
          const y = padT + chartH - barH
          const isHov = hov === i
          return (
            <g key={d.date} onMouseEnter={() => setHov(i)} onMouseLeave={() => setHov(null)} style={{ cursor: 'default' }}>
              <rect x={x} y={ready ? y : padT + chartH} width={barW} height={ready ? barH : 0} fill={isHov ? 'url(#barGradHov)' : 'url(#barGrad)'} rx={2} style={{ transition: `y 0.5s cubic-bezier(0.4,0,0.2,1) ${i * 0.01}s, height 0.5s cubic-bezier(0.4,0,0.2,1) ${i * 0.01}s` }} />
              {isHov && d.count > 0 && (() => {
                const tx = Math.min(Math.max(x - 18, padL), W - padR - 60)
                const ty = Math.max(padT + 2, y - 26)
                return <g><rect x={tx} y={ty} width={60} height={18} rx={4} fill="rgba(20,16,10,0.95)" stroke="rgba(255,255,255,0.12)" strokeWidth={1} /><text x={tx + 30} y={ty + 13} textAnchor="middle" fill={D.text} fontSize="8.5" fontFamily="var(--font-mono)">{fmtDate(d.date)}: {d.count}</text></g>
              })()}
            </g>
          )
        })}
        {data.filter((_, i) => i % 5 === 0 || i === data.length - 1).map(d => {
          const i = data.indexOf(d)
          const x = padL + i * step + step / 2
          return <text key={d.date} x={x} y={H - 4} textAnchor="middle" fill={D.sub} fontSize="7.5" fontFamily="var(--font-mono)">{fmtDate(d.date)}</text>
        })}
      </svg>
    </div>
  )
}

/* ── Horizontal bar chart ──────────────────────────────────── */
function HBarChart({ data, color = D.amber }: { data: Array<{ name: string; count: number }>; color?: string }) {
  const [ready, setReady] = useState(false)
  const [hov, setHov] = useState<number | null>(null)
  useEffect(() => { const t = setTimeout(() => setReady(true), 300); return () => clearTimeout(t) }, [])
  const max = Math.max(...data.map(d => d.count), 1)
  const total = data.reduce((s, d) => s + d.count, 0)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width: '100%' }}>
      {data.map((d, i) => {
        const pct = Math.round((d.count / total) * 100)
        const barPct = (d.count / max) * 100
        const isHov = hov === i
        const isTop = i < 3

        return (
          <div
            key={d.name}
            onMouseEnter={() => setHov(i)}
            onMouseLeave={() => setHov(null)}
            style={{ display: 'flex', alignItems: 'center', gap: 10, opacity: hov !== null && !isHov ? 0.45 : 1, transition: 'opacity 0.2s ease' }}
          >
            {/* Rank */}
            <div style={{
              width: 18, height: 18, borderRadius: 4, flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: isTop ? `${color}22` : 'transparent',
              border: isTop ? `1px solid ${color}44` : '1px solid transparent',
              fontSize: 9, fontFamily: 'var(--font-mono)',
              color: isTop ? color : D.sub,
              fontWeight: isTop ? 700 : 400,
            }}>
              {i + 1}
            </div>

            {/* Name */}
            <span style={{
              width: 140, fontSize: '0.7rem', color: isHov ? D.text : D.muted,
              fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap',
              overflow: 'hidden', textOverflow: 'ellipsis', flexShrink: 0,
              transition: 'color 0.2s',
            }} title={d.name}>{d.name}</span>

            {/* Bar track */}
            <div style={{ flex: 1, height: 6, background: 'rgba(255,255,255,0.04)', borderRadius: 6, overflow: 'hidden', position: 'relative' }}>
              {/* Bar fill */}
              <div style={{
                position: 'absolute', inset: 0, right: 'auto',
                width: ready ? `${barPct}%` : '0%',
                background: isTop
                  ? `linear-gradient(90deg, ${color}, ${color}bb)`
                  : `linear-gradient(90deg, ${color}88, ${color}44)`,
                borderRadius: 6,
                transition: `width 0.8s cubic-bezier(0.4,0,0.2,1) ${i * 0.04}s`,
                boxShadow: isTop && isHov ? `0 0 8px ${color}66` : 'none',
              }} />
              {/* Shimmer on top items */}
              {isTop && (
                <div style={{
                  position: 'absolute', inset: 0,
                  background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.08) 50%, transparent 100%)',
                  animation: 'shimmerSlide 2.5s ease-in-out infinite',
                  animationDelay: `${i * 0.4}s`,
                }} />
              )}
            </div>

            {/* Count */}
            <span style={{
              width: 32, textAlign: 'right', fontSize: '0.7rem',
              color: isHov ? color : D.text,
              fontWeight: 700, fontFamily: 'var(--font-mono)', flexShrink: 0,
              transition: 'color 0.2s',
            }}>{d.count}</span>

            {/* Percentage */}
            <span style={{
              width: 30, textAlign: 'right', fontSize: '0.62rem',
              color: D.sub, fontFamily: 'var(--font-mono)', flexShrink: 0,
            }}>{pct}%</span>
          </div>
        )
      })}
    </div>
  )
}

/* ── Weather bars ──────────────────────────────────────────── */
function WeatherBars({ data }: { data: Array<{ name: string; count: number }> }) {
  const [ready, setReady] = useState(false)
  useEffect(() => { const t = setTimeout(() => setReady(true), 500); return () => clearTimeout(t) }, [])
  const total = data.reduce((s, d) => s + d.count, 0) || 1

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {data.map((d, i) => {
        const pct = Math.round((d.count / total) * 100)
        return (
          <div key={d.name}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
              <span style={{ fontSize: '0.72rem', color: D.muted, fontFamily: 'var(--font-mono)', display: 'flex', gap: 6, alignItems: 'center' }}><span>{WEATHER_ICON[d.name] || '🌡'}</span><span>{d.name}</span></span>
              <span style={{ fontSize: '0.72rem', color: D.text, fontFamily: 'var(--font-mono)' }}>{d.count} <span style={{ color: D.sub }}>({pct}%)</span></span>
            </div>
            <div style={{ height: 5, background: 'rgba(255,255,255,0.05)', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: ready ? `${pct}%` : '0%', background: `linear-gradient(90deg, ${D.blue}, ${D.blue}66)`, borderRadius: 3, transition: `width 0.7s cubic-bezier(0.4,0,0.2,1) ${i * 0.08}s` }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

/* ── KPI Card ──────────────────────────────────────────────── */
function KPICard({ label, value, sub, color = D.amber, icon, delay = 0 }: {
  label: string; value: number; sub?: string; color?: string; icon: React.ReactNode; delay?: number
}) {
  const [vis, setVis] = useState(false)
  const [hov, setHov] = useState(false)
  useEffect(() => { const t = setTimeout(() => setVis(true), delay); return () => clearTimeout(t) }, [delay])
  const displayed = useCountUp(vis ? value : 0, 1000, 0)

  return (
    <div onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{ background: hov ? '#2d2d31' : '#272729', border: 'none', borderRadius: 12, padding: '18px 20px', position: 'relative', overflow: 'hidden', opacity: vis ? 1 : 0, transform: vis ? 'translateY(0)' : 'translateY(10px)', transition: 'opacity 0.5s ease, transform 0.5s ease, box-shadow 0.25s ease, background 0.2s ease', boxShadow: hov ? SH_RAISED_LG : SH_RAISED }}>
      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, background: `linear-gradient(180deg, ${color}99 0%, ${color} 50%, ${color}99 100%)`, boxShadow: hov ? `0 0 10px ${color}55` : 'none', borderRadius: '12px 0 0 12px', transition: 'box-shadow 0.25s ease' }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
        <div style={{ width: 36, height: 36, borderRadius: 8, background: '#1e1e22', display: 'flex', alignItems: 'center', justifyContent: 'center', color, boxShadow: 'inset 2px 2px 5px rgba(0,0,0,0.8), inset -1px -1px 2px rgba(255,255,255,0.04)' }}>{icon}</div>
        {sub && <span style={{ fontSize: '0.6rem', color: D.green, fontFamily: 'var(--font-mono)', background: '#1e1e22', padding: '2px 7px', borderRadius: 4, letterSpacing: '0.06em', boxShadow: 'inset 1px 1px 3px rgba(0,0,0,0.7), inset -1px -1px 1px rgba(255,255,255,0.03)' }}>{sub}</span>}
      </div>
      <div style={{ fontFamily: 'var(--font-loader)', fontSize: '2.5rem', fontWeight: 400, lineHeight: 1, letterSpacing: '0.04em', color }}>{displayed.toLocaleString()}</div>
      <div style={{ fontSize: '0.6rem', color: D.sub, fontFamily: 'var(--font-mono)', letterSpacing: '0.12em', textTransform: 'uppercase', marginTop: 7 }}>{label}</div>
    </div>
  )
}

/* ── Media Gallery ─────────────────────────────────────────── */
function MediaGallery({ items, activeProject }: { items: MediaItem[]; activeProject: string }) {
  const [lightbox, setLightbox] = useState<MediaItem | null>(null)
  const [page, setPage] = useState(0)
  const PAGE_SIZE = 12

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setLightbox(null) }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  // Reset page when project changes
  useEffect(() => { setPage(0); setLightbox(null) }, [activeProject])

  if (!activeProject) {
    return (
      <div style={{ color: D.sub, fontSize: '0.8rem', fontFamily: 'var(--font-mono)', padding: '32px 0', textAlign: 'center', letterSpacing: '0.05em' }}>
        Select a project in the filter bar above to view site media
      </div>
    )
  }

  const images = items.filter(m => m.media_type !== 'video')
  const videos = items.filter(m => m.media_type === 'video')
  const sorted = [...images, ...videos]
  const totalPages = Math.ceil(sorted.length / PAGE_SIZE)
  const pageItems = sorted.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE)

  if (sorted.length === 0) {
    return (
      <div style={{ color: D.sub, fontSize: '0.8rem', fontFamily: 'var(--font-mono)', padding: '32px 0', textAlign: 'center' }}>
        No media found for this project
      </div>
    )
  }

  return (
    <>
      {/* Counter */}
      <div style={{ fontSize: '0.68rem', fontFamily: 'var(--font-mono)', color: D.muted, marginBottom: 10, display: 'flex', justifyContent: 'space-between' }}>
        <span>{images.length} photo{images.length !== 1 ? 's' : ''} · {videos.length} video{videos.length !== 1 ? 's' : ''}</span>
        <span style={{ color: D.sub }}>Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, sorted.length)} of {sorted.length}</span>
      </div>

      {/* Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
        {pageItems.map((item, i) => {
          const isVideo = item.media_type === 'video'
          return (
            <div
              key={`${activeProject}-${page}-${i}`}
              onClick={() => setLightbox(item)}
              style={{
                aspectRatio: '4/3', borderRadius: 8, overflow: 'hidden',
                cursor: 'pointer', position: 'relative',
                background: 'rgba(255,255,255,0.04)',
                border: `1px solid ${D.sub}44`,
                transition: 'transform 0.2s ease, box-shadow 0.2s ease',
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLDivElement).style.transform = 'scale(1.03)'
                ;(e.currentTarget as HTMLDivElement).style.boxShadow = `0 8px 24px rgba(0,0,0,0.5), 0 0 0 1px ${D.amber}44`
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLDivElement).style.transform = 'scale(1)'
                ;(e.currentTarget as HTMLDivElement).style.boxShadow = 'none'
              }}
            >
              {isVideo
                ? <video src={item.file} muted playsInline preload="none" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                // eslint-disable-next-line @next/next/no-img-element
                : <img src={item.file} alt="" loading="lazy" decoding="async" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
              }
              {isVideo && (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
                  <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <svg width={14} height={14} viewBox="0 0 24 24" fill={D.amber}><polygon points="5,3 19,12 5,21"/></svg>
                  </div>
                </div>
              )}
              {/* Index badge */}
              <div style={{ position: 'absolute', top: 6, left: 6, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', borderRadius: 4, padding: '2px 7px', fontSize: 10, color: D.muted, fontFamily: 'var(--font-mono)' }}>
                {page * PAGE_SIZE + i + 1}
              </div>
            </div>
          )
        })}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 16 }}>
          <button
            onClick={() => setPage(p => Math.max(0, p - 1))}
            disabled={page === 0}
            style={{ background: page === 0 ? 'transparent' : D.panel, color: page === 0 ? D.sub : D.amber, border: `1px solid ${page === 0 ? D.sub : D.amber}`, borderRadius: 6, padding: '7px 18px', fontSize: 12, cursor: page === 0 ? 'not-allowed' : 'pointer', fontFamily: 'var(--font-mono)', letterSpacing: 1, transition: 'all 0.2s', boxShadow: page === 0 ? 'none' : SH_RAISED }}
          >‹ Prev</button>

          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {Array.from({ length: totalPages }, (_, i) => i)
              .filter(i => i === 0 || i === totalPages - 1 || Math.abs(i - page) <= 2)
              .map((i, idx, arr) => (
                <>
                  {idx > 0 && arr[idx - 1] !== i - 1 && (
                    <span key={`ellipsis-${i}`} style={{ color: D.sub, fontFamily: 'var(--font-mono)', fontSize: 12, padding: '0 4px' }}>…</span>
                  )}
                  <button
                    key={i}
                    onClick={() => setPage(i)}
                    style={{ width: 30, height: 30, borderRadius: 6, border: `1px solid ${i === page ? D.amber : D.sub}`, background: i === page ? D.amber : 'transparent', color: i === page ? '#000' : D.muted, fontSize: 11, cursor: 'pointer', fontFamily: 'var(--font-mono)', fontWeight: i === page ? 700 : 400, transition: 'all 0.2s', boxShadow: i === page ? SH_RAISED : 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                  >{i + 1}</button>
                </>
              ))
            }
          </div>

          <button
            onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
            disabled={page === totalPages - 1}
            style={{ background: page === totalPages - 1 ? 'transparent' : D.panel, color: page === totalPages - 1 ? D.sub : D.amber, border: `1px solid ${page === totalPages - 1 ? D.sub : D.amber}`, borderRadius: 6, padding: '7px 18px', fontSize: 12, cursor: page === totalPages - 1 ? 'not-allowed' : 'pointer', fontFamily: 'var(--font-mono)', letterSpacing: 1, transition: 'all 0.2s', boxShadow: page === totalPages - 1 ? 'none' : SH_RAISED }}
          >Next ›</button>
        </div>
      )}

      {/* Lightbox */}
      {lightbox && (
        <div onClick={() => setLightbox(null)} style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.92)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40, backdropFilter: 'blur(8px)', animation: 'fadeIn 0.2s ease' }}>
          {lightbox.media_type === 'video'
            ? <video key={lightbox.file} src={lightbox.file} autoPlay controls playsInline onClick={e => e.stopPropagation()} style={{ maxWidth: '90vw', maxHeight: '88vh', borderRadius: 10, boxShadow: '0 32px 80px rgba(0,0,0,0.8)' }} />
            // eslint-disable-next-line @next/next/no-img-element
            : <img src={lightbox.file} alt="" onClick={e => e.stopPropagation()} style={{ maxWidth: '90vw', maxHeight: '88vh', objectFit: 'contain', borderRadius: 10, boxShadow: '0 32px 80px rgba(0,0,0,0.8)' }} />
          }
          <button onClick={() => setLightbox(null)} style={{ position: 'absolute', top: 20, right: 24, background: 'rgba(255,255,255,0.08)', border: `1px solid ${D.sub}`, color: D.muted, width: 36, height: 36, borderRadius: 8, cursor: 'pointer', fontSize: '1.1rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
        </div>
      )}
    </>
  )
}


/* ── Report feed ───────────────────────────────────────────── */
function ReportFeed({ reports }: { reports: DashData['recentReports'] }) {
  const STATUS_COLOR: Record<string, string> = { Completed: D.green, Complete: D.green, 'In Progress': D.amber, Ongoing: D.amber, Pending: D.blue, Unknown: D.sub }
  return (
    <div style={{ width: '100%', overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
        <thead>
          <tr>{['Date', 'Project', 'Section', 'Category', 'Type', 'Reporter', 'Status'].map(h => <th key={h} style={{ padding: '10px 14px', textAlign: 'left', color: D.sub, fontFamily: 'var(--font-mono)', fontSize: '0.62rem', letterSpacing: '0.1em', textTransform: 'uppercase', borderBottom: `1px solid ${D.border}`, fontWeight: 500, whiteSpace: 'nowrap' }}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {reports.map((r, i) => {
            const statusColor = STATUS_COLOR[r.activity_status] || D.sub
            const dt = r.date_of_activity ? new Date(r.date_of_activity).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' }) : '—'
            return (
              <tr key={r.id} style={{ borderBottom: `1px solid rgba(255,255,255,0.04)`, opacity: 0, animation: `fadeIn 0.35s ease ${i * 0.05}s forwards` }} onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.03)')} onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                <td style={{ padding: '11px 14px', color: D.muted, fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>{dt}</td>
                <td style={{ padding: '11px 14px', color: D.text, fontWeight: 600, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.project_name || '—'}</td>
                <td style={{ padding: '11px 14px', color: D.muted, maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.section_name || '—'}</td>
                <td style={{ padding: '11px 14px', color: D.muted, whiteSpace: 'nowrap' }}><span style={{ background: `${CAT_COLORS[0]}15`, color: CAT_COLORS[0], border: `1px solid ${CAT_COLORS[0]}30`, padding: '2px 8px', borderRadius: 4, fontFamily: 'var(--font-mono)', fontSize: '0.65rem', letterSpacing: '0.04em' }}>{r.activity_category || '—'}</span></td>
                <td style={{ padding: '11px 14px', color: D.muted, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.activity_type || '—'}</td>
                <td style={{ padding: '11px 14px', color: D.text, whiteSpace: 'nowrap' }}>{r.reporter_name || '—'}</td>
                <td style={{ padding: '11px 14px', whiteSpace: 'nowrap' }}>{r.activity_status ? <span style={{ background: `${statusColor}12`, color: statusColor, border: `1px solid ${statusColor}30`, padding: '2px 8px', borderRadius: 4, fontFamily: 'var(--font-mono)', fontSize: '0.62rem' }}>{r.activity_status}</span> : <span style={{ color: D.sub }}>—</span>}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/* ── Scroll reveal wrapper ─────────────────────────────────── */
function RevealOnScroll({ children, delay = 0, style: st }: { children: React.ReactNode; delay?: number; style?: React.CSSProperties }) {
  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setVisible(true); obs.disconnect() } },
      { threshold: 0.06 }
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [])
  return (
    <div ref={ref} style={{ opacity: visible ? 1 : 0, transform: visible ? 'translateY(0)' : 'translateY(28px)', transition: `opacity 0.55s ease ${delay}ms, transform 0.55s cubic-bezier(0.16,1,0.3,1) ${delay}ms`, ...st }}>
      {children}
    </div>
  )
}

/* ── Panel wrapper ─────────────────────────────────────────── */
function Panel({ children, title, action, style: st }: { children: React.ReactNode; title: string; action?: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ background: '#1e1e22', border: 'none', borderRadius: 12, padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: 18, boxShadow: `${SH_WELL}, 0 1px 0 rgba(255,255,255,0.04)`, animation: 'borderFlicker 14s ease-in-out infinite', ...st }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          {/* Radar ping dot */}
          <div style={{ position: 'relative', width: 7, height: 7, flexShrink: 0 }}>
            <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: D.amber, animation: 'ping 2.8s ease-out infinite', opacity: 0.6 }} />
            <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: D.amber, boxShadow: `0 0 6px ${D.amber}88` }} />
          </div>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.6rem', letterSpacing: '0.14em', textTransform: 'uppercase', color: D.sub, background: '#1a1a1d', padding: '2px 8px', borderRadius: 4, boxShadow: 'inset 1px 1px 3px rgba(0,0,0,0.75), inset -1px -1px 1px rgba(255,255,255,0.03)' }}>{title}</span>
        </div>
        {action}
      </div>
      {children}
    </div>
  )
}

/* ── Activity calendar ─────────────────────────────────────── */
function ActivityCalendar({ data }: { data: CalDay[] }) {
  const [hovDay, setHovDay] = useState<(CalDay & { x: number; y: number }) | null>(null)
  if (!data.length) return <div style={{ color: D.sub, fontSize: '0.72rem', fontFamily: 'var(--font-mono)', padding: '20px 0' }}>No activity data</div>

  const calMap = new Map(data.map(d => [d.date, d]))
  const maxCount = Math.max(...data.map(d => d.count), 1)
  const start = new Date(data[0].date)
  start.setDate(start.getDate() - start.getDay())
  const end = new Date()
  const CELL = 12, GAP = 2
  const weeks: Date[][] = []
  const cur = new Date(start)
  while (cur <= end) {
    const week: Date[] = []
    for (let d = 0; d < 7; d++) { week.push(new Date(cur)); cur.setDate(cur.getDate() + 1) }
    weeks.push(week)
  }
  const monthLabels: { label: string; col: number }[] = []
  weeks.forEach((week, wi) => { const first = week.find(d => d.getDate() <= 7); if (first) monthLabels.push({ label: first.toLocaleString('en', { month: 'short' }), col: wi }) })

  return (
    <div>
      <div style={{ overflowX: 'auto', paddingBottom: 6 }}>
        <div style={{ display: 'flex', gap: GAP, marginBottom: 4, paddingLeft: 22 }}>
          {weeks.map((_, wi) => { const ml = monthLabels.find(m => m.col === wi); return <div key={wi} style={{ width: CELL, flexShrink: 0, fontSize: '0.55rem', color: ml ? D.muted : 'transparent', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>{ml?.label ?? '.'}</div> })}
        </div>
        <div style={{ display: 'flex', gap: 0 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: GAP, marginRight: 6 }}>
            {['S','M','T','W','T','F','S'].map((d, i) => <div key={i} style={{ width: 14, height: CELL, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', paddingRight: 2, fontSize: '0.5rem', color: i % 2 === 0 ? D.sub : 'transparent', fontFamily: 'var(--font-mono)' }}>{d}</div>)}
          </div>
          <div style={{ display: 'flex', gap: GAP }}>
            {weeks.map((week, wi) => (
              <div key={wi} style={{ display: 'flex', flexDirection: 'column', gap: GAP }}>
                {week.map((date, di) => {
                  const key = date.toISOString().split('T')[0]
                  const entry = calMap.get(key)
                  const count = entry?.count ?? 0
                  const isFuture = date > new Date()
                  const intensity = count > 0 ? 0.12 + (count / maxCount) * 0.88 : 0
                  return <div key={di} onMouseEnter={e => { if (!entry) return; const r = e.currentTarget.getBoundingClientRect(); setHovDay({ ...entry, x: r.left + r.width / 2, y: r.top }) }} onMouseLeave={() => setHovDay(null)} style={{ width: CELL, height: CELL, borderRadius: 2, flexShrink: 0, background: count > 0 ? `rgba(212,160,64,${intensity})` : isFuture ? 'transparent' : 'rgba(255,255,255,0.028)', border: count > 0 ? `1px solid rgba(212,160,64,${intensity * 0.55})` : '1px solid rgba(255,255,255,0.04)', cursor: count > 0 ? 'pointer' : 'default', transition: 'background 0.15s, transform 0.15s', boxShadow: count > 0 ? `0 0 ${Math.round(intensity * 8)}px rgba(212,160,64,${intensity * 0.5})` : 'none' }} onMouseOver={e => { if (count > 0) (e.currentTarget as HTMLDivElement).style.transform = 'scale(1.35)' }} onMouseOut={e => { (e.currentTarget as HTMLDivElement).style.transform = 'scale(1)' }} />
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10 }}>
        <span style={{ fontSize: '0.55rem', color: D.sub, fontFamily: 'var(--font-mono)' }}>Less</span>
        {[0, 0.2, 0.45, 0.7, 1].map((v, i) => <div key={i} style={{ width: 10, height: 10, borderRadius: 2, background: v === 0 ? 'rgba(255,255,255,0.028)' : `rgba(212,160,64,${0.12 + v * 0.88})` }} />)}
        <span style={{ fontSize: '0.55rem', color: D.sub, fontFamily: 'var(--font-mono)' }}>More</span>
        <span style={{ marginLeft: 'auto', fontSize: '0.55rem', color: D.sub, fontFamily: 'var(--font-mono)' }}>{data.length} active days · {data.reduce((s, d) => s + d.count, 0)} total reports</span>
      </div>
      {hovDay && <div style={{ position: 'fixed', left: hovDay.x - 85, top: hovDay.y - 86, width: 170, background: 'rgba(10,7,4,0.97)', border: `1px solid ${D.amber}55`, borderRadius: 8, padding: '8px 12px', pointerEvents: 'none', zIndex: 9100, animation: 'fadeIn 0.1s ease', boxShadow: `0 8px 24px rgba(0,0,0,0.6)` }}><div style={{ fontSize: '0.62rem', color: D.amber, fontFamily: 'var(--font-mono)', marginBottom: 4 }}>{new Date(hovDay.date + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</div><div style={{ fontSize: '0.8rem', color: D.text, fontFamily: 'var(--font-mono)', fontWeight: 700, marginBottom: 4 }}>{hovDay.count} {hovDay.count === 1 ? 'report' : 'reports'}</div>{hovDay.projects.length > 0 && <div style={{ fontSize: '0.58rem', color: D.muted, fontFamily: 'var(--font-mono)', lineHeight: 1.6 }}>{hovDay.projects.slice(0, 3).join(' · ')}{hovDay.projects.length > 3 ? ` +${hovDay.projects.length - 3} more` : ''}</div>}</div>}
    </div>
  )
}

/* ── Icons ─────────────────────────────────────────────────── */
const IconDoc     = () => <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
const IconCalendar = () => <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
const IconPin     = () => <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
const IconImage   = () => <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
const IconPeople  = () => <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>

/* ── Filter bar ────────────────────────────────────────────── */
function FilterBar({ data, onFilter }: { data: DashData; onFilter: (key: string, val: string) => void }) {
  const active = data.activeFilters
  const hasFilters = !!(active.filterCategory || active.filterProject || active.filterDateFrom || active.filterDateTo)

  const selectStyle: React.CSSProperties = {
    background: D.bg, color: D.text,
    border: `1px solid ${D.sub}`,
    borderRadius: 6, padding: '6px 10px',
    fontSize: 12, fontFamily: 'var(--font-mono)',
    cursor: 'pointer', minWidth: 160,
    boxShadow: SH_WELL,
  }
  const inputStyle: React.CSSProperties = { ...selectStyle, minWidth: 130 }
  const labelStyle: React.CSSProperties = {
    fontSize: 10, color: D.muted,
    letterSpacing: 1, fontFamily: 'var(--font-mono)',
    textTransform: 'uppercase', marginBottom: 4,
  }

  return (
    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end', padding: '14px 18px', background: D.panel, boxShadow: SH_WELL, borderRadius: 10, marginBottom: 20 }}>

      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <div style={labelStyle}>Category</div>
        <select value={active.filterCategory || ''} onChange={e => onFilter('category', e.target.value)} style={selectStyle}>
          <option value=''>All Categories</option>
          {data.filterOptions.categories.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <div style={labelStyle}>Project</div>
        <select value={active.filterProject || ''} onChange={e => onFilter('project', e.target.value)} style={selectStyle}>
          <option value=''>All Projects</option>
          {data.filterOptions.projects.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <div style={labelStyle}>Date From</div>
        <input type='date' value={active.filterDateFrom || ''} onChange={e => onFilter('date_from', e.target.value)} style={inputStyle} />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <div style={labelStyle}>Date To</div>
        <input type='date' value={active.filterDateTo || ''} onChange={e => onFilter('date_to', e.target.value)} style={inputStyle} />
      </div>

      {hasFilters && (
        <button onClick={() => onFilter('__clear__', '')} style={{ background: 'transparent', color: D.amber, border: `1px solid ${D.amber}`, borderRadius: 6, padding: '6px 16px', fontSize: 12, cursor: 'pointer', fontFamily: 'var(--font-mono)', letterSpacing: 1, alignSelf: 'flex-end' }}>
          ✕ Clear
        </button>
      )}

      {hasFilters && (
        <div style={{ alignSelf: 'flex-end', fontSize: 11, color: D.muted, fontFamily: 'var(--font-mono)' }}>
          Filtered: <span style={{ color: D.amber }}>{data.summary.totalReports.toLocaleString()} reports</span>
        </div>
      )}
    </div>
  )
}

/* ── Dashboard skeleton ────────────────────────────────────── */
function SkeletonBlock({ h, style: st }: { h: number; style?: React.CSSProperties }) {
  return (
    <div style={{ height: h, borderRadius: 12, background: '#1e1e22', position: 'relative', overflow: 'hidden', boxShadow: SH_WELL, ...st }}>
      <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.04) 50%, transparent 100%)', animation: 'shimmerSlide 1.6s ease-in-out infinite' }} />
    </div>
  )
}

function DashboardSkeleton() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* KPI row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 14 }}>
        {[0,1,2,3,4].map(i => <SkeletonBlock key={i} h={100} style={{ animationDelay: `${i * 0.08}s` }} />)}
      </div>
      {/* Charts row 1 */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 14 }}>
        <SkeletonBlock h={240} />
        <SkeletonBlock h={240} style={{ animationDelay: '0.1s' }} />
      </div>
      {/* Charts row 2 */}
      <div style={{ display: 'grid', gridTemplateColumns: '3fr 2fr', gap: 14 }}>
        <SkeletonBlock h={200} style={{ animationDelay: '0.05s' }} />
        <SkeletonBlock h={200} style={{ animationDelay: '0.15s' }} />
      </div>
      {/* HR row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <SkeletonBlock h={180} />
        <SkeletonBlock h={180} style={{ animationDelay: '0.1s' }} />
      </div>
      {/* Calendar + map */}
      <SkeletonBlock h={160} />
      <SkeletonBlock h={300} style={{ animationDelay: '0.05s' }} />
      {/* Recent reports */}
      <SkeletonBlock h={220} />
    </div>
  )
}

/* ── Main page ─────────────────────────────────────────────── */
function DashboardPageInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [data, setData] = useState<DashData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const loadData = useCallback(() => {
    setLoading(true)
    const qs = searchParams.toString()
    fetch(`/api/dashboard${qs ? `?${qs}` : ''}`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false) })
      .catch(() => { setError('Failed to load dashboard data'); setLoading(false) })
  }, [searchParams])

  useEffect(() => { loadData() }, [loadData])

  function handleFilter(key: string, val: string) {
    const params = new URLSearchParams(searchParams.toString())
    if (key === '__clear__') {
      params.delete('category')
      params.delete('project')
      params.delete('date_from')
      params.delete('date_to')
    } else if (val) {
      params.set(key, val)
    } else {
      params.delete(key)
    }
    router.push(`/dashboard?${params.toString()}`)
  }

  return (
    <div style={{ minHeight: '100vh', background: D.bg, color: D.text, fontFamily: 'var(--font-dm-sans)', backgroundImage: 'repeating-linear-gradient(90deg, transparent 0px, transparent 5px, rgba(255,255,255,0.005) 5px, rgba(255,255,255,0.005) 6px)', position: 'relative' }}>

      {/* ── Ambient background layer ── */}
      <div style={{ position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none', overflow: 'hidden' }}>
        {/* Drifting glow orbs */}
        <div style={{ position: 'absolute', width: 700, height: 700, borderRadius: '50%', background: 'radial-gradient(circle, rgba(212,160,64,0.028) 0%, transparent 68%)', top: '5%', left: '55%', animation: 'floatY 22s ease-in-out infinite' }} />
        <div style={{ position: 'absolute', width: 500, height: 500, borderRadius: '50%', background: 'radial-gradient(circle, rgba(96,165,250,0.022) 0%, transparent 68%)', top: '45%', left: '10%', animation: 'floatY 28s ease-in-out infinite reverse' }} />
        <div style={{ position: 'absolute', width: 350, height: 350, borderRadius: '50%', background: 'radial-gradient(circle, rgba(52,211,153,0.018) 0%, transparent 68%)', top: '72%', left: '78%', animation: 'floatY 19s ease-in-out infinite 6s' }} />
        {/* Scan line */}
        <div style={{ position: 'absolute', left: 0, right: 0, height: 1, background: 'linear-gradient(90deg, transparent 0%, rgba(212,160,64,0.03) 15%, rgba(212,160,64,0.10) 50%, rgba(212,160,64,0.03) 85%, transparent 100%)', animation: 'scanLine 14s linear infinite' }} />
      </div>

      {/* Sub-header */}
      <div style={{ position: 'sticky', top: 52, zIndex: 50, background: '#1c1c1f', boxShadow: '0 3px 12px rgba(0,0,0,0.65), 0 1px 0 rgba(255,255,255,0.04), inset 0 -1px 0 rgba(0,0,0,0.5)', padding: '0 32px', display: 'flex', alignItems: 'center', gap: 18, height: 44, overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <span style={{ fontFamily: 'var(--font-loader)', fontSize: '1.1rem', letterSpacing: '0.1em', color: D.amber }}>ANALYTICS</span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.55rem', letterSpacing: '0.12em', color: D.sub, textTransform: 'uppercase' }}>Site Command</span>
        </div>
        {/* Live status dot */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ position: 'relative', width: 6, height: 6 }}>
            <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: D.green, animation: 'ping 2.4s ease-out infinite', opacity: 0.5 }} />
            <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: D.green }} />
          </div>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.52rem', color: D.green, letterSpacing: '0.12em' }}>LIVE</span>
        </div>
        {/* Scrolling ticker */}
        {data && (
          <div style={{ flex: 1, overflow: 'hidden', maskImage: 'linear-gradient(90deg, transparent, black 8%, black 92%, transparent)', WebkitMaskImage: 'linear-gradient(90deg, transparent, black 8%, black 92%, transparent)' }}>
            <div style={{ display: 'flex', gap: 48, whiteSpace: 'nowrap', animation: 'dataTickerScroll 32s linear infinite', width: 'max-content' }}>
              {[
                `${data.summary.totalReports.toLocaleString()} TOTAL REPORTS`,
                `${data.summary.reportsThisMonth} THIS MONTH`,
                `${data.summary.activeProjects} ACTIVE PROJECTS`,
                `${data.summary.uniqueReporters} REPORTERS`,
                `${data.summary.totalPhotos.toLocaleString()} PHOTOS`,
                ...(data.activeFilters.filterProject ? [`FILTERED: ${data.activeFilters.filterProject.toUpperCase()}`] : []),
                // duplicate for seamless loop
                `${data.summary.totalReports.toLocaleString()} TOTAL REPORTS`,
                `${data.summary.reportsThisMonth} THIS MONTH`,
                `${data.summary.activeProjects} ACTIVE PROJECTS`,
                `${data.summary.uniqueReporters} REPORTERS`,
                `${data.summary.totalPhotos.toLocaleString()} PHOTOS`,
                ...(data.activeFilters.filterProject ? [`FILTERED: ${data.activeFilters.filterProject.toUpperCase()}`] : []),
              ].map((item, i) => (
                <span key={i} style={{ fontFamily: 'var(--font-mono)', fontSize: '0.52rem', color: item.startsWith('FILTERED') ? D.amber : D.sub, letterSpacing: '0.1em' }}>
                  {item.startsWith('FILTERED') ? '' : '◆ '}{item}
                </span>
              ))}
            </div>
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginLeft: 'auto' }}>
          {loading && <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.58rem', color: D.amber, letterSpacing: '0.08em', display: 'flex', alignItems: 'center', gap: 5 }}><div style={{ width: 5, height: 5, borderRadius: '50%', background: D.amber, animation: 'amberPulse 1.2s ease-in-out infinite' }} />LOADING</div>}
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.58rem', color: D.sub, letterSpacing: '0.06em' }}>{new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</div>
        </div>
      </div>

      {/* Content */}
      <div style={{ padding: '28px 32px 60px', maxWidth: 1440, margin: '0 auto', position: 'relative', zIndex: 1 }}>

        {error && <div style={{ background: 'rgba(227,28,61,0.08)', border: '1px solid rgba(227,28,61,0.25)', borderRadius: 10, padding: '14px 18px', color: '#f87171', fontFamily: 'var(--font-mono)', fontSize: '0.78rem', marginBottom: 24 }}>{error}</div>}

        {/* Filter bar — always visible when data exists so users can change filters during load */}
        {data && <FilterBar data={data} onFilter={handleFilter} />}

        {/* Skeleton while loading (initial load or filter refresh) */}
        {loading && <DashboardSkeleton />}

        {/* Content — only rendered when not loading */}
        {!loading && data && (<>

          {/* KPI Row */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 14, marginBottom: 20 }}>
            <KPICard label="Total Activity Reports" value={data.summary.totalReports}     icon={<IconDoc />}      delay={0}   color={D.amber} />
            <KPICard label="Reports This Month"     value={data.summary.reportsThisMonth} icon={<IconCalendar />} delay={80}  color={D.blue} sub="MTD" />
            <KPICard label="Active Projects (30d)"  value={data.summary.activeProjects}   icon={<IconPin />}      delay={160} color={D.green} />
            <KPICard label="Site Photos"            value={data.summary.totalPhotos}      icon={<IconImage />}    delay={240} color="#a78bfa" />
            <KPICard label="Unique Reporters"       value={data.summary.uniqueReporters}  icon={<IconPeople />}   delay={320} color={D.amber} />
          </div>

          {/* Charts Row 1 */}
          <RevealOnScroll style={{ marginBottom: 14 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 14 }}>
              <Panel title="Activity by Category"><DonutChart data={data.byCategory} /></Panel>
              <Panel title="Reports per Day — last 30 days"><TimelineChart data={data.byDay} /></Panel>
            </div>
          </RevealOnScroll>

          {/* Charts Row 2 */}
          <RevealOnScroll delay={60} style={{ marginBottom: 14 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '3fr 2fr', gap: 14 }}>
              <Panel title="Top Projects by Reports"><HBarChart data={data.byProject} /></Panel>
              <Panel title="Weather Conditions"><WeatherBars data={data.byWeather} /></Panel>
            </div>
          </RevealOnScroll>

          {/* HR Charts Row */}
          {(data.byMachine?.length > 0 || data.byEmployee?.length > 0) && (
            <RevealOnScroll delay={60} style={{ marginBottom: 14 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                {data.byMachine?.length > 0 && <Panel title="Machines Used"><HBarChart data={data.byMachine} color={D.amber} /></Panel>}
                {data.byEmployee?.length > 0 && <Panel title="Top Employees"><HBarChart data={data.byEmployee} color={D.green} /></Panel>}
              </div>
            </RevealOnScroll>
          )}

          {(data.byEngineer?.length > 0 || data.bySupervisor?.length > 0) && (
            <RevealOnScroll delay={60} style={{ marginBottom: 14 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                {data.byEngineer?.length > 0   && <Panel title="Engineers Activity"><HBarChart data={data.byEngineer} color={D.blue} /></Panel>}
                {data.bySupervisor?.length > 0 && <Panel title="Supervisors Activity"><HBarChart data={data.bySupervisor} color="#a78bfa" /></Panel>}
              </div>
            </RevealOnScroll>
          )}

          {/* Activity Calendar */}
          {data.activityCalendar.length > 0 && (
            <RevealOnScroll style={{ marginBottom: 14 }}>
              <Panel title="Activity Calendar — full history">
                <ActivityCalendar data={data.activityCalendar} />
              </Panel>
            </RevealOnScroll>
          )}

          {/* Activity Map */}
          {/* Activity Map — Mapbox */}
          <RevealOnScroll style={{ marginBottom: 14 }}>
            <Panel title="Activity Map — GPS coordinates by project">
              <HitechMapComponent project={data.activeFilters.filterProject || 'Coastal Road'} />
            </Panel>
          </RevealOnScroll>

          {/* Media Gallery */}
          <RevealOnScroll style={{ marginBottom: 14 }}>
            <Panel title={`Site Media — ${data.summary.totalPhotos.toLocaleString()} photos`}>
              <MediaGallery items={data.mediaItems} activeProject={data.activeFilters.filterProject} />
            </Panel>
          </RevealOnScroll>

          {/* Recent Reports */}
          {data.recentReports.length > 0 && (
            <RevealOnScroll>
              <Panel title="Recent Activity Reports">
                <ReportFeed reports={data.recentReports} />
              </Panel>
            </RevealOnScroll>
          )}

        </>)}
      </div>

      <style>{`
        @keyframes fadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes shimmerSlide { 0% { transform: translateX(-100%); } 100% { transform: translateX(400%); } }
        @keyframes amberPulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
        select option { background: #212124; }
        input[type='date']::-webkit-calendar-picker-indicator { filter: invert(0.6); cursor: pointer; }
      `}</style>
    </div>
  )
}

export default function DashboardPage() {
  return (
    <Suspense fallback={<div style={{ minHeight: '100vh', background: '#212124', padding: '96px 32px 60px' }}><DashboardSkeleton /></div>}>
      <DashboardPageInner />
    </Suspense>
  )
}