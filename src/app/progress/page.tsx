'use client'

import { useEffect, useState, useCallback, useRef, Suspense } from 'react'

/* ── Design tokens ─────────────────────────────────────────── */
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
  amberD: '#8a6018',
  green:  '#34d399',
  blue:   '#60a5fa',
  red:    '#f87171',
  purple: '#a78bfa',
  gold:   'linear-gradient(135deg, #d4a040 0%, #f0c060 50%, #b8860b 100%)',
}

const GLOW_AMBER  = '0 0 20px rgba(212,160,64,0.15), 0 0 60px rgba(212,160,64,0.05)'
const GLOW_GREEN  = '0 0 20px rgba(52,211,153,0.15)'
const GLOW_RED    = '0 0 20px rgba(248,113,113,0.15)'
const SH_PANEL    = '0 4px 24px rgba(0,0,0,0.6), 0 1px 0 rgba(255,255,255,0.04), inset 0 1px 0 rgba(255,255,255,0.03)'
const SH_PANELLG  = '0 10px 36px rgba(0,0,0,0.7), 0 1px 0 rgba(255,255,255,0.05), inset 0 1px 0 rgba(255,255,255,0.03), 0 0 32px rgba(212,160,64,0.05)'
const SH_CARD     = '0 2px 12px rgba(0,0,0,0.5), 0 1px 0 rgba(255,255,255,0.05)'
const SH_CARDLG   = '0 10px 36px rgba(0,0,0,0.82), 0 1px 0 rgba(255,255,255,0.06), 0 0 28px rgba(212,160,64,0.08)'
const SH_INSET    = 'inset 0 2px 8px rgba(0,0,0,0.6), inset 0 1px 0 rgba(0,0,0,0.3)'
const BORDER_GLOW = '1px solid rgba(212,160,64,0.15)'

/* ── Shared motion tokens ──────────────────────────────────── */
const EASE        = 'cubic-bezier(0.16,1,0.3,1)'
const EASE_SPRING = 'cubic-bezier(0.34,1.56,0.64,1)'

/* ── Types ─────────────────────────────────────────────────── */
interface ProgressData {
  summary: { totalEntities: number; totalCompleted: number; overallPct: number; delayed: number; onSchedule: number; totalBoqQty: number; totalReports: number; linkedEntities?: number }
  ganttData: Array<{ entity: string; start: string; end: string; segments: number }>
  progressCurve: Array<{ date: string; pct: number; count: number }>
  monthlyProgress: Array<{ entity: string; side: string; months: Array<{ month: string; completion_pct: number | null; pending_pct: number | null; cumulative_pct: number | null }>; total_completion: number | null }>
  allMonths: string[]
  delayData: Array<{ entity_name: string; side: string; label: number; planned_date: string; date_started: string; date_completed: string; delay_days: number; performance_status: string; status: string }>
  daysByEntity: Array<{ entity: string; lhs: number | null; rhs: number | null; median: number | null }>
  boqItems: Array<{ description: string; activity_category: string; activity_type: string; qty: number; unit: string; rate: number; amount: number; report_count?: number }>
  boqByCategory: Array<{ category: string; qty: number; amount: number; items: number }>
  reportsByType: Array<{ type: string; count: number; completed: number; inProgress: number; latest: string; linked?: number }>
  recentReports: Array<{ id: number; activity_type: string; activity_category: string; activity_status: string; date_of_activity: string; reporter_name: string; project_name: string; section_name: string; start_chainage: string }>
  activeFilters: { filterEntity: string; filterSide: string; filterMonth: string; filterChFrom: string; filterChTo: string }
  filterOptions: { entities: string[]; sides: string[]; months: string[] }
}

function fmtMonth(m: string) {
  const [y, mo] = m.split('-')
  return new Date(+y, +mo - 1, 1).toLocaleString('en', { month: 'short', year: 'numeric' })
}
function fmtDate(d: string) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' })
}

/* ── Animated counter ──────────────────────────────────────── */
function useCountUp(target: number, duration = 1200, trigger = true) {
  const [val, setVal] = useState(0)
  useEffect(() => {
    if (!trigger || target === 0) { setVal(0); return }
    let raf: number
    const start = Date.now()
    const tick = () => {
      const p = Math.min((Date.now() - start) / duration, 1)
      const ease = 1 - Math.pow(1 - p, 4)
      setVal(Math.round(ease * target))
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, duration, trigger])
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
    <div ref={ref} style={{ opacity: vis ? 1 : 0, transform: vis ? 'translateY(0) scale(1)' : 'translateY(20px) scale(0.985)', transition: `opacity 0.7s ease ${delay}ms, transform 0.7s ${EASE} ${delay}ms`, ...st }}>
      {children}
    </div>
  )
}

/* ── Panel ─────────────────────────────────────────────────── */
function Panel({ children, title, style: st }: { children: React.ReactNode; title: string; style?: React.CSSProperties }) {
  const [hov, setHov] = useState(false)
  return (
    <div onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{ background: D.panel, borderRadius: 16, padding: '22px 24px', display: 'flex', flexDirection: 'column', gap: 18, border: hov ? BORDER_GLOW : `1px solid ${D.border}`, boxShadow: hov ? SH_PANELLG : SH_PANEL, transform: hov ? 'translateY(-2px)' : 'translateY(0)', transition: `border-color 0.35s ${EASE}, box-shadow 0.35s ${EASE}, transform 0.35s ${EASE}`, ...st }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ position: 'relative', width: 8, height: 8, flexShrink: 0 }}>
          <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: D.amber, animation: 'pingAnim 3s ease-out infinite', opacity: 0.5 }} />
          <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: D.amber, boxShadow: `0 0 8px ${D.amber}` }} />
        </div>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.58rem', letterSpacing: '0.18em', textTransform: 'uppercase', color: D.muted, background: '#0e0e10', padding: '2px 10px', borderRadius: 4, border: `1px solid ${D.border}` }}>{title}</span>
      </div>
      {children}
    </div>
  )
}

/* ── KPI Card ──────────────────────────────────────────────── */
function KPICard({ label, value, color = D.amber, icon, suffix = '', delay = 0, glow }: { label: string; value: number; color?: string; icon: React.ReactNode; suffix?: string; delay?: number; glow?: string }) {
  const [vis, setVis] = useState(false)
  const [hov, setHov] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const t = setTimeout(() => setVis(true), delay + 100)
    return () => clearTimeout(t)
  }, [delay])
  const displayed = useCountUp(vis ? value : 0, 1400, vis)
  const entranceY = vis ? 0 : 16
  const hoverY    = hov ? -3 : 0

  return (
    <div ref={ref} onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{ background: hov ? D.panel2 : D.panel, borderRadius: 22, padding: '20px 22px', position: 'relative', overflow: 'hidden', opacity: vis ? 1 : 0, transform: `translateY(${entranceY + hoverY}px) scale(${vis ? 1 : 0.97})`, transition: `opacity 0.6s ease ${delay}ms, transform 0.45s ${EASE} ${vis ? '0ms' : `${delay}ms`}, box-shadow 0.3s ease, border-color 0.3s ease, background 0.3s`, border: hov ? `1px solid rgba(212,160,64,0.2)` : `1px solid ${D.border}`, boxShadow: hov ? `${SH_CARDLG}, ${glow || GLOW_AMBER}` : SH_CARD }}>
      {/* Accent line */}
      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 2, background: `linear-gradient(180deg, transparent, ${color}, transparent)`, opacity: hov ? 1 : 0.5, transition: 'opacity 0.3s ease' }} />
      {/* Corner glow */}
      <div style={{ position: 'absolute', top: -20, right: -20, width: 80, height: 80, borderRadius: '50%', background: `radial-gradient(circle, ${color}${hov ? '28' : '18'} 0%, transparent 70%)`, pointerEvents: 'none', transition: `background 0.3s ${EASE}` }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <div style={{ width: 44, height: 44, borderRadius: 14, background: `${color}20`, border: `1px solid ${color}35`, display: 'flex', alignItems: 'center', justifyContent: 'center', color, boxShadow: `inset 0 1px 0 ${color}20`, transform: hov ? 'scale(1.08)' : 'scale(1)', transition: `transform 0.3s ${EASE_SPRING}` }}>{icon}</div>
      </div>
      <div style={{ fontFamily: 'var(--font-loader)', fontSize: '2.4rem', fontWeight: 400, lineHeight: 1, letterSpacing: '0.02em', color, textShadow: hov ? `0 0 20px ${color}44` : 'none', transition: 'text-shadow 0.3s ease' }}>{displayed.toLocaleString()}{suffix}</div>
      <div style={{ fontSize: '0.58rem', color: D.muted, fontFamily: 'var(--font-mono)', letterSpacing: '0.14em', textTransform: 'uppercase', marginTop: 8 }}>{label}</div>
    </div>
  )
}

/* ── Progress Curve ────────────────────────────────────────── */
function ProgressCurve({ data }: { data: Array<{ date: string; pct: number }> }) {
  const [ready, setReady] = useState(false)
  const [hov, setHov] = useState<number | null>(null)
  const [progress, setProgress] = useState(0)
  useEffect(() => {
    const t1 = setTimeout(() => setReady(true), 200)
    const t2 = setTimeout(() => {
      let p = 0
      const interval = setInterval(() => { p = Math.min(p + 0.02, 1); setProgress(p); if (p >= 1) clearInterval(interval) }, 16)
      return () => clearInterval(interval)
    }, 400)
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, [])

  if (!data.length) return <div style={{ color: D.muted, fontFamily: 'var(--font-mono)', fontSize: 12, padding: '40px 0', textAlign: 'center' }}>No progress data yet</div>

  const W = 820, H = 280, padL = 44, padB = 38, padR = 24, padT = 24
  const chartW = W - padL - padR, chartH = H - padB - padT
  const toX = (i: number) => padL + (i / (data.length - 1)) * chartW
  const toY = (pct: number) => padT + chartH - (pct / 100) * chartH
  const labelEvery = Math.max(1, Math.floor(data.length / 10))
  const fmtD = (d: string) => { const dt = new Date(d); return `${dt.toLocaleString('en', { month: 'short' })} ${dt.getFullYear()}` }

  // Clip path for animated draw
  const clipW = padL + chartW * progress

  const pathD = data.map((d, i) => `${i === 0 ? 'M' : 'L'} ${toX(i)} ${toY(d.pct)}`).join(' ')
  const areaD = `${pathD} L ${toX(data.length - 1)} ${padT + chartH} L ${toX(0)} ${padT + chartH} Z`

  return (
    <div style={{ width: '100%', overflowX: 'auto' }}>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: 'block', minWidth: 400 }} onMouseLeave={() => setHov(null)}>
        <defs>
          <linearGradient id="pgGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={D.amber} stopOpacity="0.35" />
            <stop offset="60%" stopColor={D.amber} stopOpacity="0.08" />
            <stop offset="100%" stopColor={D.amber} stopOpacity="0" />
          </linearGradient>
          <linearGradient id="lineGrad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor={D.amberD} />
            <stop offset="50%" stopColor={D.amber} />
            <stop offset="100%" stopColor={D.amberL} />
          </linearGradient>
          <clipPath id="pgClip">
            <rect x="0" y="0" width={clipW} height={H} />
          </clipPath>
        </defs>

        {/* Grid */}
        {[0, 25, 50, 75, 100].map(v => {
          const y = toY(v)
          return <g key={v}>
            <line x1={padL} y1={y} x2={W - padR} y2={y} stroke={v === 50 ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.04)'} strokeWidth={1} strokeDasharray={v === 50 ? '4 4' : undefined} />
            <text x={padL - 8} y={y + 4} textAnchor="end" fill={D.muted} fontSize="9" fontFamily="var(--font-mono)">{v}%</text>
          </g>
        })}

        {/* Area + line clipped to animated width */}
        <g clipPath="url(#pgClip)">
          <path d={areaD} fill="url(#pgGrad)" />
          <path d={pathD} fill="none" stroke="url(#lineGrad)" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
        </g>

        {/* Hover dots */}
        {data.map((d, i) => (
          <circle key={i} cx={toX(i)} cy={toY(d.pct)} r={hov === i ? 6 : 3}
            fill={hov === i ? D.amberL : D.amber} opacity={hov === i ? 1 : 0.5}
            style={{ cursor: 'pointer', transition: 'r 0.15s, opacity 0.15s' }}
            onMouseEnter={() => setHov(i)} />
        ))}

        {/* Tooltip */}
        {hov !== null && (() => {
          const d = data[hov], x = toX(hov), y = toY(d.pct)
          const tx = Math.min(x - 55, W - padR - 120), ty = Math.max(padT + 4, y - 50)
          return <g>
            <line x1={x} y1={y} x2={x} y2={padT + chartH} stroke={`${D.amber}44`} strokeWidth={1} strokeDasharray="3 3" />
            <rect x={tx} y={ty} width={120} height={38} rx={6} fill="#0a0a0c" stroke={`${D.amber}44`} strokeWidth={1} />
            <text x={tx + 10} y={ty + 14} fill={D.amber} fontSize="9" fontFamily="var(--font-mono)">{fmtD(d.date)}</text>
            <text x={tx + 10} y={ty + 30} fill={D.text} fontSize="11" fontFamily="var(--font-mono)" fontWeight="600">{d.pct.toFixed(1)}% complete</text>
          </g>
        })()}

        {/* X axis */}
        {data.filter((_, i) => i % labelEvery === 0 || i === data.length - 1).map(d => {
          const i = data.indexOf(d)
          return <text key={d.date} x={toX(i)} y={H - 6} textAnchor="middle" fill={D.muted} fontSize="8" fontFamily="var(--font-mono)">{fmtD(d.date)}</text>
        })}
        <text x={W - padR} y={toY(100) + 4} textAnchor="end" fill={D.amber} fontSize="9" fontFamily="var(--font-mono)" fontWeight="700">100%</text>
        <text x={W - padR} y={toY(50) + 4} textAnchor="end" fill={D.muted} fontSize="9" fontFamily="var(--font-mono)">50%</text>
      </svg>
    </div>
  )
}

/* ── Gantt ─────────────────────────────────────────────────── */
function GanttChart({ data }: { data: Array<{ entity: string; start: string; end: string }> }) {
  const [ready, setReady] = useState(false)
  const [hov, setHov] = useState<string | null>(null)
  useEffect(() => { const t = setTimeout(() => setReady(true), 200); return () => clearTimeout(t) }, [])
  if (!data.length) return <div style={{ color: D.muted, fontFamily: 'var(--font-mono)', fontSize: 12, padding: 20, textAlign: 'center' }}>No data</div>

  const allDates = data.flatMap(d => [new Date(d.start), new Date(d.end)])
  const minDate = new Date(Math.min(...allDates.map(d => d.getTime())))
  const maxDate = new Date(Math.max(...allDates.map(d => d.getTime())))
  const totalDays = (maxDate.getTime() - minDate.getTime()) / 86400000
  const toX = (s: string) => `${((new Date(s).getTime() - minDate.getTime()) / 86400000 / totalDays) * 100}%`
  const toW = (s: string, e: string) => `${Math.max(0.5, ((new Date(e).getTime() - new Date(s).getTime()) / 86400000 / totalDays) * 100)}%`

  const months: { label: string; pct: number }[] = []
  const cur = new Date(minDate.getFullYear(), minDate.getMonth(), 1)
  while (cur <= maxDate) {
    const pct = (cur.getTime() - minDate.getTime()) / (maxDate.getTime() - minDate.getTime()) * 100
    if (pct >= 0 && pct <= 100) months.push({ label: cur.toLocaleString('en', { month: 'short', year: '2-digit' }), pct })
    cur.setMonth(cur.getMonth() + 1)
  }

  const COLORS = ['#d4a040', '#c49030', '#b48020', '#a47020', '#946010']

  return (
    <div>
      {/* Month header */}
      <div style={{ position: 'relative', height: 22, marginLeft: 130, marginBottom: 6 }}>
        {months.map((m, i) => <div key={i} style={{ position: 'absolute', left: `${m.pct}%`, fontSize: 9, color: D.muted, fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap', transform: 'translateX(-50%)' }}>{m.label}</div>)}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        {data.map((row, i) => (
          <div key={row.entity} style={{ display: 'flex', alignItems: 'center', gap: 10 }}
            onMouseEnter={() => setHov(row.entity)} onMouseLeave={() => setHov(null)}>
            <div style={{ width: 130, flexShrink: 0, fontSize: 11, color: hov === row.entity ? D.text : D.muted, fontFamily: 'var(--font-mono)', textAlign: 'right', paddingRight: 10, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', transition: 'color 0.2s' }}>{row.entity}</div>
            <div style={{ flex: 1, height: 30, background: 'rgba(255,255,255,0.03)', borderRadius: 5, position: 'relative', overflow: 'hidden', border: `1px solid ${D.border}` }}>
              {/* Today line */}
              <div style={{ position: 'absolute', left: `${Math.min(100, Math.max(0, (new Date().getTime() - minDate.getTime()) / (maxDate.getTime() - minDate.getTime()) * 100))}%`, top: 0, bottom: 0, width: 1.5, background: D.red, opacity: 0.8, zIndex: 2 }} />
              {/* Bar */}
              <div style={{ position: 'absolute', left: toX(row.start), width: ready ? toW(row.start, row.end) : '0%', top: 4, bottom: 4, borderRadius: 3, background: `linear-gradient(90deg, ${COLORS[i % COLORS.length]}, ${COLORS[i % COLORS.length]}88)`, transition: 'width 1.2s cubic-bezier(0.16,1,0.3,1)', display: 'flex', alignItems: 'center', paddingLeft: 8, boxShadow: hov === row.entity ? `0 0 12px ${COLORS[i % COLORS.length]}55` : 'none' }}>
                <span style={{ fontSize: 9, color: 'rgba(0,0,0,0.8)', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap', overflow: 'hidden', fontWeight: 700 }}>{fmtDate(row.start)} → {fmtDate(row.end)}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14 }}>
        <div style={{ width: 2, height: 14, background: D.red, borderRadius: 1 }} />
        <span style={{ fontSize: 9, color: D.muted, fontFamily: 'var(--font-mono)' }}>Today</span>
      </div>
    </div>
  )
}

/* ── Monthly Progress Table ────────────────────────────────── */
function MonthlyProgressTable({ data, months }: { data: ProgressData['monthlyProgress']; months: string[] }) {
  const entityGroups = data.reduce((acc, row) => { if (!acc[row.entity]) acc[row.entity] = []; acc[row.entity].push(row); return acc }, {} as Record<string, typeof data>)
  const [expanded, setExpanded] = useState<Set<string>>(new Set(Object.keys(entityGroups)))
  const displayMonths = months.slice(-8)
  const SIDE_COLOR: Record<string, string> = { LHS: D.amber, RHS: D.blue, MEDIAN: D.green }
  const toggle = (e: string) => setExpanded(prev => { const n = new Set(prev); n.has(e) ? n.delete(e) : n.add(e); return n })

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
        <thead>
          <tr style={{ borderBottom: `1px solid ${D.border}` }}>
            <th style={{ padding: '10px 14px', textAlign: 'left', color: D.amber, fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', whiteSpace: 'nowrap', minWidth: 220 }}>Entity / Side</th>
            {displayMonths.map(m => <th key={m} style={{ padding: '10px 14px', textAlign: 'right', color: D.amber, fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.08em', whiteSpace: 'nowrap', minWidth: 100 }}>{fmtMonth(m)}</th>)}
            <th style={{ padding: '10px 14px', textAlign: 'right', color: D.amber, fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.12em', whiteSpace: 'nowrap' }}>Total</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(entityGroups).map(([entityName, sideRows]) => {
            const isExpanded = expanded.has(entityName)
            const validTotals = sideRows.filter(r => r.total_completion != null).map(r => r.total_completion as number)
            const entityTotal = validTotals.length > 0 ? validTotals.reduce((s, v) => s + v, 0) / validTotals.length : null
            return (
              <>
                <tr key={`${entityName}-h`} onClick={() => toggle(entityName)} className="tbl-row-header" style={{ cursor: 'pointer', borderBottom: `1px solid ${D.border}`, background: 'rgba(255,255,255,0.02)' }}>
                  <td style={{ padding: '11px 14px', color: D.text, fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontSize: 10, color: D.amber, transition: 'transform 0.2s', display: 'inline-block', transform: isExpanded ? 'rotate(0deg)' : 'rotate(-90deg)' }}>▼</span>
                      {entityName}
                      <span style={{ fontSize: 9, color: D.sub, background: `${D.amber}10`, border: `1px solid ${D.amber}20`, padding: '1px 6px', borderRadius: 4 }}>{sideRows.length}</span>
                    </div>
                  </td>
                  {displayMonths.map(m => <td key={m} />)}
                  <td style={{ padding: '11px 14px', textAlign: 'right', color: D.amber, fontFamily: 'var(--font-mono)', fontWeight: 700 }}>{entityTotal != null ? `${entityTotal.toFixed(2)}%` : '—'}</td>
                </tr>
                {isExpanded && sideRows.map(row => {
                  const sc = SIDE_COLOR[row.side] || D.muted
                  return (
                    <>
                      <tr key={`${entityName}-${row.side}-l`} style={{ borderBottom: `1px solid rgba(255,255,255,0.02)`, background: 'rgba(255,255,255,0.01)' }}>
                        <td style={{ padding: '7px 14px 3px 30px', color: sc, fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 600 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><div style={{ width: 5, height: 5, borderRadius: '50%', background: sc, boxShadow: `0 0 6px ${sc}` }} />{row.side}</div>
                        </td>
                        {displayMonths.map(m => <td key={m} />)}
                        <td style={{ padding: '7px 14px 3px', textAlign: 'right', color: row.total_completion != null ? sc : D.sub, fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 600 }}>{row.total_completion != null ? `${(row.total_completion as number).toFixed(2)}%` : '—'}</td>
                      </tr>
                      <tr key={`${entityName}-${row.side}-c`} style={{ borderBottom: `1px solid rgba(255,255,255,0.015)` }}>
                        <td style={{ padding: '3px 14px 3px 42px', color: D.sub, fontFamily: 'var(--font-mono)', fontSize: 10 }}>Cumulative_%_Completion</td>
                        {displayMonths.map(m => { const val = row.months.find(mo => mo.month === m)?.cumulative_pct; return <td key={m} style={{ padding: '3px 14px', textAlign: 'right', color: val != null ? D.green : 'transparent', fontFamily: 'var(--font-mono)', fontSize: 11 }}>{val != null ? `${val.toFixed(2)}%` : ''}</td> })}
                        <td style={{ padding: '3px 14px', textAlign: 'right', color: row.total_completion != null ? D.green : D.sub, fontFamily: 'var(--font-mono)', fontSize: 11 }}>{row.total_completion != null ? `${(row.total_completion as number).toFixed(2)}%` : '—'}</td>
                      </tr>
                      <tr key={`${entityName}-${row.side}-p`} style={{ borderBottom: `1px solid ${D.border}` }}>
                        <td style={{ padding: '3px 14px 8px 42px', color: D.sub, fontFamily: 'var(--font-mono)', fontSize: 10 }}>Cumulative_Pending_%</td>
                        {displayMonths.map(m => { const val = row.months.find(mo => mo.month === m)?.cumulative_pct; const pv = val != null ? 100 - val : null; return <td key={m} style={{ padding: '3px 14px 8px', textAlign: 'right', color: pv != null ? D.amber : 'transparent', fontFamily: 'var(--font-mono)', fontSize: 11 }}>{pv != null ? `${pv.toFixed(2)}%` : ''}</td> })}
                        <td style={{ padding: '3px 14px 8px', textAlign: 'right', color: row.total_completion != null ? D.amber : D.sub, fontFamily: 'var(--font-mono)', fontSize: 11 }}>{row.total_completion != null ? `${(100 - (row.total_completion as number)).toFixed(2)}%` : '—'}</td>
                      </tr>
                    </>
                  )
                })}
              </>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/* ── Delay Donut ───────────────────────────────────────────── */
function DelayDonut({ delayed, onSchedule }: { delayed: number; onSchedule: number }) {
  const [ready, setReady] = useState(false)
  useEffect(() => { const t = setTimeout(() => setReady(true), 400); return () => clearTimeout(t) }, [])
  const total = delayed + onSchedule; if (!total) return null
  const r = 62, sw = 20, circ = 2 * Math.PI * r
  const onLen = (onSchedule / total) * circ, delLen = (delayed / total) * circ
  return (
    <div style={{ display: 'flex', gap: 28, alignItems: 'center', flexWrap: 'wrap' }}>
      <svg width={160} height={160} viewBox="-80 -80 160 160" style={{ flexShrink: 0 }}>
        <circle r={r} fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth={sw} />
        <circle r={r} fill="none" stroke={D.green} strokeWidth={sw} strokeDasharray={`${ready ? onLen : 0} ${circ}`} strokeLinecap="butt" style={{ transition: 'stroke-dasharray 1.2s cubic-bezier(0.16,1,0.3,1)', filter: ready ? `drop-shadow(0 0 6px ${D.green}66)` : 'none' }} />
        <circle r={r} fill="none" stroke={D.amber} strokeWidth={sw} strokeDasharray={`${ready ? delLen : 0} ${circ}`} strokeDashoffset={-onLen} strokeLinecap="butt" style={{ transition: 'stroke-dasharray 1.2s cubic-bezier(0.16,1,0.3,1) 0.15s', filter: ready ? `drop-shadow(0 0 6px ${D.amber}66)` : 'none' }} />
        <text x="0" y="-8" textAnchor="middle" fill={D.text} fontFamily="var(--font-loader)" fontSize="24">{total.toLocaleString()}</text>
        <text x="0" y="12" textAnchor="middle" fill={D.muted} fontFamily="var(--font-mono)" fontSize="8" letterSpacing="1.5">ENTITIES</text>
      </svg>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {[{ label: 'On Schedule', val: onSchedule, color: D.green }, { label: 'Delayed', val: delayed, color: D.amber }].map(({ label, val, color }) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: color, boxShadow: `0 0 8px ${color}` }} />
            <div>
              <div style={{ fontSize: 14, color: D.text, fontFamily: 'var(--font-mono)', fontWeight: 700 }}>{val.toLocaleString()} <span style={{ fontSize: 10, color: D.muted }}>({Math.round(val / total * 100)}%)</span></div>
              <div style={{ fontSize: 10, color: D.muted, fontFamily: 'var(--font-mono)' }}>{label}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ── Days by Entity ────────────────────────────────────────── */
function DaysByEntityChart({ data }: { data: ProgressData['daysByEntity'] }) {
  const [ready, setReady] = useState(false)
  const [hov, setHov] = useState<string | null>(null)
  useEffect(() => { const t = setTimeout(() => setReady(true), 500); return () => clearTimeout(t) }, [])
  const allVals = data.flatMap(d => [d.lhs, d.rhs, d.median].filter(Boolean) as number[])
  const maxVal = Math.max(...allVals, 1)
  const BAR_W = 13
  return (
    <div style={{ overflowX: 'auto' }}>
      <div style={{ display: 'flex', gap: 18, marginBottom: 10 }}>
        {[{ label: 'LHS', color: D.amber }, { label: 'MEDIAN', color: D.muted }, { label: 'RHS', color: D.sub }].map(l => (
          <div key={l.label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 8, height: 8, borderRadius: 2, background: l.color }} />
            <span style={{ fontSize: 10, color: D.muted, fontFamily: 'var(--font-mono)' }}>{l.label}</span>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6 }}>
        {data.map((d, i) => (
          <div key={d.entity} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5 }} onMouseEnter={() => setHov(d.entity)} onMouseLeave={() => setHov(null)}>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 130 }}>
              {([{ val: d.lhs, color: D.amber }, { val: d.median, color: D.muted }, { val: d.rhs, color: D.sub }] as const).map((b, bi) => (
                <div key={bi} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', height: '100%' }}>
                  {b.val != null && <span style={{ fontSize: 9, color: hov === d.entity ? D.text : D.sub, fontFamily: 'var(--font-mono)', marginBottom: 3, transition: 'color 0.2s' }}>{b.val}</span>}
                  <div style={{ width: BAR_W, borderRadius: '3px 3px 0 0', height: ready && b.val != null ? `${(b.val / maxVal) * 100}%` : '0%', background: b.val != null ? b.color : 'transparent', transition: `height 1s cubic-bezier(0.16,1,0.3,1) ${i * 0.06}s`, opacity: hov && hov !== d.entity ? 0.3 : 1, boxShadow: hov === d.entity && b.val != null ? `0 0 10px ${b.color}66` : 'none' }} />
                </div>
              ))}
            </div>
            <span style={{ fontSize: 9, color: hov === d.entity ? D.amber : D.muted, fontFamily: 'var(--font-mono)', textAlign: 'center', maxWidth: 65, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', transition: 'color 0.2s' }}>{d.entity}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ── Delay Table ───────────────────────────────────────────── */
function DelayTable({ data }: { data: ProgressData['delayData'] }) {
  const [page, setPage] = useState(0)
  const PAGE = 20, total = data.length
  const pageData = data.slice(page * PAGE, page * PAGE + PAGE)
  return (
    <div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
          <thead><tr style={{ borderBottom: `1px solid ${D.border}` }}>{['Entity', 'Side', 'Planned Month', 'Started Date', 'Completed Date', 'Delay Days', 'Status'].map(h => <th key={h} style={{ padding: '10px 14px', textAlign: 'left', color: D.amber, fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{h}</th>)}</tr></thead>
          <tbody>
            {pageData.map((r, i) => {
              const isD = r.performance_status === 'Delayed'
              return <tr key={i} className="tbl-row" style={{ borderBottom: `1px solid rgba(255,255,255,0.03)` }}>
                <td style={{ padding: '10px 14px', color: D.text, fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{r.entity_name || '—'}</td>
                <td style={{ padding: '10px 14px', color: D.muted, fontFamily: 'var(--font-mono)' }}>{r.side || '—'}</td>
                <td style={{ padding: '10px 14px', color: D.muted, fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>{fmtDate(r.planned_date)}</td>
                <td style={{ padding: '10px 14px', color: D.muted, fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>{fmtDate(r.date_started)}</td>
                <td style={{ padding: '10px 14px', color: D.muted, fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>{fmtDate(r.date_completed)}</td>
                <td style={{ padding: '10px 14px', color: isD ? D.amber : D.green, fontFamily: 'var(--font-mono)', fontWeight: 700 }}>{r.delay_days}</td>
                <td style={{ padding: '10px 14px' }}><span style={{ background: isD ? 'rgba(212,160,64,0.12)' : 'rgba(52,211,153,0.12)', color: isD ? D.amber : D.green, border: `1px solid ${isD ? D.amber : D.green}30`, padding: '3px 10px', borderRadius: 5, fontFamily: 'var(--font-mono)', fontSize: 10 }}>{r.performance_status}</span></td>
              </tr>
            })}
          </tbody>
        </table>
      </div>
      {total > PAGE && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 14 }}>
          <button className="btn-ghost" onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} style={{ background: 'transparent', color: page === 0 ? D.sub : D.amber, border: `1px solid ${page === 0 ? D.sub : D.amber}30`, borderRadius: 7, padding: '6px 16px', fontSize: 11, cursor: page === 0 ? 'not-allowed' : 'pointer', fontFamily: 'var(--font-mono)' }}>‹ Prev</button>
          <span style={{ fontSize: 10, color: D.sub, fontFamily: 'var(--font-mono)' }}>{page * PAGE + 1}–{Math.min((page + 1) * PAGE, total)} of {total.toLocaleString()}</span>
          <button className="btn-ghost" onClick={() => setPage(p => Math.min(Math.ceil(total / PAGE) - 1, p + 1))} style={{ background: 'transparent', color: D.amber, border: `1px solid ${D.amber}30`, borderRadius: 7, padding: '6px 16px', fontSize: 11, cursor: 'pointer', fontFamily: 'var(--font-mono)' }}>Next ›</button>
        </div>
      )}
    </div>
  )
}

/* ── BOQ Table ─────────────────────────────────────────────── */
function BOQTable({ items, byCategory }: { items: ProgressData['boqItems']; byCategory: ProgressData['boqByCategory'] }) {
  const [view, setView] = useState<'summary' | 'detail'>('summary')
  const [page, setPage] = useState(0)
  const PAGE = 20
  const pageItems = items.slice(page * PAGE, page * PAGE + PAGE)
  const totalQty = items.reduce((s, i) => s + (i.qty || 0), 0)
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
        <div style={{ background: 'rgba(212,160,64,0.08)', border: `1px solid rgba(212,160,64,0.2)`, borderRadius: 10, padding: '10px 18px' }}>
          <div style={{ fontSize: 10, color: D.muted, fontFamily: 'var(--font-mono)', letterSpacing: 1.5, marginBottom: 3 }}>ACTUAL QUANTITY</div>
          <div style={{ fontSize: 22, color: D.amber, fontFamily: 'var(--font-loader)', textShadow: `0 0 20px ${D.amber}44` }}>{(totalQty / 1000).toFixed(0)}K</div>
        </div>
        <div style={{ display: 'flex', gap: 6, background: D.bg, borderRadius: 8, padding: 4, border: `1px solid ${D.border}` }}>
          {(['summary', 'detail'] as const).map(v => <button key={v} className={view === v ? undefined : 'seg-btn'} onClick={() => setView(v)} style={{ background: view === v ? D.amber : 'transparent', color: view === v ? '#000' : D.muted, border: 'none', borderRadius: 5, padding: '5px 16px', fontSize: 11, cursor: 'pointer', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: 1, fontWeight: view === v ? 700 : 400 }}>{v}</button>)}
        </div>
      </div>
      {view === 'summary' ? (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
          <thead><tr style={{ borderBottom: `1px solid ${D.border}` }}>{['Category', 'Items', 'Total Qty', 'Amount'].map(h => <th key={h} style={{ padding: '10px 14px', textAlign: 'left', color: D.amber, fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase' }}>{h}</th>)}</tr></thead>
          <tbody>
            {byCategory.map((r, i) => <tr key={i} className="tbl-row" style={{ borderBottom: `1px solid rgba(255,255,255,0.03)` }}>
              <td style={{ padding: '10px 14px', color: D.text, fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{r.category}</td>
              <td style={{ padding: '10px 14px', color: D.muted, fontFamily: 'var(--font-mono)' }}>{r.items}</td>
              <td style={{ padding: '10px 14px', color: D.text, fontFamily: 'var(--font-mono)' }}>{r.qty.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
              <td style={{ padding: '10px 14px', color: r.amount > 0 ? D.green : D.sub, fontFamily: 'var(--font-mono)' }}>{r.amount > 0 ? r.amount.toLocaleString() : '—'}</td>
            </tr>)}
          </tbody>
        </table>
      ) : (
        <>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
            <thead><tr style={{ borderBottom: `1px solid ${D.border}` }}>{['Description', 'Category', 'Type', 'Qty', 'Unit', 'Reports'].map(h => <th key={h} style={{ padding: '10px 14px', textAlign: 'left', color: D.amber, fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{h}</th>)}</tr></thead>
            <tbody>
              {pageItems.map((r: any, i: number) => <tr key={i} className="tbl-row" style={{ borderBottom: `1px solid rgba(255,255,255,0.03)` }}>
                <td style={{ padding: '10px 14px', color: D.text, maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.description}>{r.description}</td>
                <td style={{ padding: '10px 14px', color: D.muted, fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>{r.activity_category}</td>
                <td style={{ padding: '10px 14px', color: D.muted, fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>{r.activity_type}</td>
                <td style={{ padding: '10px 14px', color: D.text, fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>{r.qty?.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                <td style={{ padding: '10px 14px', color: D.sub, fontFamily: 'var(--font-mono)' }}>{r.unit}</td>
                <td style={{ padding: '10px 14px', fontFamily: 'var(--font-mono)' }}>{r.report_count > 0 ? <span style={{ background: 'rgba(52,211,153,0.12)', color: D.green, border: `1px solid rgba(52,211,153,0.25)`, padding: '2px 8px', borderRadius: 5, fontSize: 10 }}>{r.report_count}</span> : <span style={{ color: D.sub }}>—</span>}</td>
              </tr>)}
            </tbody>
          </table>
          {items.length > PAGE && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 14 }}>
              <button className="btn-ghost" onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} style={{ background: 'transparent', color: page === 0 ? D.sub : D.amber, border: `1px solid ${page === 0 ? D.sub : D.amber}30`, borderRadius: 7, padding: '6px 16px', fontSize: 11, cursor: page === 0 ? 'not-allowed' : 'pointer', fontFamily: 'var(--font-mono)' }}>‹ Prev</button>
              <span style={{ fontSize: 10, color: D.sub, fontFamily: 'var(--font-mono)' }}>{page * PAGE + 1}–{Math.min((page + 1) * PAGE, items.length)} of {items.length}</span>
              <button className="btn-ghost" onClick={() => setPage(p => Math.min(Math.ceil(items.length / PAGE) - 1, p + 1))} style={{ background: 'transparent', color: D.amber, border: `1px solid ${D.amber}30`, borderRadius: 7, padding: '6px 16px', fontSize: 11, cursor: 'pointer', fontFamily: 'var(--font-mono)' }}>Next ›</button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

/* ── Activity Reports ──────────────────────────────────────── */
function ActivityReportsPanel({ reportsByType, recentReports }: { reportsByType: ProgressData['reportsByType']; recentReports: ProgressData['recentReports'] }) {
  const [view, setView] = useState<'by_type' | 'recent'>('by_type')
  return (
    <div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 18, background: D.bg, borderRadius: 8, padding: 4, border: `1px solid ${D.border}`, width: 'fit-content' }}>
        {([{ key: 'by_type', label: 'By Activity Type' }, { key: 'recent', label: 'Recent Reports' }] as const).map(v => <button key={v.key} className={view === v.key ? undefined : 'seg-btn'} onClick={() => setView(v.key)} style={{ background: view === v.key ? D.amber : 'transparent', color: view === v.key ? '#000' : D.muted, border: 'none', borderRadius: 5, padding: '5px 16px', fontSize: 11, cursor: 'pointer', fontFamily: 'var(--font-mono)', letterSpacing: 1, textTransform: 'uppercase', fontWeight: view === v.key ? 700 : 400 }}>{v.label}</button>)}
      </div>
      {view === 'by_type' ? (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
          <thead><tr style={{ borderBottom: `1px solid ${D.border}` }}>{['Activity Type', 'Total Reports', 'Completed', 'In Progress', 'Linked Entities', 'Latest Activity'].map(h => <th key={h} style={{ padding: '10px 14px', textAlign: 'left', color: D.amber, fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{h}</th>)}</tr></thead>
          <tbody>
            {reportsByType.map((r, i) => <tr key={i} className="tbl-row" style={{ borderBottom: `1px solid rgba(255,255,255,0.03)` }}>
              <td style={{ padding: '10px 14px', color: D.text, fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{r.type}</td>
              <td style={{ padding: '10px 14px', color: D.text, fontFamily: 'var(--font-mono)' }}>{r.count}</td>
              <td style={{ padding: '10px 14px', color: D.green, fontFamily: 'var(--font-mono)' }}>{r.completed}</td>
              <td style={{ padding: '10px 14px', color: D.amber, fontFamily: 'var(--font-mono)' }}>{r.inProgress}</td>
              <td style={{ padding: '10px 14px', fontFamily: 'var(--font-mono)' }}>{r.linked ? <span style={{ background: 'rgba(96,165,250,0.12)', color: D.blue, border: `1px solid rgba(96,165,250,0.25)`, padding: '2px 8px', borderRadius: 5, fontSize: 10 }}>{r.linked}</span> : <span style={{ color: D.sub }}>—</span>}</td>
              <td style={{ padding: '10px 14px', color: D.muted, fontFamily: 'var(--font-mono)' }}>{r.latest ? new Date(r.latest).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' }) : '—'}</td>
            </tr>)}
          </tbody>
        </table>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
          <thead><tr style={{ borderBottom: `1px solid ${D.border}` }}>{['Date', 'Activity Type', 'Category', 'Status', 'Reporter', 'Section', 'Chainage'].map(h => <th key={h} style={{ padding: '10px 14px', textAlign: 'left', color: D.amber, fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{h}</th>)}</tr></thead>
          <tbody>
            {recentReports.map((r, i) => {
              const sc: Record<string, string> = { Completed: D.green, Complete: D.green, 'In Progress': D.amber, Ongoing: D.amber, Pending: D.blue }
              const statusColor = sc[r.activity_status] || D.sub
              return <tr key={i} className="tbl-row" style={{ borderBottom: `1px solid rgba(255,255,255,0.03)` }}>
                <td style={{ padding: '10px 14px', color: D.muted, fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>{r.date_of_activity ? new Date(r.date_of_activity).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' }) : '—'}</td>
                <td style={{ padding: '10px 14px', color: D.text, fontFamily: 'var(--font-mono)', fontWeight: 600, whiteSpace: 'nowrap' }}>{r.activity_type || '—'}</td>
                <td style={{ padding: '10px 14px', color: D.muted, fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>{r.activity_category || '—'}</td>
                <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}><span style={{ background: `${statusColor}15`, color: statusColor, border: `1px solid ${statusColor}30`, padding: '3px 10px', borderRadius: 5, fontFamily: 'var(--font-mono)', fontSize: 10 }}>{r.activity_status || '—'}</span></td>
                <td style={{ padding: '10px 14px', color: D.text, fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>{r.reporter_name || '—'}</td>
                <td style={{ padding: '10px 14px', color: D.muted, fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>{r.section_name || '—'}</td>
                <td style={{ padding: '10px 14px', color: D.muted, fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>{r.start_chainage || '—'}</td>
              </tr>
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}

/* ── Skeleton ──────────────────────────────────────────────── */
function Skeleton({ h }: { h: number }) {
  return (
    <div style={{ height: h, borderRadius: 16, background: D.panel, position: 'relative', overflow: 'hidden', border: `1px solid ${D.border}` }}>
      <div style={{ position: 'absolute', inset: 0, background: `linear-gradient(90deg, transparent 0%, rgba(212,160,64,0.04) 50%, transparent 100%)`, animation: 'shimmer 2s ease-in-out infinite' }} />
    </div>
  )
}

const IconCheck = () => <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
const IconClock = () => <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
const IconAlert = () => <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
const IconList  = () => <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>

/* ── Main Page ─────────────────────────────────────────────── */
function ProgressPageInner() {
  const [data, setData]           = useState<ProgressData | null>(null)
  const [loading, setLoading]     = useState(true)
  const [filtering, setFiltering] = useState(false)
  const [error, setError]         = useState('')
  const [activeTab, setActiveTab] = useState<'overview' | 'planning' | 'boq' | 'reports'>('overview')

  const [filterEntity, setFilterEntity] = useState('')
  const [filterSide,   setFilterSide]   = useState('')
  const [filterMonth,  setFilterMonth]  = useState('')
  const [chFrom,       setChFrom]       = useState('')
  const [chTo,         setChTo]         = useState('')
  const [applied, setApplied] = useState({ entity: '', side: '', month: '', chFrom: '', chTo: '' })

  const loadData = useCallback((params: { entity: string; side: string; month: string; chFrom: string; chTo: string }, isFilter = false) => {
    if (isFilter) setFiltering(true); else setLoading(true)
    const qs = new URLSearchParams({ project: 'Coastal Road' })
    if (params.entity) qs.set('entity', params.entity)
    if (params.side)   qs.set('side',   params.side)
    if (params.month)  qs.set('month',  params.month)
    if (params.chFrom && params.chTo) { qs.set('ch_from', params.chFrom); qs.set('ch_to', params.chTo) }
    fetch(`/api/progress?${qs.toString()}`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); setFiltering(false) })
      .catch(() => { setError('Failed to load data'); setLoading(false); setFiltering(false) })
  }, [])

  useEffect(() => { loadData({ entity: '', side: '', month: '', chFrom: '', chTo: '' }) }, [loadData])

  const applyFilters = () => {
    const params = { entity: filterEntity, side: filterSide, month: filterMonth, chFrom, chTo }
    setApplied(params)
    loadData(params, true)
  }

  const clearFilters = () => {
    setFilterEntity(''); setFilterSide(''); setFilterMonth(''); setChFrom(''); setChTo('')
    const p = { entity: '', side: '', month: '', chFrom: '', chTo: '' }
    setApplied(p); loadData(p, true)
  }

  const hasFilters = !!(applied.entity || applied.side || applied.month || applied.chFrom)

  const selectStyle: React.CSSProperties = { background: '#0e0e10', color: D.text, border: `1px solid ${D.border}`, borderRadius: 8, padding: '7px 12px', fontSize: 12, fontFamily: 'var(--font-mono)', cursor: 'pointer', minWidth: 148, outline: 'none' }
  const inputStyle:  React.CSSProperties = { ...selectStyle, minWidth: 108 }
  const labelStyle:  React.CSSProperties = { fontSize: 10, color: D.muted, letterSpacing: 1.5, fontFamily: 'var(--font-mono)', textTransform: 'uppercase' as const, marginBottom: 5 }

  const CHIP_COLORS: Record<string, string> = { entity: D.amber, side: D.blue, month: D.green, ch: D.purple }

  return (
    <div style={{ minHeight: '100vh', background: D.bg, color: D.text, fontFamily: 'var(--font-dm-sans)', position: 'relative' }}>

      {/* Ambient background glows */}
      <div style={{ position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', width: 800, height: 800, borderRadius: '50%', background: 'radial-gradient(circle, rgba(212,160,64,0.03) 0%, transparent 65%)', top: '-10%', right: '-10%', animation: 'float1 28s ease-in-out infinite' }} />
        <div style={{ position: 'absolute', width: 600, height: 600, borderRadius: '50%', background: 'radial-gradient(circle, rgba(52,211,153,0.02) 0%, transparent 65%)', bottom: '5%', left: '-5%', animation: 'float2 34s ease-in-out infinite' }} />
        {/* Subtle grid */}
        <div style={{ position: 'absolute', inset: 0, backgroundImage: 'linear-gradient(rgba(255,255,255,0.012) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.012) 1px, transparent 1px)', backgroundSize: '60px 60px', opacity: 0.6 }} />
      </div>

      {/* Sub-header */}
      <div className="sub-header-bar" style={{ position: 'sticky', top: 52, zIndex: 50, background: 'rgba(14,14,16,0.95)', backdropFilter: 'blur(12px)', borderBottom: `1px solid ${D.border}`, padding: '0 32px', display: 'flex', alignItems: 'center', gap: 20, height: 46, overflowX: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <span style={{ fontFamily: 'var(--font-loader)', fontSize: '1.05rem', letterSpacing: '0.14em', color: D.amber, textShadow: `0 0 20px ${D.amber}44` }}>PROGRESS</span>
          <span className="sub-badge" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.52rem', letterSpacing: '0.14em', color: D.sub, textTransform: 'uppercase', background: D.panel, padding: '2px 8px', borderRadius: 4, border: `1px solid ${D.border}` }}>Coastal Road · 1b&c</span>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 2, marginLeft: 20, background: D.bg, borderRadius: 8, padding: 3, border: `1px solid ${D.border}`, flexShrink: 0 }}>
          {([{ key: 'overview', label: 'Overview' }, { key: 'planning', label: 'Planning' }, { key: 'boq', label: 'BOQ' }, { key: 'reports', label: 'Activity Reports' }] as const).map(t => (
            <button key={t.key} className={activeTab === t.key ? undefined : 'seg-btn'} onClick={() => setActiveTab(t.key)} style={{ background: activeTab === t.key ? D.amber : 'transparent', color: activeTab === t.key ? '#000' : D.sub, border: 'none', borderRadius: 6, padding: '4px 14px', fontSize: 11, cursor: 'pointer', fontFamily: 'var(--font-mono)', letterSpacing: 0.8, textTransform: 'uppercase', fontWeight: activeTab === t.key ? 700 : 400, boxShadow: activeTab === t.key ? `0 0 12px ${D.amber}44` : 'none' }}>{t.label}</button>
          ))}
        </div>

        {/* Filter loading indicator */}
        {filtering && <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto' }}>
          <div style={{ width: 5, height: 5, borderRadius: '50%', background: D.amber, animation: 'pulse 1s ease-in-out infinite' }} />
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.52rem', color: D.amber, letterSpacing: '0.1em' }}>FILTERING…</span>
        </div>}

        <div className="sub-date" style={{ marginLeft: filtering ? 0 : 'auto', flexShrink: 0, fontSize: '0.55rem', color: D.sub, fontFamily: 'var(--font-mono)' }}>
          {new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
        </div>
      </div>

      <div className="dash-content" style={{ padding: '28px 32px 80px', maxWidth: 1480, margin: '0 auto', position: 'relative', zIndex: 1 }}>
        {error && <div style={{ background: 'rgba(248,113,113,0.06)', border: `1px solid rgba(248,113,113,0.2)`, borderRadius: 12, padding: '14px 18px', color: D.red, fontFamily: 'var(--font-mono)', fontSize: '0.78rem', marginBottom: 20 }}>{error}</div>}

        {/* ── Filter Bar ── */}
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end', padding: '16px 20px', background: D.panel, border: `1px solid ${D.border}`, borderRadius: 14, marginBottom: 24, boxShadow: SH_PANEL, opacity: filtering ? 0.75 : 1, transition: `opacity 0.3s ${EASE}` }}>
          {[
            { label: 'Entity', el: <select value={filterEntity} onChange={e => setFilterEntity(e.target.value)} style={selectStyle}><option value=''>All Entities</option>{(data?.filterOptions.entities ?? []).map(e => <option key={e} value={e}>{e}</option>)}</select> },
            { label: 'Side',   el: <select value={filterSide}   onChange={e => setFilterSide(e.target.value)}   style={{ ...selectStyle, minWidth: 110 }}><option value=''>All Sides</option><option value='LHS'>LHS</option><option value='RHS'>RHS</option><option value='MEDIAN'>MEDIAN</option></select> },
            { label: 'Planned Month', el: <select value={filterMonth} onChange={e => setFilterMonth(e.target.value)} style={{ ...selectStyle, minWidth: 140 }}><option value=''>All Months</option>{(data?.filterOptions.months ?? []).map(m => <option key={m} value={m}>{fmtMonth(m)}</option>)}</select> },
            { label: 'Chainage From', el: <input type='number' placeholder='e.g. 20000' value={chFrom} onChange={e => setChFrom(e.target.value)} style={inputStyle} /> },
            { label: 'Chainage To',   el: <input type='number' placeholder='e.g. 35000' value={chTo}   onChange={e => setChTo(e.target.value)}   style={inputStyle} /> },
          ].map(({ label, el }) => (
            <div key={label} style={{ display: 'flex', flexDirection: 'column' }}>
              <div style={labelStyle}>{label}</div>
              {el}
            </div>
          ))}

          <button className="btn-primary-amber" onClick={applyFilters} style={{ background: `linear-gradient(135deg, ${D.amber}, ${D.amberL})`, color: '#000', border: 'none', borderRadius: 8, padding: '7px 22px', fontSize: 12, cursor: 'pointer', fontFamily: 'var(--font-mono)', letterSpacing: 1, alignSelf: 'flex-end', fontWeight: 700, boxShadow: `0 4px 16px ${D.amber}44`, textTransform: 'uppercase' }}>
            Apply
          </button>

          {hasFilters && <button className="btn-ghost" onClick={clearFilters} style={{ background: 'transparent', color: D.amber, border: `1px solid rgba(212,160,64,0.3)`, borderRadius: 8, padding: '7px 18px', fontSize: 12, cursor: 'pointer', fontFamily: 'var(--font-mono)', letterSpacing: 1, alignSelf: 'flex-end' }}>✕ Clear</button>}

          {hasFilters && (
            <div style={{ alignSelf: 'flex-end', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {applied.entity  && <span style={{ background: `rgba(212,160,64,0.1)`,  color: D.amber,  border: `1px solid rgba(212,160,64,0.25)`,  padding: '4px 10px', borderRadius: 6, fontFamily: 'var(--font-mono)', fontSize: 10, animation: 'chipIn 0.3s cubic-bezier(0.16,1,0.3,1)' }}>{applied.entity}</span>}
              {applied.side    && <span style={{ background: `rgba(96,165,250,0.1)`,  color: D.blue,   border: `1px solid rgba(96,165,250,0.25)`,  padding: '4px 10px', borderRadius: 6, fontFamily: 'var(--font-mono)', fontSize: 10, animation: 'chipIn 0.3s cubic-bezier(0.16,1,0.3,1)' }}>{applied.side}</span>}
              {applied.month   && <span style={{ background: `rgba(52,211,153,0.1)`,  color: D.green,  border: `1px solid rgba(52,211,153,0.25)`,  padding: '4px 10px', borderRadius: 6, fontFamily: 'var(--font-mono)', fontSize: 10, animation: 'chipIn 0.3s cubic-bezier(0.16,1,0.3,1)' }}>{fmtMonth(applied.month)}</span>}
              {applied.chFrom && applied.chTo && <span style={{ background: `rgba(167,139,250,0.1)`, color: D.purple, border: `1px solid rgba(167,139,250,0.25)`, padding: '4px 10px', borderRadius: 6, fontFamily: 'var(--font-mono)', fontSize: 10, animation: 'chipIn 0.3s cubic-bezier(0.16,1,0.3,1)' }}>CH {Number(applied.chFrom).toLocaleString()} → {Number(applied.chTo).toLocaleString()}</span>}
            </div>
          )}
        </div>

        {/* Content */}
        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="kpi-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 14 }}>{[0,1,2,3,4].map(i => <Skeleton key={i} h={110} />)}</div>
            <Skeleton h={320} /><Skeleton h={420} /><Skeleton h={320} />
          </div>
        ) : data && (
          <div style={{ opacity: filtering ? 0.55 : 1, filter: filtering ? 'blur(1.5px) saturate(0.85)' : 'blur(0) saturate(1)', transform: filtering ? 'scale(0.997)' : 'scale(1)', pointerEvents: filtering ? 'none' : 'auto', transition: `opacity 0.35s ${EASE}, filter 0.35s ${EASE}, transform 0.35s ${EASE}` }}>

            {/* ── OVERVIEW ── */}
            {activeTab === 'overview' && (
              <>
                <div className="kpi-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 14, marginBottom: 20 }}>
                  <KPICard label="Overall Completion"   value={data.summary.overallPct}    suffix="%" color={D.amber}  icon={<IconCheck />} delay={0}   glow={GLOW_AMBER} />
                  <KPICard label="Completed Activities" value={data.summary.totalCompleted}             color={D.green}  icon={<IconCheck />} delay={80}  glow={GLOW_GREEN} />
                  <KPICard label="Delayed Activities"   value={data.summary.delayed}                    color={D.red}    icon={<IconAlert />} delay={160} glow={GLOW_RED} />
                  <KPICard label="On Schedule"          value={data.summary.onSchedule}                 color={D.green}  icon={<IconClock />} delay={240} glow={GLOW_GREEN} />
                  <KPICard label="Total Entity Types"   value={data.summary.totalEntities}              color={D.purple} icon={<IconList  />} delay={320} />
                </div>
                <Reveal style={{ marginBottom: 16 }}><Panel title="Progress Curve — Cumulative Completion %"><ProgressCurve data={data.progressCurve} /></Panel></Reveal>
                <Reveal delay={60} style={{ marginBottom: 16 }}><Panel title="Monthly Progress"><MonthlyProgressTable data={data.monthlyProgress} months={data.allMonths} /></Panel></Reveal>
                <Reveal delay={120} style={{ marginBottom: 16 }}><Panel title="Visual Progress of Completion — Gantt Chart"><GanttChart data={data.ganttData} /></Panel></Reveal>
              </>
            )}

            {/* ── PLANNING ── */}
            {activeTab === 'planning' && (
              <>
                <Reveal style={{ marginBottom: 16 }}>
                  <div className="grid-responsive" style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 16 }}>
                    <Panel title="Delayed vs On Schedule"><DelayDonut delayed={data.summary.delayed} onSchedule={data.summary.onSchedule} /></Panel>
                    <Panel title="Number of Days for Completion by Entities"><DaysByEntityChart data={data.daysByEntity} /></Panel>
                  </div>
                </Reveal>
                <Reveal delay={60} style={{ marginBottom: 16 }}><Panel title="Activity Report for Planning"><DelayTable data={data.delayData} /></Panel></Reveal>
              </>
            )}

            {/* ── BOQ ── */}
            {activeTab === 'boq' && (
              <Reveal style={{ marginBottom: 16 }}><Panel title="Activity Report in BOQ"><BOQTable items={data.boqItems} byCategory={data.boqByCategory} /></Panel></Reveal>
            )}

            {/* ── REPORTS ── */}
            {activeTab === 'reports' && (
              <Reveal style={{ marginBottom: 16 }}>
                <Panel title={`Activity Reports — ${(data.summary.totalReports ?? 0).toLocaleString()} linked reports`}>
                  <ActivityReportsPanel reportsByType={data.reportsByType ?? []} recentReports={data.recentReports ?? []} />
                </Panel>
              </Reveal>
            )}
          </div>
        )}
      </div>

      <style>{`
        @keyframes pingAnim { 0% { transform: scale(1); opacity: 0.5; } 75%, 100% { transform: scale(2.8); opacity: 0; } }
        @keyframes shimmer   { 0% { transform: translateX(-100%); } 100% { transform: translateX(600%); } }
        @keyframes float1    { 0%,100% { transform: translate(0,0); } 50% { transform: translate(-30px, 20px); } }
        @keyframes float2    { 0%,100% { transform: translate(0,0); } 50% { transform: translate(20px,-30px); } }
        @keyframes pulse     { 0%,100% { opacity:1; transform:scale(1); } 50% { opacity:0.4; transform:scale(0.8); } }
        @keyframes chipIn    { from { opacity:0; transform:scale(0.85) translateY(4px); } to { opacity:1; transform:scale(1) translateY(0); } }
        select:focus, input:focus { outline: none; border-color: rgba(212,160,64,0.4) !important; box-shadow: 0 0 0 2px rgba(212,160,64,0.1); }
        select option { background: #0e0e10; }
        input[type='number']::-webkit-inner-spin-button, input[type='number']::-webkit-outer-spin-button { opacity: 0.3; }
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(212,160,64,0.2); border-radius: 3px; }
        ::-webkit-scrollbar-thumb:hover { background: rgba(212,160,64,0.4); }

        /* ── Shared interactive states ─────────────────────────── */
        .btn-ghost { transition: background 0.2s ${EASE}, border-color 0.2s ${EASE}, color 0.2s ${EASE}, transform 0.2s ${EASE} !important; }
        .btn-ghost:not(:disabled):hover { background: rgba(212,160,64,0.1) !important; border-color: rgba(212,160,64,0.55) !important; color: ${D.amberL} !important; transform: translateY(-1px); }
        .btn-ghost:not(:disabled):active { transform: translateY(0) scale(0.97); }
        .btn-primary-amber { transition: transform 0.2s ${EASE}, box-shadow 0.2s ${EASE}; }
        .btn-primary-amber:hover { transform: translateY(-1px); box-shadow: 0 6px 20px ${D.amber}55; }
        .seg-btn { transition: background 0.2s ${EASE}, color 0.2s ${EASE}; }
        .seg-btn:hover { background: rgba(255,255,255,0.05) !important; color: ${D.text} !important; }
        .tbl-row { transition: background 0.15s ${EASE}; }
        .tbl-row:nth-child(even) { background: rgba(255,255,255,0.014); }
        .tbl-row:hover { background: rgba(212,160,64,0.045) !important; }
        .tbl-row-header { transition: background 0.2s ${EASE}; }
        .tbl-row-header:hover { background: rgba(212,160,64,0.06) !important; }

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
          .sub-header-bar { padding: 0 14px !important; gap: 12px !important; }
        }
        @media (max-width: 480px) {
          .kpi-grid { grid-template-columns: repeat(1,1fr) !important; }
          .sub-badge, .sub-date { display: none !important; }
        }
      `}</style>
    </div>
  )
}

export default function ProgressPage() {
  return (
    <Suspense fallback={<div style={{ minHeight: '100vh', background: '#0e0e10' }} />}>
      <ProgressPageInner />
    </Suspense>
  )
}