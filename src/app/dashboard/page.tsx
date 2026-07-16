'use client'

import dynamic from 'next/dynamic'
const HitechMapComponent = dynamic(() => import('@/components/HitechMap'), { ssr: false })

import { useEffect, useRef, useState, useCallback, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

const D = {
  bg:     '#0e0e10',
  panel:  '#141416',
  panel2: '#1a1a1e',
  border: 'rgba(255,255,255,0.06)',
  text:   '#e8e2d8',
  muted:  '#7a7570',
  sub:    '#3d3b42',
  amber:  '#d4a040',
  amberL: '#f0c060',
  red:    '#f87171',
  green:  '#34d399',
  blue:   '#60a5fa',
}

const SH_CARD   = '0 4px 20px rgba(0,0,0,0.7), 0 1px 0 rgba(255,255,255,0.05)'
const SH_CARDLG = '0 8px 32px rgba(0,0,0,0.8), 0 1px 0 rgba(255,255,255,0.06), 0 0 24px rgba(212,160,64,0.06)'
const SH_PANEL  = '0 4px 24px rgba(0,0,0,0.6), 0 1px 0 rgba(255,255,255,0.04), inset 0 1px 0 rgba(255,255,255,0.03)'

const CAT_COLORS = ['#d4a040','#e87040','#60a5fa','#34d399','#a78bfa','#f87171','#f472b6']

const WEATHER_ICON: Record<string,string> = {
  Sunny:'☀', Clear:'☀', 'Sunny/Cloudy':'🌤', Sunny_cloudy:'🌤',
  Cloudy:'🌥', Overcast:'⛅', Rainy:'🌧', Rain:'🌧',
  Stormy:'⛈', Windy:'💨', Unknown:'—',
}

interface MediaItem { file: string; media_type: string; project_name: string }
interface MapPoint { lat: number; lng: number; lat2: number | null; lng2: number | null; project: string; category: string; status: string }
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
  recentReports: Array<{ id: number; date_of_activity: string; reporter_name: string; project_name: string; section_name: string; activity_category: string; activity_type: string; activity_status: string; comment_activity: string }>
  filterOptions: { categories: string[]; projects: string[] }
  activeFilters: {
    filterCategory: string; filterProject: string; filterDateFrom: string; filterDateTo: string; filterChFrom: string; filterChTo: string; filterSearch: string
    filterWeather: string; filterMachine: string; filterEmployee: string; filterEngineer: string; filterSupervisor: string
  }
}

/* ── Animated counter ──────────────────────────────────────── */
function useCountUp(target: number, duration = 1200, delay = 0) {
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

/* ── Reveal on scroll ──────────────────────────────────────── */
function Reveal({ children, delay = 0, style: st }: { children: React.ReactNode; delay?: number; style?: React.CSSProperties }) {
  const ref = useRef<HTMLDivElement>(null)
  const [vis, setVis] = useState(false)
  useEffect(() => {
    const el = ref.current; if (!el) return
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setVis(true); obs.disconnect() } }, { threshold: 0.05 })
    obs.observe(el); return () => obs.disconnect()
  }, [])
  return (
    <div ref={ref} style={{ opacity: vis ? 1 : 0, transform: vis ? 'translateY(0)' : 'translateY(22px)', transition: `opacity 0.6s ease ${delay}ms, transform 0.6s cubic-bezier(0.16,1,0.3,1) ${delay}ms`, ...st }}>
      {children}
    </div>
  )
}

/* ── Panel ─────────────────────────────────────────────────── */
function Panel({ children, title, action, style: st }: { children: React.ReactNode; title: string; action?: React.ReactNode; style?: React.CSSProperties }) {
  const [hov, setHov] = useState(false)
  return (
    <div onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{ background: D.panel, borderRadius: 16, padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: 18, border: hov ? '1px solid rgba(212,160,64,0.15)' : `1px solid ${D.border}`, boxShadow: hov ? `${SH_PANEL}, 0 0 40px rgba(212,160,64,0.04)` : SH_PANEL, transition: 'border-color 0.3s, box-shadow 0.3s', ...st }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ position: 'relative', width: 7, height: 7, flexShrink: 0 }}>
            <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: D.amber, animation: 'pingAnim 3s ease-out infinite', opacity: 0.5 }} />
            <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: D.amber, boxShadow: `0 0 6px ${D.amber}` }} />
          </div>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.58rem', letterSpacing: '0.16em', textTransform: 'uppercase', color: D.muted, background: '#0e0e10', padding: '2px 10px', borderRadius: 4, border: `1px solid ${D.border}` }}>{title}</span>
        </div>
        {action}
      </div>
      {children}
    </div>
  )
}

/* ── KPI Card ──────────────────────────────────────────────── */
function KPICard({ label, value, sub, color = D.amber, icon, delay = 0 }: { label: string; value: number; sub?: string; color?: string; icon: React.ReactNode; delay?: number }) {
  const [vis, setVis] = useState(false)
  const [hov, setHov] = useState(false)
  useEffect(() => { const t = setTimeout(() => setVis(true), delay + 80); return () => clearTimeout(t) }, [delay])
  const displayed = useCountUp(vis ? value : 0, 1300, 0)
  return (
    <div onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{ background: hov ? D.panel2 : D.panel, borderRadius: 16, padding: '18px 20px', position: 'relative', overflow: 'hidden', opacity: vis ? 1 : 0, transform: vis ? 'translateY(0) scale(1)' : 'translateY(14px) scale(0.97)', transition: `opacity 0.6s ease ${delay}ms, transform 0.6s cubic-bezier(0.16,1,0.3,1) ${delay}ms, border-color 0.3s, box-shadow 0.3s`, border: hov ? `1px solid rgba(212,160,64,0.2)` : `1px solid ${D.border}`, boxShadow: hov ? SH_CARDLG : SH_CARD }}>
      {/* Left accent */}
      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 2, background: `linear-gradient(180deg, transparent, ${color}, transparent)`, opacity: hov ? 1 : 0.5, transition: 'opacity 0.3s' }} />
      {/* Corner glow */}
      <div style={{ position: 'absolute', top: -24, right: -24, width: 90, height: 90, borderRadius: '50%', background: `radial-gradient(circle, ${color}15 0%, transparent 70%)`, pointerEvents: 'none' }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
        <div style={{ width: 38, height: 38, borderRadius: 10, background: `${color}12`, border: `1px solid ${color}22`, display: 'flex', alignItems: 'center', justifyContent: 'center', color }}>{icon}</div>
        {sub && <span style={{ fontSize: '0.58rem', color: D.green, fontFamily: 'var(--font-mono)', background: 'rgba(52,211,153,0.1)', border: '1px solid rgba(52,211,153,0.2)', padding: '2px 8px', borderRadius: 4, letterSpacing: '0.08em' }}>{sub}</span>}
      </div>
      <div style={{ fontFamily: 'var(--font-loader)', fontSize: '2.5rem', fontWeight: 400, lineHeight: 1, letterSpacing: '0.03em', color, textShadow: hov ? `0 0 24px ${color}44` : 'none', transition: 'text-shadow 0.3s' }}>{displayed.toLocaleString()}</div>
      <div style={{ fontSize: '0.58rem', color: D.muted, fontFamily: 'var(--font-mono)', letterSpacing: '0.14em', textTransform: 'uppercase', marginTop: 8 }}>{label}</div>
    </div>
  )
}

/* ── Donut chart ───────────────────────────────────────────── */
function DonutChart({ data, activeName, onSliceClick }: { data: Array<{ name: string; count: number }>; activeName?: string; onSliceClick?: (name: string) => void }) {
  const [ready, setReady] = useState(false)
  const [hov, setHov] = useState<number | null>(null)
  useEffect(() => { const t = setTimeout(() => setReady(true), 200); return () => clearTimeout(t) }, [])
  const total = data.reduce((s, d) => s + d.count, 0)
  if (!total) return null
  const r = 78, sw = 26, gap = 2, circ = 2 * Math.PI * r
  let cumLen = 0
  const segments = data.map((d, i) => {
    const len = (d.count / total) * (circ - data.length * gap)
    const s = { ...d, offset: cumLen, len, color: CAT_COLORS[i % CAT_COLORS.length] }
    cumLen += len + gap
    return s
  })
  const hovSeg = hov !== null ? segments[hov] : null
  const hasActive = !!activeName
  const handleClick = (name: string) => onSliceClick?.(name === activeName ? '' : name)
  return (
    <div style={{ display: 'flex', gap: 28, alignItems: 'center', flexWrap: 'wrap' }}>
      <svg width={190} height={190} viewBox="-95 -95 190 190" style={{ flexShrink: 0 }} onMouseLeave={() => setHov(null)}>
        <circle r={r} fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth={sw} />
        {segments.map((seg, i) => {
          const isHov = hov === i
          const isActive = seg.name === activeName
          return <circle key={i} r={r} fill="none" stroke={seg.color} strokeWidth={isHov || isActive ? sw + 6 : sw}
            strokeDasharray={`${ready ? seg.len : 0} ${circ}`} strokeDashoffset={-(seg.offset)} strokeLinecap="butt"
            strokeOpacity={hasActive ? (isActive ? 1 : 0.18) : (hov !== null && !isHov ? 0.22 : 1)}
            style={{ transition: `stroke-dasharray 0.8s cubic-bezier(0.16,1,0.3,1) ${i * 0.07}s, stroke-width 0.2s, stroke-opacity 0.2s`, cursor: onSliceClick ? 'pointer' : 'default', filter: isHov || isActive ? `drop-shadow(0 0 6px ${seg.color}88)` : 'none' }}
            onMouseEnter={() => setHov(i)} onClick={() => handleClick(seg.name)} />
        })}
        {hovSeg ? (<>
          <text x="0" y="-14" textAnchor="middle" fill={hovSeg.color} fontFamily="var(--font-loader)" fontSize="22">{hovSeg.count}</text>
          <text x="0" y="4"  textAnchor="middle" fill={D.text} fontFamily="var(--font-mono)" fontSize="8" letterSpacing="1">{Math.round(hovSeg.count / total * 100)}%</text>
          <text x="0" y="18" textAnchor="middle" fill={D.muted} fontFamily="var(--font-mono)" fontSize="7">{hovSeg.name.length > 14 ? hovSeg.name.slice(0,13)+'…' : hovSeg.name}</text>
        </>) : (<>
          <text x="0" y="-6" textAnchor="middle" fill={D.text} fontFamily="var(--font-loader)" fontSize="28">{total}</text>
          <text x="0" y="14" textAnchor="middle" fill={D.muted} fontFamily="var(--font-mono)" fontSize="8" letterSpacing="2">TOTAL</text>
        </>)}
      </svg>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7, flex: 1, minWidth: 140 }}>
        {segments.map((seg, i) => {
          const isHov = hov === i
          const isActive = seg.name === activeName
          return (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: onSliceClick ? 'pointer' : 'default', opacity: hasActive ? (isActive ? 1 : 0.35) : (hov !== null && !isHov ? 0.3 : 1), transition: 'opacity 0.2s' }}
              onMouseEnter={() => setHov(i)} onMouseLeave={() => setHov(null)} onClick={() => handleClick(seg.name)}>
              <div style={{ width: 8, height: 8, borderRadius: 2, background: seg.color, flexShrink: 0, transform: isHov || isActive ? 'scale(1.4)' : 'scale(1)', boxShadow: isHov || isActive ? `0 0 8px ${seg.color}` : 'none', transition: 'transform 0.25s cubic-bezier(0.34,1.56,0.64,1), box-shadow 0.2s' }} />
              <span style={{ fontSize: '0.7rem', color: isHov || isActive ? D.text : D.muted, flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontFamily: 'var(--font-mono)', transition: 'color 0.2s' }}>{seg.name}</span>
              <span style={{ fontSize: '0.7rem', color: D.text, fontWeight: 600, fontFamily: 'var(--font-mono)', flexShrink: 0 }}>{seg.count}</span>
              <span style={{ fontSize: '0.62rem', color: D.sub, fontFamily: 'var(--font-mono)', flexShrink: 0 }}>{Math.round(seg.count / total * 100)}%</span>
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
  const W = 720, H = 150, padL = 30, padB = 30, padR = 8, padT = 12
  const chartW = W - padL - padR, chartH = H - padB - padT
  const barW = Math.max(2, chartW / data.length - 2)
  const step = chartW / data.length
  const gridLines = [0.25, 0.5, 0.75, 1].map(f => Math.round(f * maxVal))
  const fmtD = (d: string) => { const dt = new Date(d); return `${dt.getDate()} ${dt.toLocaleString('en', { month: 'short' })}` }
  return (
    <div style={{ width: '100%', overflowX: 'auto' }}>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ display: 'block', minWidth: 320 }}>
        <defs>
          <linearGradient id="bGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={D.amber} stopOpacity="0.9"/>
            <stop offset="100%" stopColor={D.amber} stopOpacity="0.1"/>
          </linearGradient>
          <linearGradient id="bGradH" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={D.amberL} stopOpacity="1"/>
            <stop offset="100%" stopColor={D.amber} stopOpacity="0.3"/>
          </linearGradient>
        </defs>
        {gridLines.map((v, gi) => { const y = padT + chartH - (v / maxVal) * chartH; return <g key={gi}><line x1={padL} y1={y} x2={W-padR} y2={y} stroke="rgba(255,255,255,0.04)" strokeWidth={1}/><text x={padL-4} y={y+3} textAnchor="end" fill={D.sub} fontSize="7" fontFamily="var(--font-mono)">{v}</text></g> })}
        <line x1={padL} y1={padT+chartH} x2={W-padR} y2={padT+chartH} stroke="rgba(255,255,255,0.08)" strokeWidth={1}/>
        {data.map((d, i) => {
          const barH = (d.count / maxVal) * chartH
          const x = padL + i * step + (step - barW) / 2
          const y = padT + chartH - barH
          const isHov = hov === i
          return (
            <g key={d.date} onMouseEnter={() => setHov(i)} onMouseLeave={() => setHov(null)}>
              <rect x={x} y={ready ? y : padT+chartH} width={barW} height={ready ? barH : 0} fill={isHov ? 'url(#bGradH)' : 'url(#bGrad)'} rx={2}
                style={{ transition: `y 0.6s cubic-bezier(0.16,1,0.3,1) ${i*0.008}s, height 0.6s cubic-bezier(0.16,1,0.3,1) ${i*0.008}s`, filter: isHov ? `drop-shadow(0 0 4px ${D.amber}88)` : 'none' }} />
              {isHov && d.count > 0 && (() => {
                const tx = Math.min(Math.max(x-22, padL), W-padR-70)
                const ty = Math.max(padT+2, y-28)
                return <g>
                  <rect x={tx} y={ty} width={70} height={20} rx={5} fill="rgba(8,6,4,0.97)" stroke={`${D.amber}44`} strokeWidth={1}/>
                  <text x={tx+35} y={ty+14} textAnchor="middle" fill={D.text} fontSize="9" fontFamily="var(--font-mono)">{fmtD(d.date)}: {d.count}</text>
                </g>
              })()}
            </g>
          )
        })}
        {data.filter((_,i) => i % 5 === 0 || i === data.length-1).map(d => { const i = data.indexOf(d); return <text key={d.date} x={padL+i*step+step/2} y={H-4} textAnchor="middle" fill={D.sub} fontSize="7.5" fontFamily="var(--font-mono)">{fmtD(d.date)}</text> })}
      </svg>
    </div>
  )
}

/* ── Horizontal bar chart ──────────────────────────────────── */
function HBarChart({ data, color = D.amber, activeName, onBarClick }: { data: Array<{ name: string; count: number }>; color?: string; activeName?: string; onBarClick?: (name: string) => void }) {
  const [ready, setReady] = useState(false)
  const [hov, setHov]     = useState<number | null>(null)
  useEffect(() => { const t = setTimeout(() => setReady(true), 300); return () => clearTimeout(t) }, [])
  const max   = Math.max(...data.map(d => d.count), 1)
  const total = data.reduce((s, d) => s + d.count, 0)
  const hasActive = !!activeName
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7, width: '100%' }}>
      {data.map((d, i) => {
        const pct    = Math.round((d.count / total) * 100)
        const barPct = (d.count / max) * 100
        const isHov  = hov === i
        const isTop  = i < 3
        const isActive = d.name === activeName
        return (
          <div key={d.name} onMouseEnter={() => setHov(i)} onMouseLeave={() => setHov(null)}
            onClick={() => onBarClick?.(d.name === activeName ? '' : d.name)}
            style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: onBarClick ? 'pointer' : 'default', opacity: hasActive ? (isActive ? 1 : 0.35) : (hov !== null && !isHov ? 0.35 : 1), transition: 'opacity 0.2s' }}>
            <div style={{ width: 18, height: 18, borderRadius: 5, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: isTop ? `${color}18` : 'transparent', border: isTop ? `1px solid ${color}35` : `1px solid transparent`, fontSize: 9, fontFamily: 'var(--font-mono)', color: isTop ? color : D.sub, fontWeight: isTop ? 700 : 400 }}>{i+1}</div>
            <span style={{ width: 140, fontSize: '0.7rem', color: isHov || isActive ? D.text : D.muted, fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flexShrink: 0, transition: 'color 0.2s' }} title={d.name}>{d.name}</span>
            <div style={{ flex: 1, height: 5, background: 'rgba(255,255,255,0.04)', borderRadius: 6, overflow: 'hidden', position: 'relative' }}>
              <div style={{ position: 'absolute', inset: 0, right: 'auto', width: ready ? `${barPct}%` : '0%', background: isTop ? `linear-gradient(90deg, ${color}, ${color}bb)` : `linear-gradient(90deg, ${color}66, ${color}33)`, borderRadius: 6, transition: `width 0.9s cubic-bezier(0.16,1,0.3,1) ${i*0.04}s`, boxShadow: (isTop && isHov) || isActive ? `0 0 8px ${color}55` : 'none' }} />
              {isTop && <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.07) 50%, transparent 100%)', animation: 'shimmer 2.5s ease-in-out infinite', animationDelay: `${i*0.4}s` }} />}
            </div>
            <span style={{ width: 32, textAlign: 'right', fontSize: '0.7rem', color: isHov || isActive ? color : D.text, fontWeight: 700, fontFamily: 'var(--font-mono)', flexShrink: 0, transition: 'color 0.2s' }}>{d.count}</span>
            <span style={{ width: 30, textAlign: 'right', fontSize: '0.62rem', color: D.sub, fontFamily: 'var(--font-mono)', flexShrink: 0 }}>{pct}%</span>
          </div>
        )
      })}
    </div>
  )
}

/* ── Weather bars ──────────────────────────────────────────── */
function WeatherBars({ data, activeName, onBarClick }: { data: Array<{ name: string; count: number }>; activeName?: string; onBarClick?: (name: string) => void }) {
  const [ready, setReady] = useState(false)
  const [hov, setHov] = useState<number | null>(null)
  useEffect(() => { const t = setTimeout(() => setReady(true), 500); return () => clearTimeout(t) }, [])
  const total = data.reduce((s, d) => s + d.count, 0) || 1
  const hasActive = !!activeName
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
      {data.map((d, i) => {
        const pct = Math.round((d.count / total) * 100)
        const isHov = hov === i
        const isActive = d.name === activeName
        return (
          <div key={d.name} onMouseEnter={() => setHov(i)} onMouseLeave={() => setHov(null)}
            onClick={() => onBarClick?.(d.name === activeName ? '' : d.name)}
            style={{ cursor: onBarClick ? 'pointer' : 'default', opacity: hasActive ? (isActive ? 1 : 0.35) : 1, transition: 'opacity 0.2s' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
              <span style={{ fontSize: '0.72rem', color: isHov || isActive ? D.text : D.muted, fontFamily: 'var(--font-mono)', display: 'flex', gap: 7, alignItems: 'center', transition: 'color 0.2s' }}><span>{WEATHER_ICON[d.name]||'🌡'}</span><span>{d.name}</span></span>
              <span style={{ fontSize: '0.72rem', color: D.text, fontFamily: 'var(--font-mono)' }}>{d.count} <span style={{ color: D.sub }}>({pct}%)</span></span>
            </div>
            <div style={{ height: 4, background: 'rgba(255,255,255,0.04)', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: ready ? `${pct}%` : '0%', background: `linear-gradient(90deg, ${D.blue}, ${D.blue}66)`, borderRadius: 3, transition: `width 0.8s cubic-bezier(0.16,1,0.3,1) ${i*0.08}s`, boxShadow: isActive || isHov ? `0 0 6px ${D.blue}88` : 'none' }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

/* ── Media Gallery ─────────────────────────────────────────── */
function MediaGallery({ items, activeProject }: { items: MediaItem[]; activeProject: string }) {
  const [lightbox, setLightbox] = useState<MediaItem | null>(null)
  const [page, setPage] = useState(0)
  const PAGE_SIZE = 12
  useEffect(() => { const h = (e: KeyboardEvent) => { if (e.key === 'Escape') setLightbox(null) }; window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h) }, [])
  useEffect(() => { setPage(0); setLightbox(null) }, [activeProject])

  if (!activeProject) return <div style={{ color: D.sub, fontSize: '0.8rem', fontFamily: 'var(--font-mono)', padding: '32px 0', textAlign: 'center' }}>Select a project to view site media</div>
  const images = items.filter(m => m.media_type !== 'video')
  const videos = items.filter(m => m.media_type === 'video')
  const sorted = [...images, ...videos]
  const totalPages = Math.ceil(sorted.length / PAGE_SIZE)
  const pageItems  = sorted.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE)
  if (!sorted.length) return <div style={{ color: D.sub, fontSize: '0.8rem', fontFamily: 'var(--font-mono)', padding: '32px 0', textAlign: 'center' }}>No media for this project</div>

  return (
    <>
      <div style={{ fontSize: '0.65rem', fontFamily: 'var(--font-mono)', color: D.muted, marginBottom: 10, display: 'flex', justifyContent: 'space-between' }}>
        <span>{images.length} photos · {videos.length} videos</span>
        <span style={{ color: D.sub }}>Showing {page*PAGE_SIZE+1}–{Math.min((page+1)*PAGE_SIZE, sorted.length)} of {sorted.length}</span>
      </div>
      <div className="media-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
        {pageItems.map((item, i) => {
          const isVideo = item.media_type === 'video'
          return (
            <div key={`${activeProject}-${page}-${i}`} onClick={() => setLightbox(item)}
              style={{ aspectRatio: '4/3', borderRadius: 10, overflow: 'hidden', cursor: 'pointer', position: 'relative', background: D.panel2, border: `1px solid ${D.border}`, transition: 'transform 0.2s, box-shadow 0.2s' }}
              onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.transform = 'scale(1.03)'; (e.currentTarget as HTMLDivElement).style.boxShadow = `0 8px 24px rgba(0,0,0,0.6), 0 0 0 1px rgba(212,160,64,0.3)` }}
              onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.transform = 'scale(1)';   (e.currentTarget as HTMLDivElement).style.boxShadow = 'none' }}>
              {isVideo
                ? <video src={item.file} muted playsInline preload="none" style={{ width:'100%',height:'100%',objectFit:'cover',display:'block' }}/>
                : <img   src={item.file} alt="" loading="lazy" decoding="async"  style={{ width:'100%',height:'100%',objectFit:'cover',display:'block' }}/>}
              {isVideo && <div style={{ position:'absolute',inset:0,display:'flex',alignItems:'center',justifyContent:'center',pointerEvents:'none' }}><div style={{ width:32,height:32,borderRadius:'50%',background:'rgba(0,0,0,0.6)',display:'flex',alignItems:'center',justifyContent:'center' }}><svg width={14} height={14} viewBox="0 0 24 24" fill={D.amber}><polygon points="5,3 19,12 5,21"/></svg></div></div>}
              <div style={{ position:'absolute',top:6,left:6,background:'rgba(0,0,0,0.65)',backdropFilter:'blur(4px)',borderRadius:4,padding:'2px 7px',fontSize:10,color:D.muted,fontFamily:'var(--font-mono)' }}>{page*PAGE_SIZE+i+1}</div>
            </div>
          )
        })}
      </div>
      {totalPages > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 16 }}>
          <button onClick={() => setPage(p => Math.max(0,p-1))} disabled={page===0}
            style={{ background:'transparent', color: page===0 ? D.sub : D.amber, border:`1px solid ${page===0 ? D.sub : D.amber}30`, borderRadius:8, padding:'7px 18px', fontSize:12, cursor: page===0?'not-allowed':'pointer', fontFamily:'var(--font-mono)', transition:'all 0.2s' }}>‹ Prev</button>
          <div style={{ display:'flex', gap:6, alignItems:'center' }}>
            {Array.from({length:totalPages},(_,i)=>i).filter(i => i===0||i===totalPages-1||Math.abs(i-page)<=2).map((i,idx,arr) => (
              <>
                {idx>0 && arr[idx-1]!==i-1 && <span key={`e-${i}`} style={{ color:D.sub,fontFamily:'var(--font-mono)',fontSize:12,padding:'0 4px' }}>…</span>}
                <button key={i} onClick={() => setPage(i)} style={{ width:30,height:30,borderRadius:7,border:`1px solid ${i===page?D.amber:D.sub}30`,background:i===page?D.amber:'transparent',color:i===page?'#000':D.muted,fontSize:11,cursor:'pointer',fontFamily:'var(--font-mono)',fontWeight:i===page?700:400,transition:'all 0.2s',display:'flex',alignItems:'center',justifyContent:'center' }}>{i+1}</button>
              </>
            ))}
          </div>
          <button onClick={() => setPage(p => Math.min(totalPages-1,p+1))} disabled={page===totalPages-1}
            style={{ background:'transparent', color: page===totalPages-1?D.sub:D.amber, border:`1px solid ${page===totalPages-1?D.sub:D.amber}30`, borderRadius:8, padding:'7px 18px', fontSize:12, cursor: page===totalPages-1?'not-allowed':'pointer', fontFamily:'var(--font-mono)', transition:'all 0.2s' }}>Next ›</button>
        </div>
      )}
      {lightbox && (
        <div onClick={() => setLightbox(null)} style={{ position:'fixed',inset:0,zIndex:9999,background:'rgba(0,0,0,0.94)',display:'flex',alignItems:'center',justifyContent:'center',padding:40,backdropFilter:'blur(12px)',animation:'fadeIn 0.2s ease' }}>
          {lightbox.media_type==='video'
            ? <video key={lightbox.file} src={lightbox.file} autoPlay controls playsInline onClick={e => e.stopPropagation()} style={{ maxWidth:'90vw',maxHeight:'88vh',borderRadius:12,boxShadow:'0 32px 80px rgba(0,0,0,0.9)' }}/>
            : <img src={lightbox.file} alt="" onClick={e => e.stopPropagation()} style={{ maxWidth:'90vw',maxHeight:'88vh',objectFit:'contain',borderRadius:12,boxShadow:'0 32px 80px rgba(0,0,0,0.9)' }}/>}
          <button onClick={() => setLightbox(null)} style={{ position:'absolute',top:20,right:24,background:'rgba(255,255,255,0.06)',border:`1px solid ${D.sub}`,color:D.muted,width:38,height:38,borderRadius:9,cursor:'pointer',fontSize:'1.1rem',display:'flex',alignItems:'center',justifyContent:'center',transition:'background 0.2s' }}>✕</button>
        </div>
      )}
    </>
  )
}

/* ── Report feed table ─────────────────────────────────────── */
function ReportFeed({ reports }: { reports: DashData['recentReports'] }) {
  const SC: Record<string,string> = { Completed:D.green, Complete:D.green, 'In Progress':D.amber, Ongoing:D.amber, Pending:D.blue, Unknown:D.sub }
  const [page, setPage] = useState(0)
  const PAGE_SIZE = 15
  useEffect(() => { setPage(0) }, [reports])
  const totalPages = Math.max(1, Math.ceil(reports.length / PAGE_SIZE))
  const pageItems  = reports.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE)
  return (
    <div>
      {reports.length > PAGE_SIZE && (
        <div style={{ fontSize:'0.65rem', fontFamily:'var(--font-mono)', color:D.muted, marginBottom:10 }}>
          Showing {page*PAGE_SIZE+1}–{Math.min((page+1)*PAGE_SIZE, reports.length)} of {reports.length}
        </div>
      )}
      <div style={{ width:'100%', overflowX:'auto' }}>
        <table style={{ width:'100%', borderCollapse:'collapse', fontSize:'0.78rem' }}>
          <thead><tr style={{ borderBottom:`1px solid ${D.border}` }}>{['Date','Project','Section','Category','Type','Reporter','Status'].map(h => <th key={h} style={{ padding:'10px 14px', textAlign:'left', color:D.muted, fontFamily:'var(--font-mono)', fontSize:'0.6rem', letterSpacing:'0.1em', textTransform:'uppercase', fontWeight:500, whiteSpace:'nowrap' }}>{h}</th>)}</tr></thead>
          <tbody>
            {pageItems.map((r,i) => {
              const sc = SC[r.activity_status] || D.sub
              const dt = r.date_of_activity ? new Date(r.date_of_activity).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'2-digit'}) : '—'
              return (
                <tr key={r.id} style={{ borderBottom:`1px solid rgba(255,255,255,0.03)`, opacity:0, animation:`fadeIn 0.35s ease ${i*0.05}s forwards`, transition:'background 0.15s' }}
                  onMouseEnter={e => (e.currentTarget.style.background='rgba(212,160,64,0.03)')}
                  onMouseLeave={e => (e.currentTarget.style.background='transparent')}>
                  <td style={{ padding:'11px 14px', color:D.muted, fontFamily:'var(--font-mono)', whiteSpace:'nowrap' }}>{dt}</td>
                  <td style={{ padding:'11px 14px', color:D.text, fontWeight:600, maxWidth:180, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{r.project_name||'—'}</td>
                  <td style={{ padding:'11px 14px', color:D.muted, maxWidth:140, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{r.section_name||'—'}</td>
                  <td style={{ padding:'11px 14px', whiteSpace:'nowrap' }}><span style={{ background:`${CAT_COLORS[0]}12`, color:CAT_COLORS[0], border:`1px solid ${CAT_COLORS[0]}28`, padding:'2px 8px', borderRadius:5, fontFamily:'var(--font-mono)', fontSize:'0.62rem' }}>{r.activity_category||'—'}</span></td>
                  <td style={{ padding:'11px 14px', color:D.muted, maxWidth:160, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{r.activity_type||'—'}</td>
                  <td style={{ padding:'11px 14px', color:D.text, whiteSpace:'nowrap' }}>{r.reporter_name||'—'}</td>
                  <td style={{ padding:'11px 14px', whiteSpace:'nowrap' }}>{r.activity_status ? <span style={{ background:`${sc}12`, color:sc, border:`1px solid ${sc}28`, padding:'2px 8px', borderRadius:5, fontFamily:'var(--font-mono)', fontSize:'0.6rem' }}>{r.activity_status}</span> : <span style={{ color:D.sub }}>—</span>}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {totalPages > 1 && (
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginTop:14 }}>
          <button onClick={() => setPage(p => Math.max(0,p-1))} disabled={page===0}
            style={{ background:'transparent', color: page===0 ? D.sub : D.amber, border:`1px solid ${page===0 ? D.sub : D.amber}30`, borderRadius:7, padding:'6px 16px', fontSize:11, cursor: page===0?'not-allowed':'pointer', fontFamily:'var(--font-mono)', transition:'all 0.2s' }}>‹ Prev</button>
          <span style={{ fontSize:10, color:D.sub, fontFamily:'var(--font-mono)' }}>{page+1} / {totalPages}</span>
          <button onClick={() => setPage(p => Math.min(totalPages-1,p+1))} disabled={page===totalPages-1}
            style={{ background:'transparent', color: page===totalPages-1 ? D.sub : D.amber, border:`1px solid ${page===totalPages-1 ? D.sub : D.amber}30`, borderRadius:7, padding:'6px 16px', fontSize:11, cursor: page===totalPages-1?'not-allowed':'pointer', fontFamily:'var(--font-mono)', transition:'all 0.2s' }}>Next ›</button>
        </div>
      )}
    </div>
  )
}

/* ── Activity Calendar ─────────────────────────────────────── */
function ActivityCalendar({ data }: { data: CalDay[] }) {
  const [hovDay, setHovDay] = useState<(CalDay & { x: number; y: number }) | null>(null)
  if (!data.length) return <div style={{ color:D.sub, fontSize:'0.72rem', fontFamily:'var(--font-mono)', padding:'20px 0' }}>No activity data</div>
  const calMap   = new Map(data.map(d => [d.date, d]))
  const maxCount = Math.max(...data.map(d => d.count), 1)
  const start    = new Date(data[0].date); start.setDate(start.getDate() - start.getDay())
  const end      = new Date()
  const CELL = 12, GAP = 2
  const weeks: Date[][] = []
  const cur = new Date(start)
  while (cur <= end) { const week: Date[] = []; for (let d=0;d<7;d++) { week.push(new Date(cur)); cur.setDate(cur.getDate()+1) }; weeks.push(week) }
  const monthLabels: { label: string; col: number }[] = []
  weeks.forEach((week, wi) => { const first = week.find(d => d.getDate()<=7); if (first) monthLabels.push({ label: first.toLocaleString('en',{month:'short'}), col: wi }) })
  return (
    <div>
      <div style={{ overflowX:'auto', paddingBottom:6 }}>
        <div style={{ display:'flex', gap:GAP, marginBottom:4, paddingLeft:22 }}>
          {weeks.map((_,wi) => { const ml = monthLabels.find(m => m.col===wi); return <div key={wi} style={{ width:CELL, flexShrink:0, fontSize:'0.52rem', color:ml?D.muted:'transparent', fontFamily:'var(--font-mono)', whiteSpace:'nowrap' }}>{ml?.label??'.'}</div> })}
        </div>
        <div style={{ display:'flex', gap:0 }}>
          <div style={{ display:'flex', flexDirection:'column', gap:GAP, marginRight:6 }}>
            {['S','M','T','W','T','F','S'].map((d,i) => <div key={i} style={{ width:14, height:CELL, display:'flex', alignItems:'center', justifyContent:'flex-end', paddingRight:2, fontSize:'0.48rem', color:i%2===0?D.sub:'transparent', fontFamily:'var(--font-mono)' }}>{d}</div>)}
          </div>
          <div style={{ display:'flex', gap:GAP }}>
            {weeks.map((week, wi) => (
              <div key={wi} style={{ display:'flex', flexDirection:'column', gap:GAP }}>
                {week.map((date, di) => {
                  const key   = date.toISOString().split('T')[0]
                  const entry = calMap.get(key)
                  const count = entry?.count ?? 0
                  const isFuture  = date > new Date()
                  const intensity = count > 0 ? 0.12 + (count / maxCount) * 0.88 : 0
                  return <div key={di}
                    onMouseEnter={e => { if (!entry) return; const rect = e.currentTarget.getBoundingClientRect(); setHovDay({ ...entry, x: rect.left+rect.width/2, y: rect.top }) }}
                    onMouseLeave={() => setHovDay(null)}
                    onMouseOver={e  => { if (count>0) (e.currentTarget as HTMLDivElement).style.transform='scale(1.4)' }}
                    onMouseOut={e   => { (e.currentTarget as HTMLDivElement).style.transform='scale(1)' }}
                    style={{ width:CELL, height:CELL, borderRadius:2, flexShrink:0, background:count>0?`rgba(212,160,64,${intensity})`:isFuture?'transparent':'rgba(255,255,255,0.025)', border:count>0?`1px solid rgba(212,160,64,${intensity*0.5})`:`1px solid rgba(255,255,255,0.04)`, cursor:count>0?'pointer':'default', transition:'background 0.15s, transform 0.15s', boxShadow:count>0?`0 0 ${Math.round(intensity*10)}px rgba(212,160,64,${intensity*0.5})`:'none' }} />
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div style={{ display:'flex', alignItems:'center', gap:6, marginTop:10 }}>
        <span style={{ fontSize:'0.52rem', color:D.sub, fontFamily:'var(--font-mono)' }}>Less</span>
        {[0,0.2,0.45,0.7,1].map((v,i) => <div key={i} style={{ width:10,height:10,borderRadius:2,background:v===0?'rgba(255,255,255,0.025)':`rgba(212,160,64,${0.12+v*0.88})` }} />)}
        <span style={{ fontSize:'0.52rem', color:D.sub, fontFamily:'var(--font-mono)' }}>More</span>
        <span style={{ marginLeft:'auto', fontSize:'0.52rem', color:D.sub, fontFamily:'var(--font-mono)' }}>{data.length} active days · {data.reduce((s,d)=>s+d.count,0)} reports</span>
      </div>
      {hovDay && <div style={{ position:'fixed', left:hovDay.x-85, top:hovDay.y-88, width:175, background:'rgba(8,6,4,0.98)', border:`1px solid ${D.amber}44`, borderRadius:9, padding:'8px 12px', pointerEvents:'none', zIndex:9100, animation:'fadeIn 0.1s ease', boxShadow:`0 8px 28px rgba(0,0,0,0.7), 0 0 0 1px rgba(212,160,64,0.1)` }}>
        <div style={{ fontSize:'0.6rem', color:D.amber, fontFamily:'var(--font-mono)', marginBottom:4 }}>{new Date(hovDay.date+'T12:00:00').toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short',year:'numeric'})}</div>
        <div style={{ fontSize:'0.82rem', color:D.text, fontFamily:'var(--font-mono)', fontWeight:700, marginBottom:4 }}>{hovDay.count} {hovDay.count===1?'report':'reports'}</div>
        {hovDay.projects.length>0 && <div style={{ fontSize:'0.56rem', color:D.muted, fontFamily:'var(--font-mono)', lineHeight:1.6 }}>{hovDay.projects.slice(0,3).join(' · ')}{hovDay.projects.length>3?` +${hovDay.projects.length-3} more`:''}</div>}
      </div>}
    </div>
  )
}

const IconDoc      = () => <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
const IconCalendar = () => <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
const IconPin      = () => <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
const IconImage    = () => <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
const IconPeople   = () => <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>

/* ── Filter Bar ────────────────────────────────────────────── */
function FilterBar({ data, onFilter }: { data: DashData; onFilter: (key: string, val: string) => void }) {
  const active = data.activeFilters
  const hasFilters = !!(active.filterCategory||active.filterProject||active.filterDateFrom||active.filterDateTo||active.filterChFrom||active.filterChTo||active.filterSearch||active.filterWeather||active.filterMachine||active.filterEmployee||active.filterEngineer||active.filterSupervisor)
  const [chFrom, setChFrom] = useState(active.filterChFrom||'')
  const [chTo,   setChTo]   = useState(active.filterChTo  ||'')
  const [search, setSearch] = useState(active.filterSearch||'')
  useEffect(() => { setChFrom(active.filterChFrom||'') }, [active.filterChFrom])
  useEffect(() => { setChTo  (active.filterChTo  ||'') }, [active.filterChTo])
  useEffect(() => { setSearch(active.filterSearch||'') }, [active.filterSearch])
  useEffect(() => {
    const t = setTimeout(() => { if (search !== (active.filterSearch||'')) onFilter('search', search) }, 450)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  const applyChFilter = () => {
    const from = chFrom.trim(), to = chTo.trim()
    if (from && to && !isNaN(Number(from)) && !isNaN(Number(to)) && Number(to) > Number(from))
      onFilter('__ch_range__', `${from},${to}`)
  }

  const sel: React.CSSProperties = { background:'#0e0e10', color:D.text, border:`1px solid ${D.border}`, borderRadius:8, padding:'7px 12px', fontSize:12, fontFamily:'var(--font-mono)', cursor:'pointer', minWidth:155, outline:'none' }
  const inp: React.CSSProperties = { ...sel, minWidth:110 }
  const lbl: React.CSSProperties = { fontSize:10, color:D.muted, letterSpacing:1.5, fontFamily:'var(--font-mono)', textTransform:'uppercase' as const, marginBottom:5 }

  return (
    <div style={{ display:'flex', gap:12, flexWrap:'wrap', alignItems:'flex-end', padding:'16px 20px', background:D.panel, border:`1px solid ${D.border}`, borderRadius:14, marginBottom:24, boxShadow:SH_PANEL }}>
      <div style={{ display:'flex', flexDirection:'column', flex:'1 1 220px', minWidth:180 }}>
        <div style={lbl}>Search</div>
        <div style={{ position:'relative' }}>
          <input type='text' placeholder='Reporter, project, comment…' value={search} onChange={e=>setSearch(e.target.value)}
            style={{ ...inp, width:'100%', minWidth:0, paddingRight:28 }} />
          {search && <button onClick={() => setSearch('')} aria-label="Clear search"
            style={{ position:'absolute', right:8, top:'50%', transform:'translateY(-50%)', background:'none', border:'none', color:D.sub, cursor:'pointer', fontSize:13, lineHeight:1, padding:0 }}>✕</button>}
        </div>
      </div>
      {[
        { lbl:'Category',     el:<select value={active.filterCategory||''} onChange={e=>onFilter('category',e.target.value)} style={sel}><option value=''>All Categories</option>{data.filterOptions.categories.map(c=><option key={c} value={c}>{c}</option>)}</select> },
        { lbl:'Project',      el:<select value={active.filterProject||''}  onChange={e=>onFilter('project', e.target.value)} style={sel}><option value=''>All Projects</option>{data.filterOptions.projects.map(p=><option key={p} value={p}>{p}</option>)}</select> },
        { lbl:'Date From',    el:<input type='date' value={active.filterDateFrom||''} onChange={e=>onFilter('date_from',e.target.value)} style={inp}/> },
        { lbl:'Date To',      el:<input type='date' value={active.filterDateTo||''}   onChange={e=>onFilter('date_to',  e.target.value)} style={inp}/> },
        { lbl:'Chainage From',el:<input type='number' placeholder='e.g. 20000' value={chFrom} onChange={e=>setChFrom(e.target.value)} onBlur={applyChFilter} onKeyDown={e=>{if(e.key==='Enter')applyChFilter()}} style={{...inp,minWidth:108}}/> },
        { lbl:'Chainage To',  el:<input type='number' placeholder='e.g. 30000' value={chTo}   onChange={e=>setChTo(e.target.value)}   onBlur={applyChFilter} onKeyDown={e=>{if(e.key==='Enter')applyChFilter()}} style={{...inp,minWidth:108}}/> },
      ].map(({lbl:l,el}) => <div key={l} style={{display:'flex',flexDirection:'column'}}><div style={lbl}>{l}</div>{el}</div>)}

      {(chFrom||chTo) && !(chFrom&&chTo) && <div style={{ alignSelf:'flex-end', fontSize:10, color:D.amber, fontFamily:'var(--font-mono)', opacity:0.7 }}>Enter both values</div>}

      {hasFilters && <button onClick={() => { setChFrom(''); setChTo(''); setSearch(''); onFilter('__clear__','') }}
        style={{ background:'transparent', color:D.amber, border:`1px solid rgba(212,160,64,0.3)`, borderRadius:8, padding:'7px 18px', fontSize:12, cursor:'pointer', fontFamily:'var(--font-mono)', letterSpacing:1, alignSelf:'flex-end', transition:'all 0.2s' }}>✕ Clear</button>}

      {hasFilters && <div style={{ alignSelf:'flex-end', fontSize:11, color:D.muted, fontFamily:'var(--font-mono)' }}>
        Filtered: <span style={{ color:D.amber }}>{data.summary.totalReports.toLocaleString()} reports</span>
      </div>}
    </div>
  )
}

/* ── Skeleton ──────────────────────────────────────────────── */
function Skel({ h, style: st }: { h: number; style?: React.CSSProperties }) {
  return (
    <div style={{ height:h, borderRadius:16, background:D.panel, position:'relative', overflow:'hidden', border:`1px solid ${D.border}`, ...st }}>
      <div style={{ position:'absolute', inset:0, background:'linear-gradient(90deg, transparent 0%, rgba(212,160,64,0.04) 50%, transparent 100%)', animation:'shimmer 2s ease-in-out infinite' }} />
    </div>
  )
}
function DashSkeleton() {
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
      <div className="kpi-grid" style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:14 }}>{[0,1,2,3,4].map(i=><Skel key={i} h={108}/>)}</div>
      <div className="grid-responsive" style={{ display:'grid', gridTemplateColumns:'1fr 2fr',   gap:14 }}><Skel h={250}/><Skel h={250}/></div>
      <div className="grid-responsive" style={{ display:'grid', gridTemplateColumns:'3fr 2fr',   gap:14 }}><Skel h={210}/><Skel h={210}/></div>
      <div className="grid-responsive" style={{ display:'grid', gridTemplateColumns:'1fr 1fr',   gap:14 }}><Skel h={190}/><Skel h={190}/></div>
      <Skel h={170}/><Skel h={310}/><Skel h={230}/>
    </div>
  )
}

/* ── Main Page ─────────────────────────────────────────────── */
function DashboardPageInner() {
  const router       = useRouter()
  const searchParams = useSearchParams()
  const [data, setData]     = useState<DashData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState('')
  const requestIdRef = useRef(0)

  const loadData = useCallback(() => {
    const reqId = ++requestIdRef.current
    setLoading(true)
    const qs = searchParams.toString()
    fetch(`/api/dashboard${qs ? `?${qs}` : ''}`)
      .then(r => r.json())
      .then(d => { if (reqId === requestIdRef.current) { setData(d); setLoading(false) } })
      .catch(() => { if (reqId === requestIdRef.current) { setError('Failed to load dashboard data'); setLoading(false) } })
  }, [searchParams])

  useEffect(() => { loadData() }, [loadData])

  function handleFilter(key: string, val: string) {
    const p = new URLSearchParams(searchParams.toString())
    if (key === '__clear__') {
      ['category','project','date_from','date_to','ch_from','ch_to','search','weather','machine','employee','engineer','supervisor'].forEach(k => p.delete(k))
    } else if (key === '__ch_range__') {
      const [from, to] = val.split(',')
      p.set('ch_from', from); p.set('ch_to', to)
    } else if (val) {
      p.set(key, val)
    } else {
      p.delete(key)
    }
    router.push(`/dashboard?${p.toString()}`)
  }

  return (
    <div style={{ minHeight:'100vh', background:D.bg, color:D.text, fontFamily:'var(--font-dm-sans)', backgroundImage:'linear-gradient(rgba(255,255,255,0.012) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.012) 1px, transparent 1px)', backgroundSize:'60px 60px', position:'relative' }}>

      {/* Ambient */}
      <div style={{ position:'fixed', inset:0, zIndex:0, pointerEvents:'none', overflow:'hidden' }}>
        <div style={{ position:'absolute', width:900, height:900, borderRadius:'50%', background:'radial-gradient(circle, rgba(212,160,64,0.04) 0%, transparent 65%)', top:'-15%', right:'-10%', animation:'float1 28s ease-in-out infinite' }} />
        <div style={{ position:'absolute', width:600, height:600, borderRadius:'50%', background:'radial-gradient(circle, rgba(96,165,250,0.025) 0%, transparent 65%)', top:'45%',  left:'-8%',  animation:'float2 34s ease-in-out infinite' }} />
        <div style={{ position:'absolute', width:400, height:400, borderRadius:'50%', background:'radial-gradient(circle, rgba(52,211,153,0.02) 0%, transparent 65%)',  bottom:'10%', right:'15%', animation:'float1 22s ease-in-out infinite 8s' }} />
        <div style={{ position:'absolute', left:0, right:0, height:1, background:'linear-gradient(90deg, transparent 0%, rgba(212,160,64,0.04) 20%, rgba(212,160,64,0.14) 50%, rgba(212,160,64,0.04) 80%, transparent 100%)', animation:'scanLine 16s linear infinite' }} />
      </div>

      {/* Sub-header */}
      <div className="sub-header-bar" style={{ position:'sticky', top:52, zIndex:50, background:'rgba(14,14,16,0.95)', backdropFilter:'blur(12px)', borderBottom:`1px solid ${D.border}`, padding:'0 32px', display:'flex', alignItems:'center', gap:18, height:46, overflow:'hidden' }}>
        <div style={{ display:'flex', alignItems:'baseline', gap:10 }}>
          <span style={{ fontFamily:'var(--font-loader)', fontSize:'1.05rem', letterSpacing:'0.12em', color:D.amber, textShadow:`0 0 20px ${D.amber}44` }}>ANALYTICS</span>
          <span className="sub-badge" style={{ fontFamily:'var(--font-mono)', fontSize:'0.52rem', letterSpacing:'0.14em', color:D.sub, textTransform:'uppercase', background:D.panel, padding:'2px 8px', borderRadius:4, border:`1px solid ${D.border}` }}>Site Command</span>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:6 }}>
          <div style={{ position:'relative', width:6, height:6 }}>
            <div style={{ position:'absolute', inset:0, borderRadius:'50%', background:D.green, animation:'pingAnim 2.4s ease-out infinite', opacity:0.5 }} />
            <div style={{ position:'absolute', inset:0, borderRadius:'50%', background:D.green }} />
          </div>
          <span style={{ fontFamily:'var(--font-mono)', fontSize:'0.5rem', color:D.green, letterSpacing:'0.14em' }}>LIVE</span>
        </div>
        {data && (
          <div style={{ flex:1, overflow:'hidden', maskImage:'linear-gradient(90deg,transparent,black 8%,black 92%,transparent)', WebkitMaskImage:'linear-gradient(90deg,transparent,black 8%,black 92%,transparent)' }}>
            <div style={{ display:'flex', gap:48, whiteSpace:'nowrap', animation:'ticker 32s linear infinite', width:'max-content' }}>
              {[
                `${data.summary.totalReports.toLocaleString()} TOTAL REPORTS`,
                `${data.summary.reportsThisMonth} THIS MONTH`,
                `${data.summary.activeProjects} ACTIVE PROJECTS`,
                `${data.summary.uniqueReporters} REPORTERS`,
                `${data.summary.totalPhotos.toLocaleString()} PHOTOS`,
                ...(data.activeFilters.filterProject ? [`FILTERED: ${data.activeFilters.filterProject.toUpperCase()}`] : []),
                ...(data.activeFilters.filterChFrom && data.activeFilters.filterChTo ? [`CH: ${data.activeFilters.filterChFrom} → ${data.activeFilters.filterChTo}`] : []),
                `${data.summary.totalReports.toLocaleString()} TOTAL REPORTS`,
                `${data.summary.reportsThisMonth} THIS MONTH`,
                `${data.summary.activeProjects} ACTIVE PROJECTS`,
                `${data.summary.uniqueReporters} REPORTERS`,
                `${data.summary.totalPhotos.toLocaleString()} PHOTOS`,
                ...(data.activeFilters.filterProject ? [`FILTERED: ${data.activeFilters.filterProject.toUpperCase()}`] : []),
                ...(data.activeFilters.filterChFrom && data.activeFilters.filterChTo ? [`CH: ${data.activeFilters.filterChFrom} → ${data.activeFilters.filterChTo}`] : []),
              ].map((item, i) => (
                <span key={i} style={{ fontFamily:'var(--font-mono)', fontSize:'0.5rem', color:item.startsWith('FILTERED')||item.startsWith('CH:')?D.amber:D.sub, letterSpacing:'0.1em' }}>
                  {item.startsWith('FILTERED')||item.startsWith('CH:')?'':'◆ '}{item}
                </span>
              ))}
            </div>
          </div>
        )}
        <div style={{ display:'flex', alignItems:'center', gap:10, marginLeft:'auto' }}>
          {loading && <div style={{ fontFamily:'var(--font-mono)', fontSize:'0.55rem', color:D.amber, letterSpacing:'0.1em', display:'flex', alignItems:'center', gap:5 }}>
            <div style={{ width:5, height:5, borderRadius:'50%', background:D.amber, animation:'pulse 1.2s ease-in-out infinite' }} />LOADING
          </div>}
          <div className="sub-date" style={{ fontFamily:'var(--font-mono)', fontSize:'0.55rem', color:D.sub, letterSpacing:'0.06em' }}>{new Date().toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})}</div>
        </div>
      </div>

      {/* Content */}
      <div className="dash-content" style={{ padding:'28px 32px 80px', maxWidth:1480, margin:'0 auto', position:'relative', zIndex:1 }}>
        {error && <div style={{ background:'rgba(248,113,113,0.06)', border:'1px solid rgba(248,113,113,0.2)', borderRadius:12, padding:'14px 18px', color:D.red, fontFamily:'var(--font-mono)', fontSize:'0.78rem', marginBottom:20 }}>{error}</div>}

        {data && <FilterBar data={data} onFilter={handleFilter} />}
        {loading && !data && <DashSkeleton />}

        {data && (<div style={{ opacity: loading ? 0.5 : 1, pointerEvents: loading ? 'none' : 'auto', transition: 'opacity 0.25s' }}>
          {/* KPIs */}
          <div className="kpi-grid" style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:14, marginBottom:20 }}>
            <KPICard label="Total Activity Reports" value={data.summary.totalReports}     icon={<IconDoc/>}      delay={0}   color={D.amber} />
            <KPICard label="Reports This Month"     value={data.summary.reportsThisMonth} icon={<IconCalendar/>} delay={80}  color={D.blue}  sub="MTD" />
            <KPICard label="Active Projects (30d)"  value={data.summary.activeProjects}   icon={<IconPin/>}      delay={160} color={D.green} />
            <KPICard label="Site Photos"            value={data.summary.totalPhotos}      icon={<IconImage/>}    delay={240} color="#a78bfa" />
            <KPICard label="Unique Reporters"       value={data.summary.uniqueReporters}  icon={<IconPeople/>}   delay={320} color={D.amber} />
          </div>

          <Reveal style={{ marginBottom:16 }}>
            <div className="grid-responsive" style={{ display:'grid', gridTemplateColumns:'1fr 2fr', gap:14 }}>
              <Panel title="Activity by Category"><DonutChart data={data.byCategory} activeName={data.activeFilters.filterCategory} onSliceClick={name => handleFilter('category', name)}/></Panel>
              <Panel title="Reports per Day — last 30 days"><TimelineChart data={data.byDay}/></Panel>
            </div>
          </Reveal>

          <Reveal delay={60} style={{ marginBottom:16 }}>
            <div className="grid-responsive" style={{ display:'grid', gridTemplateColumns:'3fr 2fr', gap:14 }}>
              <Panel title="Top Projects by Reports"><HBarChart data={data.byProject} activeName={data.activeFilters.filterProject} onBarClick={name => handleFilter('project', name)}/></Panel>
              <Panel title="Weather Conditions"><WeatherBars data={data.byWeather} activeName={data.activeFilters.filterWeather} onBarClick={name => handleFilter('weather', name)}/></Panel>
            </div>
          </Reveal>

          {(data.byMachine?.length > 0 || data.byEmployee?.length > 0) && (
            <Reveal delay={60} style={{ marginBottom:16 }}>
              <div className="grid-responsive" style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14 }}>
                {data.byMachine?.length  > 0 && <Panel title="Machines Used"><HBarChart data={data.byMachine} color={D.amber} activeName={data.activeFilters.filterMachine} onBarClick={name => handleFilter('machine', name)}/></Panel>}
                {data.byEmployee?.length > 0 && <Panel title="Top Employees"><HBarChart data={data.byEmployee} color={D.green} activeName={data.activeFilters.filterEmployee} onBarClick={name => handleFilter('employee', name)}/></Panel>}
              </div>
            </Reveal>
          )}

          {(data.byEngineer?.length > 0 || data.bySupervisor?.length > 0) && (
            <Reveal delay={60} style={{ marginBottom:16 }}>
              <div className="grid-responsive" style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14 }}>
                {data.byEngineer?.length   > 0 && <Panel title="Engineers Activity"><HBarChart data={data.byEngineer} color={D.blue} activeName={data.activeFilters.filterEngineer} onBarClick={name => handleFilter('engineer', name)}/></Panel>}
                {data.bySupervisor?.length > 0 && <Panel title="Supervisors Activity"><HBarChart data={data.bySupervisor} color="#a78bfa" activeName={data.activeFilters.filterSupervisor} onBarClick={name => handleFilter('supervisor', name)}/></Panel>}
              </div>
            </Reveal>
          )}

          {data.activityCalendar.length > 0 && (
            <Reveal style={{ marginBottom:16 }}>
              <Panel title="Activity Calendar — full history"><ActivityCalendar data={data.activityCalendar}/></Panel>
            </Reveal>
          )}

          <Reveal style={{ marginBottom:16 }}>
            <Panel title="Activity Map — GPS coordinates by project">
              <HitechMapComponent
                project={data.activeFilters.filterProject || 'Coastal Road'}
                chFrom={data.activeFilters.filterChFrom}
                chTo={data.activeFilters.filterChTo}
              />
            </Panel>
          </Reveal>

          <Reveal style={{ marginBottom:16 }}>
            <Panel title={`Site Media — ${data.summary.totalPhotos.toLocaleString()} photos`}>
              <MediaGallery items={data.mediaItems} activeProject={data.activeFilters.filterProject}/>
            </Panel>
          </Reveal>

          {(data.recentReports.length > 0 || Object.values(data.activeFilters).some(Boolean)) && (
            <Reveal>
              <Panel title={data.activeFilters.filterSearch ? `Search Results for "${data.activeFilters.filterSearch}"` : 'Recent Activity Reports'}>
                {data.recentReports.length > 0
                  ? <ReportFeed reports={data.recentReports}/>
                  : <div style={{ color:D.sub, fontSize:'0.8rem', fontFamily:'var(--font-mono)', padding:'32px 0', textAlign:'center' }}>{data.activeFilters.filterSearch ? 'No reports match your search' : 'No reports match your filters'}</div>}
              </Panel>
            </Reveal>
          )}
        </div>)}
      </div>

      <style>{`
        @keyframes fadeIn    { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:translateY(0); } }
        @keyframes shimmer   { 0% { transform:translateX(-100%); } 100% { transform:translateX(600%); } }
        @keyframes pingAnim  { 0% { transform:scale(1); opacity:0.5; } 75%,100% { transform:scale(2.8); opacity:0; } }
        @keyframes float1    { 0%,100% { transform:translate(0,0); } 50% { transform:translate(-30px,20px); } }
        @keyframes float2    { 0%,100% { transform:translate(0,0); } 50% { transform:translate(20px,-30px); } }
        @keyframes scanLine  { 0% { top:-2px; } 100% { top:100%; } }
        @keyframes ticker    { 0% { transform:translateX(0); } 100% { transform:translateX(-50%); } }
        @keyframes pulse     { 0%,100% { opacity:1; transform:scale(1); } 50% { opacity:0.4; transform:scale(0.8); } }
        select:focus, input:focus { outline:none; border-color:rgba(212,160,64,0.4) !important; box-shadow:0 0 0 2px rgba(212,160,64,0.1) !important; }
        select option { background:#0e0e10; }
        input[type='date']::-webkit-calendar-picker-indicator { filter:invert(0.5) sepia(0.3); cursor:pointer; }
        input[type='number']::-webkit-inner-spin-button, input[type='number']::-webkit-outer-spin-button { opacity:0.3; }
        ::-webkit-scrollbar { width:6px; height:6px; }
        ::-webkit-scrollbar-track { background:transparent; }
        ::-webkit-scrollbar-thumb { background:rgba(212,160,64,0.2); border-radius:3px; }
        ::-webkit-scrollbar-thumb:hover { background:rgba(212,160,64,0.4); }

        /* ── Responsive ─────────────────────────────────────── */
        @media (max-width: 1180px) {
          .kpi-grid { grid-template-columns: repeat(3,1fr) !important; }
        }
        @media (max-width: 900px) {
          .grid-responsive { grid-template-columns: 1fr !important; }
        }
        @media (max-width: 640px) {
          .kpi-grid { grid-template-columns: repeat(2,1fr) !important; }
          .dash-content { padding: 18px 14px 60px !important; }
          .media-grid { grid-template-columns: repeat(3,1fr) !important; }
          .sub-header-bar { padding: 0 14px !important; gap: 10px !important; }
        }
        @media (max-width: 480px) {
          .kpi-grid { grid-template-columns: repeat(1,1fr) !important; }
          .media-grid { grid-template-columns: repeat(2,1fr) !important; }
          .sub-badge, .sub-date { display: none !important; }
        }
      `}</style>
    </div>
  )
}

export default function DashboardPage() {
  return (
    <Suspense fallback={<div style={{ minHeight:'100vh', background:'#0e0e10', padding:'96px 32px 60px' }}><DashSkeleton/></div>}>
      <DashboardPageInner/>
    </Suspense>
  )
}