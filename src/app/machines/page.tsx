'use client'

import { useEffect, useRef, useState, useCallback, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useTheme } from '@/lib/theme'
import { VIVID } from '@/lib/theme-constants'
import { HeroBanner } from '@/components/HeroBanner'

const EASE = 'cubic-bezier(0.16,1,0.3,1)'

interface DashData {
  summary: { totalReports: number; reportsThisMonth: number }
  byMachine:   Array<{ name: string; count: number }>
  byOwnership: Array<{ name: string; count: number }>
  byDriver:    Array<{ name: string; count: number }>
  // Both optional: added by scripts/sql/add_dashboard_machine_trends.sql,
  // which only adds new output keys (no new RPC parameters, so no
  // signature-mismatch risk like the status-filter migration) — until it's
  // applied, these are simply absent from the response, so every read below
  // defaults with `?? []` and the two new cards fall back to their own empty
  // state rather than the page breaking. See the 2026-09-25 changelog.
  machineActivityByDay?: Array<{ date: string; count: number }>
  // Nested per-driver shape (add_dashboard_driver_machine_stacked.sql) — a
  // top-10-drivers-by-total-activity list, each with its own top-5-machines-
  // plus-"Other" breakdown, for the stacked-bar redesign below. The OLD flat
  // {driver,machine,count}[] shape (add_dashboard_machine_trends.sql) has no
  // `machines` array, so DriverMachineBars filters those out — same
  // "degrades to the empty state, doesn't crash" safety this page's other
  // pending-migration fields already use.
  driverMachineCross?: Array<{ driver: string; total: number; machines: Array<{ machine: string; count: number }> }>
  machineSummary: { totalMentions: number; distinctMachines: number; distinctDrivers: number }
  unattributed?: Record<string, number>
  mediaItems: Array<{ file: string; media_type: string }>
  recentReports: Array<{ weather?: string }>
  filterOptions: { categories: string[]; projects: string[] }
  activeFilters: {
    filterCategory: string; filterProject: string; filterDateFrom: string; filterDateTo: string; filterChFrom: string; filterChTo: string; filterSearch: string
    filterWeather: string; filterMachine: string; filterEmployee: string; filterEngineer: string; filterSupervisor: string
    filterOwnership: string; filterDriver: string; filterEmployeeRole: string; filterEngineerParty: string; filterSupervisorParty: string
  }
}

/* ── counter (motion only) ────────────────────────────────── */
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

function Card({ children, title, note }: { children: React.ReactNode; title: string; note?: React.ReactNode }) {
  const { colors: D, shadows: SH } = useTheme()
  return (
    <div style={{ background: D.panel, border: `1px solid ${D.border}`, borderRadius: 10, boxShadow: SH.card, display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '14px 16px 8px' }}>
        <h3 style={{ margin: 0, fontSize: 13.5, fontWeight: 600, letterSpacing: '-0.01em', color: D.text }}>{title}</h3>
      </div>
      <div style={{ padding: '4px 16px 16px' }}>{children}</div>
      {note && <div style={{ padding: '0 16px 12px', marginTop: -4, fontSize: 11, lineHeight: 1.4, color: D.muted, fontFamily: 'var(--font-mono)', letterSpacing: '0.02em' }}>{note}</div>}
    </div>
  )
}

// Surfaces the blank bucket the API strips out of the ranked series — see
// src/app/api/dashboard/_lib.ts.
function unattributedNote(data: DashData, key: string, subject: string): string | null {
  const n = data.unattributed?.[key]
  if (!n) return null
  return `${subject}: ${n.toLocaleString()} not shown in ranking`
}

function KPICard({ label, value, icon, delay = 0, color }: { label: string; value: number; icon: React.ReactNode; delay?: number; color?: string }) {
  const { colors: D, shadows: SH } = useTheme()
  const [vis, setVis] = useState(false)
  useEffect(() => { const t = setTimeout(() => setVis(true), delay + 80); return () => clearTimeout(t) }, [delay])
  const displayed = useCountUp(vis ? value : 0, 1200, 0)
  return (
    <div style={{ background: D.panel, border: `1px solid ${D.border}`, borderRadius: 10, boxShadow: SH.card, padding: '14px 16px', opacity: vis ? 1 : 0, transform: vis ? 'translateY(0)' : 'translateY(10px)', transition: `opacity 0.5s ease ${delay}ms, transform 0.5s ${EASE} ${delay}ms` }}>
      <div style={{ width: 26, height: 26, borderRadius: 7, background: color ? `${color}1c` : D.panel2, border: `1px solid ${color ? color + '38' : D.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: color ?? D.muted, marginBottom: 10 }}>{icon}</div>
      <div style={{ fontFamily: 'var(--font-loader)', fontSize: 26, fontWeight: 600, lineHeight: 1, letterSpacing: '-0.02em', color: color ?? D.text, fontVariantNumeric: 'tabular-nums' }}>{displayed.toLocaleString()}</div>
      <div style={{ fontSize: 10.5, color: D.muted, fontFamily: 'var(--font-mono)', letterSpacing: '0.1em', textTransform: 'uppercase', marginTop: 8 }}>{label}</div>
    </div>
  )
}

/* ── activity-over-time (adapted from dashboard's TimelineChart — this page
   had zero time dimension before, everything was a plain ranked count) ──── */
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
              <rect x={x} y={ready ? y : padT + chartH} width={barW} height={ready ? barH : 0} fill={isHov ? VIVID[0] : `${VIVID[0]}cc`} rx={1.5}
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

/* ── driver × machine cross-reference (top pairs by mention count) ──────── */
// Redesigned from a flat top-12 (driver, machine) pairs list after the real
// data turned out lopsided — one driver logs far more activity than everyone
// else, so 11 of 12 top pairs were all the same person against different
// machines, reading as "one person's machine list" rather than a genuine
// cross-reference. Proposed 3 alternatives (per-driver top-machine list, a
// driver×machine heatmap, stacked bars per driver) with mockups; user picked
// stacked bars. See add_dashboard_driver_machine_stacked.sql.
function DriverMachineBars({ data }: { data: Array<{ driver: string; total: number; machines: Array<{ machine: string; count: number }> }> }) {
  const { colors: D } = useTheme()
  const [ready, setReady] = useState(false)
  useEffect(() => { const t = setTimeout(() => setReady(true), 250); return () => clearTimeout(t) }, [])
  // Guards against the OLD flat {driver,machine,count} shape still being live
  // (no `machines` array) — filters down to empty rather than crashing on
  // `.machines.map`, same "shows the empty state until migrated" convention
  // every other pending-SQL field on this page already follows.
  const rows = data.filter(d => Array.isArray(d.machines) && d.machines.length > 0)
  if (!rows.length) return <EmptyState label="No driver–machine pairs recorded yet" />
  const maxTotal = Math.max(...rows.map(d => d.total), 1)

  // One color per machine, consistent across every driver's bar (so e.g. GPS
  // is always the same swatch no matter whose bar it's in) — ranked by that
  // machine's combined total across the shown drivers, not per-bar order.
  // "Other" (machines beyond a driver's own top-5 cap) always gets a fixed
  // muted color rather than a VIVID slot, since it's not one real machine.
  const machineTotals = new Map<string, number>()
  for (const d of rows) for (const m of d.machines) {
    if (m.machine === 'Other') continue
    machineTotals.set(m.machine, (machineTotals.get(m.machine) ?? 0) + m.count)
  }
  const rankedMachines = [...machineTotals.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name)
  const colorFor = (name: string) => name === 'Other' ? `${D.muted}77` : VIVID[rankedMachines.indexOf(name) % VIVID.length]

  const presentMachines = new Set<string>()
  for (const d of rows) for (const m of d.machines) presentMachines.add(m.machine)
  const legend = rankedMachines.filter(m => presentMachines.has(m))
  if (presentMachines.has('Other')) legend.push('Other')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, width: '100%' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
        {rows.map((d, i) => {
          const widthPct = Math.max((d.total / maxTotal) * 100, 4)
          return (
            <div key={d.driver} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ width: 128, fontSize: 12, color: D.text, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flexShrink: 0 }} title={d.driver}>{d.driver}</span>
              <div style={{ flex: 1, display: 'flex', height: 16, borderRadius: 5, overflow: 'hidden', background: D.panel2 }}>
                <div style={{ display: 'flex', width: ready ? `${widthPct}%` : '0%', height: '100%', transition: `width 0.8s ${EASE} ${i * 0.04}s` }}>
                  {d.machines.map((m, mi) => (
                    <div key={m.machine} title={`${m.machine}: ${m.count}`}
                      style={{ width: `${(m.count / d.total) * 100}%`, height: '100%', background: colorFor(m.machine), borderRight: mi < d.machines.length - 1 ? `1px solid ${D.panel}` : 'none' }} />
                  ))}
                </div>
              </div>
              <span style={{ width: 44, textAlign: 'right', fontSize: 12, color: D.text, fontWeight: 700, fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>{d.total.toLocaleString()}</span>
            </div>
          )
        })}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px', paddingTop: 10, borderTop: `1px solid ${D.border}` }}>
        {legend.map(m => (
          <div key={m} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <div style={{ width: 8, height: 8, borderRadius: 2, background: colorFor(m), flexShrink: 0 }} />
            <span style={{ fontSize: 11, color: D.muted }}>{m}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ── horizontal bars ──────────────────────────────────────── */
// Ranked lists on this page can run 10-15+ rows deep — capping the default
// view keeps a long tail from dwarfing whatever shorter card (a donut, a
// small legend) happens to sit next to it in the same grid row, which
// otherwise reads as a lopsided, jagged-bottomed row even once cards are
// no longer force-stretched to match (see the 2026-09-24 (7) changelog
// entry — that fix stopped the *forced* stretch, this addresses the
// resulting *height mismatch* it exposed).
const HBAR_SHOW_LIMIT = 8

function HBarChart({ data, activeName, onBarClick, lowThreshold, lowLabel = 'low use' }: {
  data: Array<{ name: string; count: number }>; activeName?: string; onBarClick?: (name: string) => void
  /** Rows at or below this count get a small badge — otherwise a machine
     mentioned once or twice sits at the bottom of the list with no visual
     distinction from one that's just moderately used (the bar-width floor
     means every nonzero row already reads as "some bar"). Opt-in per chart
     instance — only passed on "Machines Used", not "Top Drivers", since the
     ask was specifically about flagging underused equipment. See the
     2026-09-25 changelog. */
  lowThreshold?: number
  lowLabel?: string
}) {
  const { colors: D } = useTheme()
  const [ready, setReady] = useState(false)
  const [hov, setHov] = useState<number | null>(null)
  const [expanded, setExpanded] = useState(false)
  useEffect(() => { const t = setTimeout(() => setReady(true), 250); return () => clearTimeout(t) }, [])
  const max = Math.max(...data.map(d => d.count), 1)
  const total = data.reduce((s, d) => s + d.count, 0) || 1
  const hasActive = !!activeName
  const visible = expanded ? data : data.slice(0, HBAR_SHOW_LIMIT)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7, width: '100%' }}>
      {visible.map((d, i) => {
        const pct = Math.round((d.count / total) * 100)
        // A real floor, not a cosmetic minimum — with a skewed distribution
        // (one dominant value, a long tail of small ones), a plain linear
        // scale renders most rows as an invisible sliver against the track.
        const barPct = Math.max((d.count / max) * 100, d.count > 0 ? 3 : 0)
        const isHov = hov === i
        const isTop = i < 3
        const barColor = isTop ? VIVID[i] : `${D.muted}88`
        const isActive = d.name === activeName
        const isLow = lowThreshold != null && d.count > 0 && d.count <= lowThreshold
        return (
          <div key={d.name} onMouseEnter={() => setHov(i)} onMouseLeave={() => setHov(null)}
            onClick={() => onBarClick?.(d.name === activeName ? '' : d.name)}
            style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: onBarClick ? 'pointer' : 'default', opacity: hasActive ? (isActive ? 1 : 0.4) : (hov !== null && !isHov ? 0.45 : 1), transition: 'opacity 0.2s' }}>
            <div style={{ width: 18, height: 18, borderRadius: 5, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: isTop ? `${VIVID[i]}1c` : 'transparent', border: `1px solid ${isTop ? VIVID[i] + '44' : 'transparent'}`, fontSize: 9, fontFamily: 'var(--font-mono)', color: isTop ? VIVID[i] : D.sub, fontWeight: isTop ? 700 : 400 }}>{i + 1}</div>
            <span style={{ width: isLow ? 96 : 140, fontSize: 12.5, color: isHov || isActive ? D.text : D.muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flexShrink: 0 }} title={d.name}>{d.name}</span>
            {isLow && <span style={{ flexShrink: 0, fontSize: 9, fontFamily: 'var(--font-mono)', letterSpacing: '0.03em', color: D.amber, background: `${D.amber}14`, border: `1px solid ${D.amber}38`, borderRadius: 4, padding: '2px 5px', whiteSpace: 'nowrap' }} title="Mentioned only a handful of times — may be sitting idle">{lowLabel}</span>}
            <div style={{ flex: 1, height: 5, background: D.panel2, borderRadius: 6, overflow: 'hidden', position: 'relative' }}>
              <div style={{ position: 'absolute', inset: 0, right: 'auto', width: ready ? `${barPct}%` : '0%', background: barColor, borderRadius: 6, transition: `width 0.8s ${EASE} ${i * 0.03}s` }} />
            </div>
            <span style={{ width: 32, textAlign: 'right', fontSize: 12.5, color: isHov || isActive ? (isTop ? VIVID[i] : D.amber) : D.text, fontWeight: 700, fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>{d.count}</span>
            <span style={{ width: 30, textAlign: 'right', fontSize: 11, color: D.sub, fontFamily: 'var(--font-mono)', flexShrink: 0 }}>{pct}%</span>
          </div>
        )
      })}
      {data.length > HBAR_SHOW_LIMIT && (
        <button onClick={() => setExpanded(v => !v)} style={{
          alignSelf: 'flex-start', marginTop: 2, background: 'none', border: 'none', cursor: 'pointer', padding: 0,
          fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.04em', color: D.amber,
        }}>
          {expanded ? '↑ Show less' : `↓ Show all ${data.length}`}
        </button>
      )}
    </div>
  )
}

/* ── donut (single-hue ramp) ──────────────────────────────── */
function DonutChart({ data, activeName, onSliceClick }: { data: Array<{ name: string; count: number }>; activeName?: string; onSliceClick?: (name: string) => void }) {
  const { colors: D } = useTheme()
  const [ready, setReady] = useState(false)
  const [hov, setHov] = useState<number | null>(null)
  useEffect(() => { const t = setTimeout(() => setReady(true), 180); return () => clearTimeout(t) }, [])
  const RAMP = VIVID
  const total = data.reduce((s, d) => s + d.count, 0)
  if (!total) return null
  // Sized up from the original 66/20 (160px svg) — a donut with only 2-3
  // categories (e.g. Ownership breakdowns) otherwise sits far shorter than
  // the ranked-bar card it's paired with in the same grid row, which reads
  // as an unbalanced, "wobbly" row even with each card sized to its own
  // real content (no forced stretch). A bigger, more prominent donut is
  // also a real visual improvement on its own, not just a height-matching
  // trick. See the 2026-09-24 (9) changelog entry.
  const r = 82, sw = 24, gap = 2, circ = 2 * Math.PI * r
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
      <svg width={196} height={196} viewBox="-98 -98 196 196" style={{ flexShrink: 0 }} onMouseLeave={() => setHov(null)}>
        <circle r={r} fill="none" stroke={D.panel2} strokeWidth={sw} />
        {segments.map((seg, i) => {
          const isHov = hov === i
          const isActive = seg.name === activeName
          return <circle key={i} r={r} fill="none" stroke={seg.color} strokeWidth={isHov || isActive ? sw + 4 : sw}
            strokeDasharray={`${ready ? seg.len : 0} ${circ}`} strokeDashoffset={-(seg.offset)} strokeLinecap="butt"
            strokeOpacity={hasActive ? (isActive ? 1 : 0.2) : (hov !== null && !isHov ? 0.35 : 1)}
            style={{ transition: `stroke-dasharray 0.8s ${EASE} ${i * 0.06}s, stroke-width 0.2s ${EASE}, stroke-opacity 0.2s`, cursor: onSliceClick ? 'pointer' : 'default' }}
            onMouseEnter={() => setHov(i)} onClick={() => handleClick(seg.name)} />
        })}
        {hovSeg ? (<>
          <text x="0" y="-7" textAnchor="middle" fill={D.text} fontFamily="var(--font-loader)" fontSize="24" fontWeight="600">{hovSeg.count}</text>
          <text x="0" y="13" textAnchor="middle" fill={D.muted} fontFamily="var(--font-mono)" fontSize="8">{hovSeg.name.length > 13 ? hovSeg.name.slice(0, 12) + '…' : hovSeg.name}</text>
        </>) : (<>
          <text x="0" y="-4" textAnchor="middle" fill={D.text} fontFamily="var(--font-loader)" fontSize="29" fontWeight="600">{total}</text>
          <text x="0" y="17" textAnchor="middle" fill={D.muted} fontFamily="var(--font-mono)" fontSize="8" letterSpacing="1.5">TOTAL</text>
        </>)}
      </svg>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1, minWidth: 130 }}>
        {segments.map((seg, i) => {
          const isHov = hov === i
          const isActive = seg.name === activeName
          return (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: onSliceClick ? 'pointer' : 'default', opacity: hasActive ? (isActive ? 1 : 0.4) : (hov !== null && !isHov ? 0.4 : 1), transition: 'opacity 0.2s' }}
              onMouseEnter={() => setHov(i)} onMouseLeave={() => setHov(null)} onClick={() => handleClick(seg.name)}>
              <div style={{ width: 8, height: 8, borderRadius: 2, background: seg.color, flexShrink: 0 }} />
              <span style={{ fontSize: 12.5, color: isHov || isActive ? D.text : D.muted, flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{seg.name}</span>
              <span style={{ fontSize: 12.5, color: D.text, fontWeight: 600, fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>{seg.count}</span>
              <span style={{ fontSize: 11, color: D.sub, fontFamily: 'var(--font-mono)', flexShrink: 0 }}>{Math.round(seg.count / total * 100)}%</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function EmptyState({ label }: { label: string }) {
  const { colors: D } = useTheme()
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: '28px 0' }}>
      <div style={{ width: 32, height: 32, borderRadius: 8, background: D.panel2, border: `1px solid ${D.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: D.sub }}>
        <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><line x1="9" y1="9" x2="15" y2="15" /><line x1="15" y1="9" x2="9" y2="15" /></svg>
      </div>
      <div style={{ color: D.muted, fontSize: 13, textAlign: 'center' }}>{label}</div>
    </div>
  )
}

const IconTruck = () => <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="6" width="14" height="11" /><path d="M15 9h4l3 3v5h-7z" /><circle cx="6" cy="19" r="2" /><circle cx="17.5" cy="19" r="2" /></svg>
const IconLayers = () => <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2" /><polyline points="2 17 12 22 22 17" /><polyline points="2 12 12 17 22 12" /></svg>
const IconUser = () => <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
const IconTag = () => <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M20.59 13.41 11 3.83A2 2 0 0 0 9.61 3H4a1 1 0 0 0-1 1v5.61a2 2 0 0 0 .59 1.42l9.58 9.58a2 2 0 0 0 2.82 0l4.6-4.6a2 2 0 0 0 0-2.6z" /><circle cx="7.5" cy="7.5" r="1.2" /></svg>
const FIconSearch = () => <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
const FIconFolder = () => <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>
const FIconCalendar = () => <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>
const FIconRuler = () => <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="m16.5 7.5 3 3L7.5 22.5l-3-3z" /><path d="m14.5 5.5 4 4" /><path d="m11.5 8.5 2 2" /><path d="m8.5 11.5 2 2" /><path d="m5.5 14.5 2 2" /></svg>
const FIconFunnel = ({ color }: { color: string }) => <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><polygon points="4,4 20,4 14,12.5 14,19 10,21 10,12.5" /></svg>

/* Was a sticky left column (2026-09-21); converted to a floating overlay
   2026-09-24 to match /dashboard, then given the same icon-labeled/no-
   header-text visual pass as that page's own FilterRail — see that
   component for the full reasoning. Same field logic verbatim throughout,
   only presentation changed. */
function FilterRail({ data, onFilter, onClose }: { data: DashData; onFilter: (key: string, val: string) => void; onClose: () => void }) {
  const { colors: D, shadows: SH } = useTheme()
  const active = data.activeFilters
  const hasFilters = !!(active.filterCategory || active.filterProject || active.filterDateFrom || active.filterDateTo || active.filterChFrom || active.filterChTo || active.filterSearch || active.filterWeather || active.filterMachine || active.filterEmployee || active.filterEngineer || active.filterSupervisor || active.filterOwnership || active.filterDriver || active.filterEmployeeRole || active.filterEngineerParty || active.filterSupervisorParty)
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

  const activeFilterCount = Object.entries(data.activeFilters).filter(([, v]) => !!v).length
  const field: React.CSSProperties = { font: 'inherit', color: D.text, background: D.panel2, border: `1px solid ${D.border}`, borderRadius: 9, padding: '9px 11px', fontSize: 12.5, outline: 'none', width: '100%', transition: `border-color 0.15s ${EASE}` }
  const lbl: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 5, fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: D.muted, marginBottom: 6 }
  const row = (icon: React.ReactNode, l: string, el: React.ReactNode) => <div key={l}><span style={lbl}>{icon}{l}</span>{el}</div>

  return (
    <aside className="filter-rail" style={{
      width: 300, background: D.panel, border: `1px solid ${D.border}`, borderRadius: 14,
      boxShadow: SH.cardLg, display: 'flex', flexDirection: 'column', overflow: 'hidden',
      maxHeight: 'calc(100vh - 120px)', animation: `fadeIn 0.15s ${EASE}`,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 14px', background: D.panel2, borderBottom: `1px solid ${D.border}`, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <FIconFunnel color={D.amber} />
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: D.text }}>Filters</span>
          {activeFilterCount > 0 && (
            <span style={{ minWidth: 16, height: 16, padding: '0 4px', borderRadius: 8, background: D.amber, color: '#1a1408', fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', fontVariantNumeric: 'tabular-nums' }}>{activeFilterCount}</span>
          )}
        </div>
        <button onClick={onClose} aria-label="Close filters" style={{ flexShrink: 0, width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 6, border: `1px solid ${D.border}`, background: D.panel, color: D.muted, cursor: 'pointer' }}>
          <svg width={10} height={10} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round"><line x1="4" y1="4" x2="20" y2="20" /><line x1="20" y1="4" x2="4" y2="20" /></svg>
        </button>
      </div>

      <div style={{ padding: '16px 16px 18px', display: 'flex', flexDirection: 'column', gap: 14, overflowY: 'auto' }}>
        {row(<FIconSearch />, 'Search', <input type="text" placeholder="Reporter, project, comment…" value={search} onChange={e => setSearch(e.target.value)} style={field} />)}
        {row(<IconTag />, 'Category', <select value={active.filterCategory || ''} onChange={e => onFilter('category', e.target.value)} style={{ ...field, cursor: 'pointer' }}><option value="">All Categories</option>{data.filterOptions.categories.map(c => <option key={c} value={c}>{c}</option>)}</select>)}
        {row(<FIconFolder />, 'Project', <select value={active.filterProject || ''} onChange={e => onFilter('project', e.target.value)} style={{ ...field, cursor: 'pointer' }}><option value="">All Projects</option>{data.filterOptions.projects.map(p => <option key={p} value={p}>{p}</option>)}</select>)}

        <div>
          <span style={lbl}><FIconCalendar />Date Range</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <input type="date" value={active.filterDateFrom || ''} onChange={e => onFilter('date_from', e.target.value)} style={field} />
            <input type="date" value={active.filterDateTo || ''} onChange={e => onFilter('date_to', e.target.value)} style={field} />
          </div>
        </div>
        <div>
          <span style={lbl}><FIconRuler />Chainage Range (m)</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <input type="number" placeholder="20000" value={chFrom} onChange={e => setChFrom(e.target.value)} onBlur={applyChFilter} onKeyDown={e => { if (e.key === 'Enter') applyChFilter() }} style={field} />
            <input type="number" placeholder="30000" value={chTo} onChange={e => setChTo(e.target.value)} onBlur={applyChFilter} onKeyDown={e => { if (e.key === 'Enter') applyChFilter() }} style={field} />
          </div>
        </div>

        {hasFilters && (
          <>
            <div style={{ height: 1, background: D.border }} />
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, color: D.muted, display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: D.amber, flexShrink: 0 }} />
                <span style={{ color: D.text, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{data.summary.totalReports.toLocaleString()}</span> matched
              </div>
              <button onClick={() => { setChFrom(''); setChTo(''); setSearch(''); onFilter('__clear__', '') }}
                style={{ color: D.amber, background: 'transparent', border: `1px solid ${D.amber}55`, borderRadius: 7, padding: '5px 10px', cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.04em', whiteSpace: 'nowrap' }}>Clear all</button>
            </div>
          </>
        )}
      </div>
    </aside>
  )
}

/* ── skeleton ─────────────────────────────────────────────── */
function Skel({ h }: { h: number }) {
  const { colors: D } = useTheme()
  return (
    <div style={{ height: h, borderRadius: 10, background: D.panel, position: 'relative', overflow: 'hidden', border: `1px solid ${D.border}` }}>
      <div style={{ position: 'absolute', inset: 0, background: `linear-gradient(90deg, transparent 0%, ${D.panel2} 50%, transparent 100%)`, animation: 'shimmer 1.6s ease-in-out infinite' }} />
    </div>
  )
}
function PageSkeleton() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="kpi-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 14 }}>{[0, 1, 2, 3].map(i => <Skel key={i} h={100} />)}</div>
      <div className="mach-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14 }}><Skel h={260} /><Skel h={260} /><Skel h={260} /></div>
    </div>
  )
}

/* ── page ─────────────────────────────────────────────────── */
function MachinesPageInner() {
  const { colors: D } = useTheme()
  const router = useRouter()
  const searchParams = useSearchParams()
  const [data, setData] = useState<DashData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [firstName, setFirstName] = useState('')
  const requestIdRef = useRef(0)
  const pendingExtraRef = useRef<{ reqId: number; x: Partial<DashData> } | null>(null)
  const [filtersOpen, setFiltersOpen] = useState(false)

  useEffect(() => {
    fetch('/api/auth/me').then(r => r.json()).then(d => { if (d?.user?.first_name) setFirstName(d.user.first_name) }).catch(() => {})
  }, [])

  useEffect(() => {
    if (!filtersOpen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setFiltersOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [filtersOpen])

  // Two parallel fetches, same split as /dashboard: /api/dashboard (core,
  // clears the skeleton) and /api/dashboard/extra (mediaItems/recentReports
  // — only needed here for the hero banner's photos/weather, merged in once
  // it lands). See the 2026-09-08 dashboard changelog for the original
  // reasoning behind this split.
  const loadData = useCallback(() => {
    const reqId = ++requestIdRef.current
    setLoading(true)
    pendingExtraRef.current = null
    const qs = searchParams.toString()
    const EMPTY_HEAVY = { mediaItems: [], recentReports: [] }

    fetch(`/api/dashboard${qs ? `?${qs}` : ''}`)
      .then(r => { if (r.status === 401) { router.replace('/login'); return null } return r.json() })
      .then(d => {
        if (!d || reqId !== requestIdRef.current) return
        const merged: DashData = { ...EMPTY_HEAVY, ...d }
        if (pendingExtraRef.current?.reqId === reqId) Object.assign(merged, pendingExtraRef.current.x)
        pendingExtraRef.current = null
        setData(merged)
        setLoading(false)
      })
      .catch(() => { if (reqId === requestIdRef.current) { setError('Failed to load machines data'); setLoading(false) } })

    fetch(`/api/dashboard/extra${qs ? `?${qs}` : ''}`)
      .then(r => (r.ok ? r.json() : null))
      .then(x => {
        if (!x || x.error || reqId !== requestIdRef.current) return
        pendingExtraRef.current = { reqId, x }
        setData(prev => (prev ? { ...prev, ...x } : prev))
      })
      .catch(() => {})
  }, [searchParams, router])

  useEffect(() => { loadData() }, [loadData])

  function handleFilter(key: string, val: string) {
    const p = new URLSearchParams(searchParams.toString())
    if (key === '__clear__') {
      ['category', 'project', 'date_from', 'date_to', 'ch_from', 'ch_to', 'search', 'weather', 'machine', 'employee', 'engineer', 'supervisor', 'ownership', 'driver', 'employee_role', 'engineer_party', 'supervisor_party'].forEach(k => p.delete(k))
    } else if (key === '__ch_range__') {
      const [from, to] = val.split(',')
      p.set('ch_from', from); p.set('ch_to', to)
    } else if (val) {
      p.set(key, val)
    } else {
      p.delete(key)
    }
    router.push(`/machines?${p.toString()}`)
  }

  const activeFilterCount = data ? Object.entries(data.activeFilters).filter(([, v]) => !!v).length : 0
  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
  const latestWeather = data?.recentReports.find(r => r.weather)?.weather

  return (
    <div style={{ minHeight: '100%', background: D.bg, color: D.text }}>
      <div style={{ padding: '28px 36px', width: '100%' }}>
        <HeroBanner
          D={D}
          greeting={greeting}
          firstName={firstName}
          photos={(data?.mediaItems ?? []).filter(m => m.media_type !== 'video').slice(0, 6).map(m => m.file)}
          stat={data ? `${data.summary.reportsThisMonth.toLocaleString()} reports this month · ${data.summary.totalReports.toLocaleString()} total across every site` : 'Field-activity overview across all sites.'}
          weather={latestWeather}
        />

        <div style={{ marginBottom: 18 }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600, letterSpacing: '-0.01em' }}>Machines</h2>
          <p style={{ margin: 0, marginTop: 3, fontSize: 13, color: D.muted }}>Equipment usage across activity reports.</p>
        </div>

        {error && <div style={{ background: `${D.red}12`, border: `1px solid ${D.red}3a`, borderRadius: 10, padding: '12px 16px', color: D.red, fontFamily: 'var(--font-mono)', fontSize: 13, marginBottom: 20 }}>{error}</div>}

        {loading && !data && <PageSkeleton />}

        {data && (
          <div className="dash-main" style={{ opacity: loading ? 0.6 : 1, pointerEvents: loading ? 'none' : 'auto', transition: `opacity 0.25s ${EASE}` }}>
            <div style={{ position: 'relative', display: 'inline-block', marginBottom: 16 }}>
              <button onClick={() => setFiltersOpen(v => !v)} className="filter-toggle-btn" style={{
                display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
                background: filtersOpen ? `${D.amber}14` : D.panel, border: `1px solid ${filtersOpen ? D.amber + '66' : D.border}`,
                borderRadius: 10, padding: '9px 14px', color: D.text, font: 'inherit',
              }}>
                <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke={D.amber} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><polygon points="4,4 20,4 14,12.5 14,19 10,21 10,12.5" /></svg>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Filters</span>
                {activeFilterCount > 0 && (
                  <span style={{ minWidth: 17, height: 17, padding: '0 4px', borderRadius: 9, background: D.amber, color: '#1a1408', fontSize: 10.5, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', fontVariantNumeric: 'tabular-nums' }}>{activeFilterCount}</span>
                )}
              </button>
              {filtersOpen && (
                <>
                  <div onClick={() => setFiltersOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 40, background: 'transparent' }} />
                  <div style={{ position: 'absolute', top: 'calc(100% + 8px)', left: 0, zIndex: 50 }}>
                    <FilterRail data={data} onFilter={handleFilter} onClose={() => setFiltersOpen(false)} />
                  </div>
                </>
              )}
            </div>
            <div className="kpi-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 14, marginBottom: 16 }}>
              <KPICard label="Machine Mentions" value={data.machineSummary?.totalMentions ?? 0} icon={<IconTruck />} delay={0} color={VIVID[0]} />
              <KPICard label="Distinct Machines" value={data.machineSummary?.distinctMachines ?? 0} icon={<IconLayers />} delay={60} color={VIVID[1]} />
              <KPICard label="Distinct Drivers" value={data.machineSummary?.distinctDrivers ?? 0} icon={<IconUser />} delay={120} color={VIVID[2]} />
              <KPICard label="Ownership Types" value={data.byOwnership?.length ?? 0} icon={<IconTag />} delay={180} color={VIVID[3]} />
            </div>

            <Reveal>
              <div className="mach-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14, alignItems: 'start' }}>
                <Card title="Machines Used" note={unattributedNote(data, 'byMachine', 'No machine name recorded')}>
                  {data.byMachine?.length > 0
                    ? <HBarChart data={data.byMachine} activeName={data.activeFilters.filterMachine} onBarClick={name => handleFilter('machine', name)} lowThreshold={2} />
                    : <EmptyState label="No machine data matches your filters" />}
                </Card>
                <Card title="Ownership Breakdown" note={unattributedNote(data, 'byOwnership', 'No ownership recorded')}>
                  {data.byOwnership?.length > 0
                    ? <DonutChart data={data.byOwnership} activeName={data.activeFilters.filterOwnership} onSliceClick={name => handleFilter('ownership', name)} />
                    : <EmptyState label="No ownership data matches your filters" />}
                </Card>
                <Card title="Top Drivers" note={unattributedNote(data, 'byDriver', 'No driver recorded')}>
                  {data.byDriver?.length > 0
                    ? <HBarChart data={data.byDriver} activeName={data.activeFilters.filterDriver} onBarClick={name => handleFilter('driver', name)} />
                    : <EmptyState label="No driver data matches your filters" />}
                </Card>
              </div>
            </Reveal>

            <Reveal delay={80}>
              <div className="mach-grid-2" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 14, marginTop: 14, alignItems: 'start' }}>
                <Card title="Machine Activity Trend" note="Machine mentions per day · last 30 days">
                  {(data.machineActivityByDay?.length ?? 0) > 0
                    ? <TimelineChart data={data.machineActivityByDay!} />
                    : <EmptyState label="No day-by-day machine activity yet" />}
                </Card>
                <Card title="Driver × Machine" note="Top 10 drivers, segmented by machine used">
                  <DriverMachineBars data={data.driverMachineCross ?? []} />
                </Card>
              </div>
            </Reveal>
          </div>
        )}
      </div>

      <style>{`
        @keyframes shimmer { 0% { transform:translateX(-100%); } 100% { transform:translateX(400%); } }
        @keyframes fadeIn { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:translateY(0); } }
        select:focus, input:focus { border-color:${D.amber} !important; box-shadow:0 0 0 3px ${D.amber}22 !important; }
        select option { background:${D.panel}; color:${D.text}; }
        input[type='date']::-webkit-calendar-picker-indicator { cursor:pointer; opacity:0.6; }
        input[type='number']::-webkit-inner-spin-button, input[type='number']::-webkit-outer-spin-button { opacity:0.3; }
        .filter-toggle-btn:hover { border-color: ${D.amber}66 !important; }
        @media (max-width: 1024px) {
          .kpi-grid { grid-template-columns: repeat(2,1fr) !important; }
        }
        @media (max-width: 640px)  {
          .kpi-grid { grid-template-columns: repeat(1,1fr) !important; }
          .filter-rail { width: calc(100vw - 32px) !important; max-width: 340px; }
        }
      `}</style>
    </div>
  )
}

export default function MachinesPage() {
  const { colors: D } = useTheme()
  return (
    <Suspense fallback={<div style={{ minHeight: '100vh', background: D.bg, padding: '28px 36px' }}><PageSkeleton /></div>}>
      <MachinesPageInner />
    </Suspense>
  )
}
