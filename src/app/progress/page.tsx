'use client'

import { useEffect, useState, useCallback, useRef, Suspense } from 'react'
import { useRouter } from 'next/navigation'
import { useTheme } from '@/lib/theme'

const EASE = 'cubic-bezier(0.16,1,0.3,1)'

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

/* ── counter (motion only) ────────────────────────────────── */
function useCountUp(target: number, duration = 1100, trigger = true) {
  const [val, setVal] = useState(0)
  useEffect(() => {
    if (!trigger || target === 0) { setVal(0); return }
    let raf: number
    const start = Date.now()
    const tick = () => {
      const p = Math.min((Date.now() - start) / duration, 1)
      setVal(Math.round((1 - Math.pow(1 - p, 4)) * target))
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, duration, trigger])
  return val
}

/* ── primitives ───────────────────────────────────────────── */
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

function Card({ children, title, sub, action, style: st }: { children: React.ReactNode; title: string; sub?: string; action?: React.ReactNode; style?: React.CSSProperties }) {
  const { colors: D, shadows: SH } = useTheme()
  return (
    <div style={{ background: D.panel, border: `1px solid ${D.border}`, borderRadius: 10, boxShadow: SH.card, display: 'flex', flexDirection: 'column', ...st }}>
      <div style={{ padding: '14px 16px 8px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 13.5, fontWeight: 600, letterSpacing: '-0.01em', color: D.text }}>{title}</h3>
          {sub && <div style={{ fontSize: 12, color: D.muted, marginTop: 2 }}>{sub}</div>}
        </div>
        {action}
      </div>
      <div style={{ padding: '4px 16px 16px' }}>{children}</div>
    </div>
  )
}

function Pill({ kind, children }: { kind: 'ok' | 'accent' | 'crit' | 'mut'; children: React.ReactNode }) {
  const { colors: D } = useTheme()
  const map = { ok: D.green, accent: D.amber, crit: D.red, mut: D.muted }[kind]
  return (
    <span style={{
      fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase',
      padding: '3px 7px', borderRadius: 5, whiteSpace: 'nowrap',
      color: map, background: kind === 'mut' ? D.panel2 : `${map}1f`, border: `1px solid ${kind === 'mut' ? D.border : map + '3a'}`,
    }}>{children}</span>
  )
}

function KPICard({ label, value, color, icon, suffix = '', delay = 0 }: { label: string; value: number; color?: string; icon: React.ReactNode; suffix?: string; delay?: number }) {
  const { colors: D, shadows: SH } = useTheme()
  const [vis, setVis] = useState(false)
  useEffect(() => { const t = setTimeout(() => setVis(true), delay + 80); return () => clearTimeout(t) }, [delay])
  const displayed = useCountUp(vis ? value : 0, 1200, vis)
  const numColor = color ?? D.text
  return (
    <div style={{ background: D.panel, border: `1px solid ${D.border}`, borderRadius: 10, boxShadow: SH.card, padding: '14px 16px', opacity: vis ? 1 : 0, transform: vis ? 'translateY(0)' : 'translateY(10px)', transition: `opacity 0.5s ease ${delay}ms, transform 0.5s ${EASE} ${delay}ms` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <div style={{ width: 26, height: 26, borderRadius: 7, background: D.panel2, border: `1px solid ${D.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: D.muted }}>{icon}</div>
      </div>
      <div style={{ fontFamily: 'var(--font-loader)', fontSize: 26, fontWeight: 600, lineHeight: 1, letterSpacing: '-0.02em', color: numColor, fontVariantNumeric: 'tabular-nums' }}>{displayed.toLocaleString()}{suffix}</div>
      <div style={{ fontSize: 10.5, color: D.muted, fontFamily: 'var(--font-mono)', letterSpacing: '0.1em', textTransform: 'uppercase', marginTop: 8 }}>{label}</div>
    </div>
  )
}

/* ── Progress Curve ────────────────────────────────────────── */
function ProgressCurve({ data }: { data: Array<{ date: string; pct: number }> }) {
  const { colors: D } = useTheme()
  const [hov, setHov] = useState<number | null>(null)
  const [progress, setProgress] = useState(0)
  useEffect(() => {
    const t = setTimeout(() => {
      let p = 0
      const iv = setInterval(() => { p = Math.min(p + 0.03, 1); setProgress(p); if (p >= 1) clearInterval(iv) }, 16)
      return () => clearInterval(iv)
    }, 250)
    return () => clearTimeout(t)
  }, [])
  if (!data.length) return <div style={{ color: D.muted, fontSize: 13, padding: '40px 0', textAlign: 'center' }}>No progress data yet</div>

  const W = 820, H = 280, padL = 40, padB = 34, padR = 20, padT = 20
  const chartW = W - padL - padR, chartH = H - padB - padT
  const toX = (i: number) => padL + (i / (data.length - 1)) * chartW
  const toY = (pct: number) => padT + chartH - (pct / 100) * chartH
  const labelEvery = Math.max(1, Math.floor(data.length / 10))
  const fmtD = (d: string) => { const dt = new Date(d); return `${dt.toLocaleString('en', { month: 'short' })} ${dt.getFullYear()}` }
  const clipW = padL + chartW * progress
  const pathD = data.map((d, i) => `${i === 0 ? 'M' : 'L'} ${toX(i)} ${toY(d.pct)}`).join(' ')
  const areaD = `${pathD} L ${toX(data.length - 1)} ${padT + chartH} L ${toX(0)} ${padT + chartH} Z`

  return (
    <div style={{ width: '100%', overflowX: 'auto' }}>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: 'block', minWidth: 400 }} onMouseLeave={() => setHov(null)}>
        <defs>
          <clipPath id="pgClip"><rect x="0" y="0" width={clipW} height={H} /></clipPath>
        </defs>
        {[0, 25, 50, 75, 100].map(v => {
          const y = toY(v)
          return <g key={v}>
            <line x1={padL} y1={y} x2={W - padR} y2={y} stroke={D.border} strokeWidth={1} strokeDasharray={v === 50 ? '4 4' : undefined} />
            <text x={padL - 8} y={y + 4} textAnchor="end" fill={D.sub} fontSize="9" fontFamily="var(--font-mono)">{v}%</text>
          </g>
        })}
        <g clipPath="url(#pgClip)">
          <path d={areaD} fill={`${D.amber}14`} />
          <path d={pathD} fill="none" stroke={D.amber} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        </g>
        {data.map((d, i) => (
          <circle key={i} cx={toX(i)} cy={toY(d.pct)} r={hov === i ? 5 : 2.5}
            fill={hov === i ? D.amberL : D.amber} opacity={hov === i ? 1 : 0.5}
            style={{ cursor: 'pointer', transition: 'r 0.15s, opacity 0.15s' }} onMouseEnter={() => setHov(i)} />
        ))}
        {hov !== null && (() => {
          const d = data[hov], x = toX(hov), y = toY(d.pct)
          const tx = Math.min(x - 55, W - padR - 120), ty = Math.max(padT + 4, y - 50)
          return <g>
            <line x1={x} y1={y} x2={x} y2={padT + chartH} stroke={`${D.amber}44`} strokeWidth={1} strokeDasharray="3 3" />
            <rect x={tx} y={ty} width={120} height={38} rx={5} fill={D.panel} stroke={D.border} strokeWidth={1} />
            <text x={tx + 10} y={ty + 15} fill={D.amber} fontSize="9" fontFamily="var(--font-mono)">{fmtD(d.date)}</text>
            <text x={tx + 10} y={ty + 30} fill={D.text} fontSize="11" fontFamily="var(--font-mono)" fontWeight="600">{d.pct.toFixed(1)}% complete</text>
          </g>
        })()}
        {data.filter((_, i) => i % labelEvery === 0 || i === data.length - 1).map(d => {
          const i = data.indexOf(d)
          return <text key={d.date} x={toX(i)} y={H - 6} textAnchor="middle" fill={D.sub} fontSize="8" fontFamily="var(--font-mono)">{fmtD(d.date)}</text>
        })}
      </svg>
    </div>
  )
}

/* ── Gantt ─────────────────────────────────────────────────── */
function GanttChart({ data }: { data: Array<{ entity: string; start: string; end: string }> }) {
  const { colors: D } = useTheme()
  const [ready, setReady] = useState(false)
  const [hov, setHov] = useState<string | null>(null)
  useEffect(() => { const t = setTimeout(() => setReady(true), 200); return () => clearTimeout(t) }, [])
  if (!data.length) return <div style={{ color: D.muted, fontSize: 13, padding: 20, textAlign: 'center' }}>No data</div>

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

  return (
    <div>
      <div style={{ position: 'relative', height: 20, marginLeft: 130, marginBottom: 6 }}>
        {months.map((m, i) => <div key={i} style={{ position: 'absolute', left: `${m.pct}%`, fontSize: 9, color: D.sub, fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap', transform: 'translateX(-50%)' }}>{m.label}</div>)}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        {data.map(row => (
          <div key={row.entity} style={{ display: 'flex', alignItems: 'center', gap: 10 }}
            onMouseEnter={() => setHov(row.entity)} onMouseLeave={() => setHov(null)}>
            <div style={{ width: 130, flexShrink: 0, fontSize: 11, color: hov === row.entity ? D.text : D.muted, fontFamily: 'var(--font-mono)', textAlign: 'right', paddingRight: 10, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', transition: 'color 0.2s' }}>{row.entity}</div>
            <div style={{ flex: 1, height: 28, background: D.panel2, borderRadius: 5, position: 'relative', overflow: 'hidden', border: `1px solid ${D.border}` }}>
              <div style={{ position: 'absolute', left: `${Math.min(100, Math.max(0, (Date.now() - minDate.getTime()) / (maxDate.getTime() - minDate.getTime()) * 100))}%`, top: 0, bottom: 0, width: 1.5, background: D.red, opacity: 0.8, zIndex: 2 }} />
              <div style={{ position: 'absolute', left: toX(row.start), width: ready ? toW(row.start, row.end) : '0%', top: 4, bottom: 4, borderRadius: 3, background: hov === row.entity ? D.amberL : D.amber, transition: `width 1s ${EASE}`, display: 'flex', alignItems: 'center', paddingLeft: 8 }}>
                <span style={{ fontSize: 9, color: '#fff', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap', overflow: 'hidden', fontWeight: 600 }}>{fmtDate(row.start)} → {fmtDate(row.end)}</span>
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
  const { colors: D } = useTheme()
  const entityGroups = data.reduce((acc, row) => { if (!acc[row.entity]) acc[row.entity] = []; acc[row.entity].push(row); return acc }, {} as Record<string, typeof data>)
  const [expanded, setExpanded] = useState<Set<string>>(new Set(Object.keys(entityGroups)))
  const displayMonths = months.slice(-8)
  const SIDE_COLOR: Record<string, string> = { LHS: D.amber, RHS: D.muted, MEDIAN: D.green }
  const toggle = (e: string) => setExpanded(prev => { const n = new Set(prev); n.has(e) ? n.delete(e) : n.add(e); return n })
  const th: React.CSSProperties = { padding: '9px 14px', color: D.muted, fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 600, background: D.panel2, borderBottom: `1px solid ${D.border}`, whiteSpace: 'nowrap' }

  return (
    <div style={{ overflowX: 'auto', border: `1px solid ${D.border}`, borderRadius: 10 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
        <thead>
          <tr>
            <th style={{ ...th, textAlign: 'left', minWidth: 220 }}>Entity / Side</th>
            {displayMonths.map(m => <th key={m} style={{ ...th, textAlign: 'right', minWidth: 100 }}>{fmtMonth(m)}</th>)}
            <th style={{ ...th, textAlign: 'right' }}>Total</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(entityGroups).map(([entityName, sideRows]) => {
            const isExpanded = expanded.has(entityName)
            const validTotals = sideRows.filter(r => r.total_completion != null).map(r => r.total_completion as number)
            const entityTotal = validTotals.length > 0 ? validTotals.reduce((s, v) => s + v, 0) / validTotals.length : null
            return (
              <>
                <tr key={`${entityName}-h`} onClick={() => toggle(entityName)} className="tbl-row-header" style={{ cursor: 'pointer', borderBottom: `1px solid ${D.border}`, background: `${D.panel2}66` }}>
                  <td style={{ padding: '10px 14px', color: D.text, fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontSize: 9, color: D.amber, display: 'inline-block', transform: isExpanded ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform 0.2s' }}>▼</span>
                      {entityName}
                      <span style={{ fontSize: 9, color: D.muted, background: D.panel2, border: `1px solid ${D.border}`, padding: '1px 6px', borderRadius: 4 }}>{sideRows.length}</span>
                    </div>
                  </td>
                  {displayMonths.map(m => <td key={m} />)}
                  <td style={{ padding: '10px 14px', textAlign: 'right', color: D.amber, fontFamily: 'var(--font-mono)', fontWeight: 700 }}>{entityTotal != null ? `${entityTotal.toFixed(2)}%` : '—'}</td>
                </tr>
                {isExpanded && sideRows.map(row => {
                  const sc = SIDE_COLOR[row.side] || D.muted
                  return (
                    <>
                      <tr key={`${entityName}-${row.side}-l`} style={{ borderBottom: `1px solid ${D.border}`, background: `${D.panel2}33` }}>
                        <td style={{ padding: '7px 14px 3px 30px', color: sc, fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 600 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><div style={{ width: 5, height: 5, borderRadius: '50%', background: sc }} />{row.side}</div>
                        </td>
                        {displayMonths.map(m => <td key={m} />)}
                        <td style={{ padding: '7px 14px 3px', textAlign: 'right', color: row.total_completion != null ? sc : D.sub, fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 600 }}>{row.total_completion != null ? `${(row.total_completion as number).toFixed(2)}%` : '—'}</td>
                      </tr>
                      <tr key={`${entityName}-${row.side}-c`} style={{ borderBottom: `1px solid ${D.border}` }}>
                        <td style={{ padding: '3px 14px 3px 42px', color: D.sub, fontFamily: 'var(--font-mono)', fontSize: 10 }}>Cumulative_%_Completion</td>
                        {displayMonths.map(m => { const val = row.months.find(mo => mo.month === m)?.cumulative_pct; return <td key={m} style={{ padding: '3px 14px', textAlign: 'right', color: val != null ? D.green : 'transparent', fontFamily: 'var(--font-mono)', fontSize: 11 }}>{val != null ? `${val.toFixed(2)}%` : ''}</td> })}
                        <td style={{ padding: '3px 14px', textAlign: 'right', color: row.total_completion != null ? D.green : D.sub, fontFamily: 'var(--font-mono)', fontSize: 11 }}>{row.total_completion != null ? `${(row.total_completion as number).toFixed(2)}%` : '—'}</td>
                      </tr>
                      <tr key={`${entityName}-${row.side}-p`} style={{ borderBottom: `1px solid ${D.border}` }}>
                        <td style={{ padding: '3px 14px 8px 42px', color: D.sub, fontFamily: 'var(--font-mono)', fontSize: 10 }}>Cumulative_Pending_%</td>
                        {displayMonths.map(m => { const val = row.months.find(mo => mo.month === m)?.cumulative_pct; const pv = val != null ? 100 - val : null; return <td key={m} style={{ padding: '3px 14px 8px', textAlign: 'right', color: pv != null ? D.muted : 'transparent', fontFamily: 'var(--font-mono)', fontSize: 11 }}>{pv != null ? `${pv.toFixed(2)}%` : ''}</td> })}
                        <td style={{ padding: '3px 14px 8px', textAlign: 'right', color: row.total_completion != null ? D.muted : D.sub, fontFamily: 'var(--font-mono)', fontSize: 11 }}>{row.total_completion != null ? `${(100 - (row.total_completion as number)).toFixed(2)}%` : '—'}</td>
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
  const { colors: D } = useTheme()
  const [ready, setReady] = useState(false)
  useEffect(() => { const t = setTimeout(() => setReady(true), 300); return () => clearTimeout(t) }, [])
  const total = delayed + onSchedule; if (!total) return null
  const r = 62, sw = 18, circ = 2 * Math.PI * r
  const onLen = (onSchedule / total) * circ, delLen = (delayed / total) * circ
  return (
    <div style={{ display: 'flex', gap: 26, alignItems: 'center', flexWrap: 'wrap' }}>
      <svg width={160} height={160} viewBox="-80 -80 160 160" style={{ flexShrink: 0 }}>
        <circle r={r} fill="none" stroke={D.panel2} strokeWidth={sw} />
        <circle r={r} fill="none" stroke={D.green} strokeWidth={sw} strokeDasharray={`${ready ? onLen : 0} ${circ}`} strokeLinecap="butt" style={{ transition: `stroke-dasharray 1s ${EASE}` }} />
        <circle r={r} fill="none" stroke={D.red} strokeWidth={sw} strokeDasharray={`${ready ? delLen : 0} ${circ}`} strokeDashoffset={-onLen} strokeLinecap="butt" style={{ transition: `stroke-dasharray 1s ${EASE} 0.15s` }} />
        <text x="0" y="-6" textAnchor="middle" fill={D.text} fontFamily="var(--font-loader)" fontSize="22" fontWeight="600">{total.toLocaleString()}</text>
        <text x="0" y="12" textAnchor="middle" fill={D.muted} fontFamily="var(--font-mono)" fontSize="8" letterSpacing="1">ENTITIES</text>
      </svg>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {[{ label: 'On Schedule', val: onSchedule, color: D.green }, { label: 'Delayed', val: delayed, color: D.red }].map(({ label, val, color }) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: color }} />
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
  const { colors: D } = useTheme()
  const [ready, setReady] = useState(false)
  const [hov, setHov] = useState<string | null>(null)
  useEffect(() => { const t = setTimeout(() => setReady(true), 400); return () => clearTimeout(t) }, [])
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
                  <div style={{ width: BAR_W, borderRadius: '3px 3px 0 0', height: ready && b.val != null ? `${(b.val / maxVal) * 100}%` : '0%', background: b.val != null ? b.color : 'transparent', transition: `height 0.9s ${EASE} ${i * 0.05}s`, opacity: hov && hov !== d.entity ? 0.35 : 1 }} />
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

/* ── shared table chrome ──────────────────────────────────── */
function useTableStyles() {
  const { colors: D } = useTheme()
  const th: React.CSSProperties = { padding: '9px 14px', textAlign: 'left', color: D.muted, fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 600, background: D.panel2, borderBottom: `1px solid ${D.border}`, whiteSpace: 'nowrap' }
  const td: React.CSSProperties = { padding: '9px 14px', borderBottom: `1px solid ${D.border}`, whiteSpace: 'nowrap' }
  const wrap: React.CSSProperties = { overflowX: 'auto', border: `1px solid ${D.border}`, borderRadius: 10 }
  return { th, td, wrap, D }
}
function Pager({ page, total, pageSize, onPage }: { page: number; total: number; pageSize: number; onPage: (p: number) => void }) {
  const { colors: D } = useTheme()
  if (total <= pageSize) return null
  const last = Math.ceil(total / pageSize) - 1
  const btn: React.CSSProperties = { background: D.panel, color: D.text, border: `1px solid ${D.border}`, borderRadius: 8, padding: '6px 14px', fontSize: 12, fontFamily: 'var(--font-mono)', cursor: 'pointer' }
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 14 }}>
      <button onClick={() => onPage(Math.max(0, page - 1))} disabled={page === 0} style={{ ...btn, opacity: page === 0 ? 0.4 : 1 }}>‹ Prev</button>
      <span style={{ fontSize: 11, color: D.sub, fontFamily: 'var(--font-mono)' }}>{page * pageSize + 1}–{Math.min((page + 1) * pageSize, total)} of {total.toLocaleString()}</span>
      <button onClick={() => onPage(Math.min(last, page + 1))} disabled={page === last} style={{ ...btn, opacity: page === last ? 0.4 : 1 }}>Next ›</button>
    </div>
  )
}
function Seg<T extends string>({ value, options, onChange }: { value: T; options: Array<{ key: T; label: string }>; onChange: (v: T) => void }) {
  const { colors: D } = useTheme()
  return (
    <div style={{ display: 'inline-flex', border: `1px solid ${D.border}`, borderRadius: 8, overflow: 'hidden' }}>
      {options.map((o, i) => (
        <button key={o.key} onClick={() => onChange(o.key)} style={{
          fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 500,
          color: value === o.key ? D.amber : D.muted, background: value === o.key ? `${D.amber}14` : D.panel,
          border: 0, borderLeft: i ? `1px solid ${D.border}` : 0, padding: '6px 14px', cursor: 'pointer',
        }}>{o.label}</button>
      ))}
    </div>
  )
}

/* ── Delay Table ───────────────────────────────────────────── */
function DelayTable({ data }: { data: ProgressData['delayData'] }) {
  const { th, td, wrap } = useTableStyles()
  const { colors: D } = useTheme()
  const [page, setPage] = useState(0)
  const PAGE = 20
  const pageData = data.slice(page * PAGE, page * PAGE + PAGE)
  return (
    <div>
      <div style={wrap}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 720 }}>
          <thead><tr>{['Entity', 'Side', 'Planned Month', 'Started Date', 'Completed Date', 'Delay Days', 'Status'].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
          <tbody>
            {pageData.map((r, i) => {
              const isD = r.performance_status === 'Delayed'
              return <tr key={i} className="tbl-row">
                <td style={{ ...td, color: D.text, fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{r.entity_name || '—'}</td>
                <td style={{ ...td, color: D.muted, fontFamily: 'var(--font-mono)' }}>{r.side || '—'}</td>
                <td style={{ ...td, color: D.muted, fontFamily: 'var(--font-mono)' }}>{fmtDate(r.planned_date)}</td>
                <td style={{ ...td, color: D.muted, fontFamily: 'var(--font-mono)' }}>{fmtDate(r.date_started)}</td>
                <td style={{ ...td, color: D.muted, fontFamily: 'var(--font-mono)' }}>{fmtDate(r.date_completed)}</td>
                <td style={{ ...td, color: isD ? D.red : D.green, fontFamily: 'var(--font-mono)', fontWeight: 700 }}>{r.delay_days}</td>
                <td style={td}><Pill kind={isD ? 'crit' : 'ok'}>{r.performance_status}</Pill></td>
              </tr>
            })}
          </tbody>
        </table>
      </div>
      <Pager page={page} total={data.length} pageSize={PAGE} onPage={setPage} />
    </div>
  )
}

/* ── BOQ Table ─────────────────────────────────────────────── */
function BOQTable({ items, byCategory }: { items: ProgressData['boqItems']; byCategory: ProgressData['boqByCategory'] }) {
  const { th, td, wrap } = useTableStyles()
  const { colors: D } = useTheme()
  const [view, setView] = useState<'summary' | 'detail'>('summary')
  const [page, setPage] = useState(0)
  const PAGE = 20
  const pageItems = items.slice(page * PAGE, page * PAGE + PAGE)
  const totalQty = items.reduce((s, i) => s + (i.qty || 0), 0)
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, gap: 12, flexWrap: 'wrap' }}>
        <div style={{ background: D.panel2, border: `1px solid ${D.border}`, borderRadius: 8, padding: '8px 16px' }}>
          <div style={{ fontSize: 10, color: D.muted, fontFamily: 'var(--font-mono)', letterSpacing: '0.1em', marginBottom: 3 }}>ACTUAL QUANTITY</div>
          <div style={{ fontSize: 20, color: D.text, fontFamily: 'var(--font-loader)', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{(totalQty / 1000).toFixed(0)}K</div>
        </div>
        <Seg value={view} onChange={setView} options={[{ key: 'summary', label: 'Summary' }, { key: 'detail', label: 'Detail' }]} />
      </div>
      {view === 'summary' ? (
        <div style={wrap}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead><tr>{['Category', 'Items', 'Total Qty', 'Amount'].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
            <tbody>
              {byCategory.map((r, i) => <tr key={i} className="tbl-row">
                <td style={{ ...td, color: D.text, fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{r.category}</td>
                <td style={{ ...td, color: D.muted, fontFamily: 'var(--font-mono)' }}>{r.items}</td>
                <td style={{ ...td, color: D.text, fontFamily: 'var(--font-mono)' }}>{r.qty.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                <td style={{ ...td, color: r.amount > 0 ? D.green : D.sub, fontFamily: 'var(--font-mono)' }}>{r.amount > 0 ? r.amount.toLocaleString() : '—'}</td>
              </tr>)}
            </tbody>
          </table>
        </div>
      ) : (
        <>
          <div style={wrap}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 640 }}>
              <thead><tr>{['Description', 'Category', 'Type', 'Qty', 'Unit', 'Reports'].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
              <tbody>
                {pageItems.map((r: any, i: number) => <tr key={i} className="tbl-row">
                  <td style={{ ...td, color: D.text, maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis' }} title={r.description}>{r.description}</td>
                  <td style={{ ...td, color: D.muted, fontFamily: 'var(--font-mono)' }}>{r.activity_category}</td>
                  <td style={{ ...td, color: D.muted, fontFamily: 'var(--font-mono)' }}>{r.activity_type}</td>
                  <td style={{ ...td, color: D.text, fontFamily: 'var(--font-mono)' }}>{r.qty?.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                  <td style={{ ...td, color: D.sub, fontFamily: 'var(--font-mono)' }}>{r.unit}</td>
                  <td style={td}>{r.report_count > 0 ? <Pill kind="ok">{r.report_count}</Pill> : <span style={{ color: D.sub }}>—</span>}</td>
                </tr>)}
              </tbody>
            </table>
          </div>
          <Pager page={page} total={items.length} pageSize={PAGE} onPage={setPage} />
        </>
      )}
    </div>
  )
}

/* ── Activity Reports ──────────────────────────────────────── */
function ActivityReportsPanel({ reportsByType, recentReports }: { reportsByType: ProgressData['reportsByType']; recentReports: ProgressData['recentReports'] }) {
  const { th, td, wrap } = useTableStyles()
  const { colors: D } = useTheme()
  const [view, setView] = useState<'by_type' | 'recent'>('by_type')
  const statusKind = (s: string): 'ok' | 'accent' | 'mut' => /complete/i.test(s) ? 'ok' : /progress|ongoing/i.test(s) ? 'accent' : 'mut'
  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Seg value={view} onChange={setView} options={[{ key: 'by_type', label: 'By Activity Type' }, { key: 'recent', label: 'Recent Reports' }]} />
      </div>
      {view === 'by_type' ? (
        <div style={wrap}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 640 }}>
            <thead><tr>{['Activity Type', 'Total Reports', 'Completed', 'In Progress', 'Linked Entities', 'Latest Activity'].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
            <tbody>
              {reportsByType.map((r, i) => <tr key={i} className="tbl-row">
                <td style={{ ...td, color: D.text, fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{r.type}</td>
                <td style={{ ...td, color: D.text, fontFamily: 'var(--font-mono)' }}>{r.count}</td>
                <td style={{ ...td, color: D.green, fontFamily: 'var(--font-mono)' }}>{r.completed}</td>
                <td style={{ ...td, color: D.amber, fontFamily: 'var(--font-mono)' }}>{r.inProgress}</td>
                <td style={td}>{r.linked ? <Pill kind="accent">{r.linked}</Pill> : <span style={{ color: D.sub }}>—</span>}</td>
                <td style={{ ...td, color: D.muted, fontFamily: 'var(--font-mono)' }}>{r.latest ? new Date(r.latest).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' }) : '—'}</td>
              </tr>)}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={wrap}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 720 }}>
            <thead><tr>{['Date', 'Activity Type', 'Category', 'Status', 'Reporter', 'Section', 'Chainage'].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
            <tbody>
              {recentReports.map((r, i) => (
                <tr key={i} className="tbl-row">
                  <td style={{ ...td, color: D.muted, fontFamily: 'var(--font-mono)' }}>{r.date_of_activity ? new Date(r.date_of_activity).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' }) : '—'}</td>
                  <td style={{ ...td, color: D.text, fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{r.activity_type || '—'}</td>
                  <td style={{ ...td, color: D.muted, fontFamily: 'var(--font-mono)' }}>{r.activity_category || '—'}</td>
                  <td style={td}>{r.activity_status ? <Pill kind={statusKind(r.activity_status)}>{r.activity_status}</Pill> : <span style={{ color: D.sub }}>—</span>}</td>
                  <td style={{ ...td, color: D.text, fontFamily: 'var(--font-mono)' }}>{r.reporter_name || '—'}</td>
                  <td style={{ ...td, color: D.muted, fontFamily: 'var(--font-mono)' }}>{r.section_name || '—'}</td>
                  <td style={{ ...td, color: D.muted, fontFamily: 'var(--font-mono)' }}>{r.start_chainage || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

/* ── Skeleton ─────────────────────────────────────────────── */
function Skeleton({ h }: { h: number }) {
  const { colors: D } = useTheme()
  return (
    <div style={{ height: h, borderRadius: 10, background: D.panel, position: 'relative', overflow: 'hidden', border: `1px solid ${D.border}` }}>
      <div style={{ position: 'absolute', inset: 0, background: `linear-gradient(90deg, transparent 0%, ${D.panel2} 50%, transparent 100%)`, animation: 'shimmer 1.6s ease-in-out infinite' }} />
    </div>
  )
}

const IconCheck = () => <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
const IconClock = () => <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
const IconAlert = () => <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
const IconList = () => <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" /><line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" /></svg>

const TABS = [{ key: 'overview', label: 'Overview' }, { key: 'planning', label: 'Planning' }, { key: 'boq', label: 'BOQ' }, { key: 'reports', label: 'Activity Reports' }] as const

/* ── Main Page ─────────────────────────────────────────────── */
function ProgressPageInner() {
  const { colors: D } = useTheme()
  const router = useRouter()
  const [data, setData] = useState<ProgressData | null>(null)
  const [loading, setLoading] = useState(true)
  const [filtering, setFiltering] = useState(false)
  const [error, setError] = useState('')
  const [activeTab, setActiveTab] = useState<'overview' | 'planning' | 'boq' | 'reports'>('overview')

  const [filterEntity, setFilterEntity] = useState('')
  const [filterSide, setFilterSide] = useState('')
  const [filterMonth, setFilterMonth] = useState('')
  const [chFrom, setChFrom] = useState('')
  const [chTo, setChTo] = useState('')
  const [applied, setApplied] = useState({ entity: '', side: '', month: '', chFrom: '', chTo: '' })

  const loadData = useCallback((params: { entity: string; side: string; month: string; chFrom: string; chTo: string }, isFilter = false) => {
    if (isFilter) setFiltering(true); else setLoading(true)
    const qs = new URLSearchParams({ project: 'Coastal Road' })
    if (params.entity) qs.set('entity', params.entity)
    if (params.side) qs.set('side', params.side)
    if (params.month) qs.set('month', params.month)
    if (params.chFrom && params.chTo) { qs.set('ch_from', params.chFrom); qs.set('ch_to', params.chTo) }
    fetch(`/api/progress?${qs.toString()}`)
      .then(async r => {
        if (r.status === 401) { router.replace('/login'); return }
        const d = await r.json()
        if (!r.ok) throw new Error(d?.error || `Failed to load data (${r.status})`)
        setError(''); setData(d)
      })
      .catch((e: Error) => { setError(e.message || 'Failed to load data') })
      .finally(() => { setLoading(false); setFiltering(false) })
  }, [router])

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

  const field: React.CSSProperties = { font: 'inherit', color: D.text, background: D.panel2, border: `1px solid ${D.border}`, borderRadius: 7, padding: '6px 9px', fontSize: 12.5, outline: 'none' }
  const selectStyle: React.CSSProperties = { ...field, minWidth: 150, cursor: 'pointer' }
  const inputStyle: React.CSSProperties = { ...field, minWidth: 110 }
  const labelStyle: React.CSSProperties = { fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: D.muted, marginBottom: 5 }

  return (
    <div style={{ minHeight: '100%', background: D.bg, color: D.text }}>
      {/* sub-header */}
      <div className="sub-header-bar" style={{ position: 'sticky', top: '3.5rem', zIndex: 50, background: D.bg, borderBottom: `1px solid ${D.border}`, padding: '0 24px', display: 'flex', alignItems: 'center', gap: 18, height: 46, overflowX: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexShrink: 0 }}>
          <span style={{ fontWeight: 600, fontSize: 14, letterSpacing: '-0.01em', color: D.text }}>Progress</span>
          <span className="sub-badge" style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.06em', color: D.sub, textTransform: 'uppercase' }}>Coastal Road · 1b&amp;c</span>
        </div>
        <div style={{ display: 'flex', gap: 2, marginLeft: 12, flexShrink: 0 }}>
          {TABS.map(t => (
            <button key={t.key} onClick={() => setActiveTab(t.key)} style={{
              fontFamily: 'var(--font-body)', fontSize: 12.5, fontWeight: activeTab === t.key ? 600 : 500,
              color: activeTab === t.key ? D.text : D.muted, background: 'transparent',
              border: 0, borderBottom: `2px solid ${activeTab === t.key ? D.amber : 'transparent'}`,
              padding: '12px 10px', cursor: 'pointer', whiteSpace: 'nowrap',
            }}>{t.label}</button>
          ))}
        </div>
        {filtering && <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-mono)', fontSize: 10, color: D.amber, letterSpacing: '0.08em', flexShrink: 0 }}>FILTERING…</span>}
        <span className="sub-date" style={{ marginLeft: filtering ? 0 : 'auto', flexShrink: 0, fontSize: 10.5, color: D.sub, fontFamily: 'var(--font-mono)' }}>
          {new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
        </span>
      </div>

      <div className="dash-content" style={{ padding: '24px', maxWidth: 1240, margin: '0 auto' }}>
        {error && <div style={{ background: `${D.red}12`, border: `1px solid ${D.red}3a`, borderRadius: 10, padding: '12px 16px', color: D.red, fontFamily: 'var(--font-mono)', fontSize: 13, marginBottom: 20 }}>{error}</div>}

        {/* filter bar */}
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end', padding: '12px 14px', background: D.panel, border: `1px solid ${D.border}`, borderRadius: 10, marginBottom: 20 }}>
          <span style={{ alignSelf: 'center', fontFamily: 'var(--font-mono)', fontSize: 10.5, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase', color: D.muted }}>Filters</span>
          {[
            { label: 'Entity', el: <select value={filterEntity} onChange={e => setFilterEntity(e.target.value)} style={selectStyle}><option value=''>All Entities</option>{(data?.filterOptions.entities ?? []).map(e => <option key={e} value={e}>{e}</option>)}</select> },
            { label: 'Side', el: <select value={filterSide} onChange={e => setFilterSide(e.target.value)} style={{ ...selectStyle, minWidth: 110 }}><option value=''>All Sides</option><option value='LHS'>LHS</option><option value='RHS'>RHS</option><option value='MEDIAN'>MEDIAN</option></select> },
            { label: 'Planned Month', el: <select value={filterMonth} onChange={e => setFilterMonth(e.target.value)} style={{ ...selectStyle, minWidth: 140 }}><option value=''>All Months</option>{(data?.filterOptions.months ?? []).map(m => <option key={m} value={m}>{fmtMonth(m)}</option>)}</select> },
            { label: 'Chainage From', el: <input type='number' placeholder='20000' value={chFrom} onChange={e => setChFrom(e.target.value)} style={inputStyle} /> },
            { label: 'Chainage To', el: <input type='number' placeholder='35000' value={chTo} onChange={e => setChTo(e.target.value)} style={inputStyle} /> },
          ].map(({ label, el }) => (
            <div key={label} style={{ display: 'flex', flexDirection: 'column' }}><span style={labelStyle}>{label}</span>{el}</div>
          ))}
          <button onClick={applyFilters} style={{ background: D.amber, color: '#fff', border: 'none', borderRadius: 7, padding: '7px 18px', fontSize: 12, cursor: 'pointer', fontFamily: 'var(--font-mono)', letterSpacing: '0.04em', alignSelf: 'flex-end', fontWeight: 600 }}>Apply</button>
          {hasFilters && <button onClick={clearFilters} style={{ ...field, color: D.amber, background: 'transparent', border: `1px solid ${D.amber}55`, cursor: 'pointer', fontFamily: 'var(--font-mono)', alignSelf: 'flex-end' }}>✕ Clear</button>}
          {hasFilters && (
            <div style={{ alignSelf: 'center', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {applied.entity && <Pill kind="mut">{applied.entity}</Pill>}
              {applied.side && <Pill kind="mut">{applied.side}</Pill>}
              {applied.month && <Pill kind="mut">{fmtMonth(applied.month)}</Pill>}
              {applied.chFrom && applied.chTo && <Pill kind="mut">CH {Number(applied.chFrom).toLocaleString()} → {Number(applied.chTo).toLocaleString()}</Pill>}
            </div>
          )}
        </div>

        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div className="kpi-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 14 }}>{[0, 1, 2, 3, 4].map(i => <Skeleton key={i} h={100} />)}</div>
            <Skeleton h={320} /><Skeleton h={420} />
          </div>
        ) : data && (
          <div style={{ opacity: filtering ? 0.6 : 1, pointerEvents: filtering ? 'none' : 'auto', transition: `opacity 0.25s ${EASE}` }}>

            {activeTab === 'overview' && (
              <>
                <div className="kpi-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 14, marginBottom: 16 }}>
                  <KPICard label="Overall Completion" value={data.summary.overallPct} suffix="%" color={D.amber} icon={<IconCheck />} delay={0} />
                  <KPICard label="Completed Activities" value={data.summary.totalCompleted} color={D.green} icon={<IconCheck />} delay={60} />
                  <KPICard label="Delayed Activities" value={data.summary.delayed} color={D.red} icon={<IconAlert />} delay={120} />
                  <KPICard label="On Schedule" value={data.summary.onSchedule} color={D.green} icon={<IconClock />} delay={180} />
                  <KPICard label="Total Entity Types" value={data.summary.totalEntities} icon={<IconList />} delay={240} />
                </div>
                <Reveal style={{ marginBottom: 14 }}><Card title="Progress Curve" sub="Cumulative completion %"><ProgressCurve data={data.progressCurve} /></Card></Reveal>
                <Reveal delay={60} style={{ marginBottom: 14 }}><Card title="Monthly Progress"><MonthlyProgressTable data={data.monthlyProgress} months={data.allMonths} /></Card></Reveal>
                <Reveal delay={120} style={{ marginBottom: 14 }}><Card title="Visual Progress of Completion" sub="Gantt chart"><GanttChart data={data.ganttData} /></Card></Reveal>
              </>
            )}

            {activeTab === 'planning' && (
              <>
                <Reveal style={{ marginBottom: 14 }}>
                  <div className="grid-responsive" style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 14 }}>
                    <Card title="Delayed vs On Schedule"><DelayDonut delayed={data.summary.delayed} onSchedule={data.summary.onSchedule} /></Card>
                    <Card title="Days for Completion by Entity"><DaysByEntityChart data={data.daysByEntity} /></Card>
                  </div>
                </Reveal>
                <Reveal delay={60} style={{ marginBottom: 14 }}><Card title="Activity Report for Planning"><DelayTable data={data.delayData} /></Card></Reveal>
              </>
            )}

            {activeTab === 'boq' && (
              <Reveal style={{ marginBottom: 14 }}><Card title="Activity Report in BOQ"><BOQTable items={data.boqItems} byCategory={data.boqByCategory} /></Card></Reveal>
            )}

            {activeTab === 'reports' && (
              <Reveal style={{ marginBottom: 14 }}>
                <Card title="Activity Reports" sub={`${(data.summary.totalReports ?? 0).toLocaleString()} linked reports`}>
                  <ActivityReportsPanel reportsByType={data.reportsByType ?? []} recentReports={data.recentReports ?? []} />
                </Card>
              </Reveal>
            )}
          </div>
        )}
      </div>

      <style>{`
        @keyframes shimmer { 0% { transform: translateX(-100%); } 100% { transform: translateX(400%); } }
        select:focus, input:focus { border-color: ${D.amber} !important; box-shadow: 0 0 0 3px ${D.amber}22 !important; }
        select option { background: ${D.panel}; color: ${D.text}; }
        input[type='number']::-webkit-inner-spin-button, input[type='number']::-webkit-outer-spin-button { opacity: 0.3; }
        .tbl-row { transition: background 0.12s ease; }
        .tbl-row:nth-child(even) { background: ${D.panel2}66; }
        .tbl-row:hover { background: ${D.amber}12 !important; }
        .tbl-row-header:hover { background: ${D.amber}12 !important; }
        @media (max-width: 1024px) {
          .kpi-grid { grid-template-columns: repeat(3,1fr) !important; }
          .grid-responsive { grid-template-columns: 1fr !important; }
        }
        @media (max-width: 640px) {
          .kpi-grid { grid-template-columns: repeat(2,1fr) !important; }
          .dash-content { padding: 16px !important; }
          .sub-header-bar { padding: 0 14px !important; }
          .sub-badge, .sub-date { display: none !important; }
        }
      `}</style>
    </div>
  )
}

export default function ProgressPage() {
  const { colors: D } = useTheme()
  return (
    <Suspense fallback={<div style={{ minHeight: '100vh', background: D.bg }} />}>
      <ProgressPageInner />
    </Suspense>
  )
}
