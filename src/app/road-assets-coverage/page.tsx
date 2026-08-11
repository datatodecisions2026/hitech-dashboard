'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useTheme } from '@/lib/theme'

/* ── Shared motion tokens (mirrors /progress) ─────────────────────────── */
const EASE        = 'cubic-bezier(0.16,1,0.3,1)'
const EASE_SPRING = 'cubic-bezier(0.34,1.56,0.64,1)'

/* ── Types ─────────────────────────────────────────────────────────────── */
interface EntitySide {
  stationsBuilt: number; minStation: number; maxStation: number
  completionPct: number; gapCount: number; totalGapM: number
}
interface EntityRow {
  entityType: string; label: string
  sides: Record<string, EntitySide>
  combinedCompletionPct: number
  plannedPct: number; gapPct: number
  plannedStart: string; plannedEnd: string; status: 'Completed' | 'In Progress' | 'Not Started' | 'Delayed'
}
interface GapDetail {
  entityType: string; side: string
  gaps: Array<{ fromStation: number; toStation: number; gapM: number }>
}
interface TimelinePoint { date: string; plannedPct: number; actualPct: number | null }
interface TimelineData {
  isSynthetic: boolean
  daily: TimelinePoint[]
  plannedPctToday: number; actualPctToday: number; gapPctToday: number
  startDate: string; endDate: string
}
interface ChainageBin { fromChainage: number; toChainage: number; builtPct: number }
interface ChainageLogEntry { fromStation: number; toStation: number; lengthM: number; completedDate: string }
interface ChainageAnalysis {
  bins: ChainageBin[]
  log: ChainageLogEntry[]
  logTotalCount: number
  summary: { completedTodayM: number; completedThisMonthM: number; completedSoFarM: number; completedInRangeM: number | null }
}
interface RoadAssetsData {
  section: string
  totalLengthM: number
  summary: { entityTypeCount: number; avgCompletionPct: number; totalGaps: number }
  entities: EntityRow[]
  gapDetail: GapDetail | null
  chainageAnalysis: ChainageAnalysis | null
  timeline: TimelineData
  filterOptions: { sections: string[]; entityTypes: string[]; sides: string[] }
  activeFilters: { section: string; entityType: string; side: string }
}

const SECTIONS = ['Calabar', 'Ogun', 'Kebbi'] as const

// Asset layers meant to run the whole road continuously — a gap here is a
// real construction defect. Everything else (street lights, ducts, fiber,
// barriers, etc.) is placed at discrete intervals by design, so a low
// coverage % doesn't mean the same thing — surfaced as a disclaimer, not
// hidden, since the completion model is applied uniformly per the confirmed
// approach.
const CONTINUOUS_LAYERS = new Set(['subbase', 'stonebase', 'crcp', 'kerb', 'red_filling'])

function fmtChainage(m: number): string {
  const km = Math.floor(m / 1000)
  const rem = Math.round(m - km * 1000)
  return `${km}+${String(rem).padStart(3, '0')}`
}
function fmtLength(m: number): string {
  if (m >= 1000) return `${(m / 1000).toFixed(2)} km`
  return `${Math.round(m)} m`
}

type Granularity = 'daily' | 'monthly' | 'yearly'

function fmtTimelineDate(date: string, granularity: Granularity): string {
  if (granularity === 'yearly') return date // already "YYYY"
  if (granularity === 'monthly') { const [y, m] = date.split('-'); return new Date(+y, +m - 1, 1).toLocaleString('en', { month: 'short', year: '2-digit' }) }
  return new Date(date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' })
}

// Cumulative % curves down-sample by keeping the LAST point of each bucket
// (the period's ending value), not an average — same convention as
// step-down-sampling a monotonic series. plannedPct is always defined so
// the latest value per bucket is simply correct. actualPct is null for any
// day after "today", so within the bucket containing today, later
// (future, null) days must NOT clobber the real value recorded earlier in
// that same bucket — otherwise the whole current period's actual value
// disappears (confirmed live: at yearly granularity the actual line
// shrank to a single dot because the "this year" bucket's last-iterated
// day was in the future).
function aggregateTimeline(daily: TimelinePoint[], granularity: Granularity): TimelinePoint[] {
  if (granularity === 'daily') return daily
  const keyFn = granularity === 'monthly' ? (d: string) => d.slice(0, 7) : (d: string) => d.slice(0, 4)
  const buckets = new Map<string, TimelinePoint>()
  for (const p of daily) {
    const key = keyFn(p.date)
    const existing = buckets.get(key)
    buckets.set(key, { date: key, plannedPct: p.plannedPct, actualPct: p.actualPct ?? existing?.actualPct ?? null })
  }
  return [...buckets.values()]
}

/* ── Animated counter (mirrors /progress) ─────────────────────────────── */
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

/* ── Reveal on scroll (mirrors /progress) ─────────────────────────────── */
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

/* ── Panel (mirrors /progress) ────────────────────────────────────────── */
function Panel({ children, title, style: st }: { children: React.ReactNode; title: string; style?: React.CSSProperties }) {
  const { colors: D, shadows: SH } = useTheme()
  const [hov, setHov] = useState(false)
  return (
    <div onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{ background: D.panel, borderRadius: 16, padding: '22px 24px', display: 'flex', flexDirection: 'column', gap: 18, border: hov ? SH.borderGlow : `1px solid ${D.border}`, boxShadow: hov ? SH.panelLg : SH.panel, transform: hov ? 'translateY(-2px)' : 'translateY(0)', transition: `border-color 0.35s ${EASE}, box-shadow 0.35s ${EASE}, transform 0.35s ${EASE}`, ...st }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ position: 'relative', width: 8, height: 8, flexShrink: 0 }}>
          <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: D.amber, animation: 'pingAnim 3s ease-out infinite', opacity: 0.5 }} />
          <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: D.amber, boxShadow: `0 0 8px ${D.amber}` }} />
        </div>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.58rem', letterSpacing: '0.18em', textTransform: 'uppercase', color: D.muted, background: D.bg, padding: '2px 10px', borderRadius: 4, border: `1px solid ${D.border}` }}>{title}</span>
      </div>
      {children}
    </div>
  )
}

/* ── KPI Card (mirrors /progress) ──────────────────────────────────────── */
function KPICard({ label, value, color, icon, suffix = '', delay = 0 }: { label: string; value: number; color?: string; icon: React.ReactNode; suffix?: string; delay?: number }) {
  const { colors: D, shadows: SH } = useTheme()
  const col = color ?? D.amber
  const [vis, setVis] = useState(false)
  const [hov, setHov] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setVis(true), delay + 100)
    return () => clearTimeout(t)
  }, [delay])
  const displayed = useCountUp(vis ? value : 0, 1400, vis)
  const entranceY = vis ? 0 : 16
  const hoverY    = hov ? -3 : 0

  return (
    <div onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{ background: hov ? D.panel2 : D.panel, borderRadius: 22, padding: '20px 22px', position: 'relative', overflow: 'hidden', opacity: vis ? 1 : 0, transform: `translateY(${entranceY + hoverY}px) scale(${vis ? 1 : 0.97})`, transition: `opacity 0.6s ease ${delay}ms, transform 0.45s ${EASE} ${vis ? '0ms' : `${delay}ms`}, box-shadow 0.3s ease, border-color 0.3s ease, background 0.3s`, border: hov ? `1px solid rgba(212,160,64,0.2)` : `1px solid ${D.border}`, boxShadow: hov ? `${SH.cardLg}, ${SH.glowAmber}` : SH.card }}>
      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 2, background: `linear-gradient(180deg, transparent, ${col}, transparent)`, opacity: hov ? 1 : 0.5, transition: 'opacity 0.3s ease' }} />
      <div style={{ position: 'absolute', top: -20, right: -20, width: 80, height: 80, borderRadius: '50%', background: `radial-gradient(circle, ${col}${hov ? '28' : '18'} 0%, transparent 70%)`, pointerEvents: 'none', transition: `background 0.3s ${EASE}` }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <div style={{ width: 44, height: 44, borderRadius: 14, background: `${col}20`, border: `1px solid ${col}35`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: col, boxShadow: `inset 0 1px 0 ${col}20`, transform: hov ? 'scale(1.08)' : 'scale(1)', transition: `transform 0.3s ${EASE_SPRING}` }}>{icon}</div>
      </div>
      <div style={{ fontFamily: 'var(--font-loader)', fontSize: '2.4rem', fontWeight: 400, lineHeight: 1, letterSpacing: '0.02em', color: col, textShadow: hov ? `0 0 20px ${col}44` : 'none', transition: 'text-shadow 0.3s ease' }}>{displayed.toLocaleString()}{suffix}</div>
      <div style={{ fontSize: '0.58rem', color: D.muted, fontFamily: 'var(--font-mono)', letterSpacing: '0.14em', textTransform: 'uppercase', marginTop: 8 }}>{label}</div>
    </div>
  )
}

/* ── Section pill selector ─────────────────────────────────────────────── */
function SectionPills({ active, onSelect }: { active: string; onSelect: (s: string) => void }) {
  const { colors: D, shadows: SH } = useTheme()
  return (
    <div style={{ display: 'flex', gap: 8 }}>
      {SECTIONS.map(s => {
        const isActive = s === active
        return (
          <button key={s} onClick={() => onSelect(s)}
            style={{
              fontFamily: 'var(--font-mono)', fontSize: '0.7rem', letterSpacing: '0.08em', textTransform: 'uppercase',
              padding: '8px 18px', borderRadius: 10, cursor: 'pointer',
              color: isActive ? '#0e0e10' : D.text,
              background: isActive ? D.amber : D.panel,
              border: isActive ? `1px solid ${D.amber}` : `1px solid ${D.border}`,
              boxShadow: isActive ? SH.glowAmber : SH.raised,
              transition: `background 0.2s ${EASE}, color 0.2s ${EASE}, box-shadow 0.2s ${EASE}`,
            }}>
            {s}
          </button>
        )
      })}
    </div>
  )
}

/* ── Entity completion row ─────────────────────────────────────────────── */
function EntityCompletionRow({ row, isSelected, selectedSide, onSelectSide }: {
  row: EntityRow; isSelected: boolean; selectedSide: string | null; onSelectSide: (entityType: string, side: string) => void
}) {
  const { colors: D } = useTheme()
  const [ready, setReady] = useState(false)
  useEffect(() => { const t = setTimeout(() => setReady(true), 150); return () => clearTimeout(t) }, [])
  const sides = Object.entries(row.sides).sort(([a], [b]) => a.localeCompare(b))
  const isContinuous = CONTINUOUS_LAYERS.has(row.entityType)

  const ahead = row.gapPct >= 0
  return (
    <div style={{ padding: '14px 4px', borderBottom: `1px solid ${D.border}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 700, color: D.text }}>{row.label}</span>
        {!isContinuous && (
          <span style={{ fontSize: 8, fontFamily: 'var(--font-mono)', color: D.muted, background: `${D.muted}15`, border: `1px solid ${D.border}`, padding: '1px 6px', borderRadius: 4, textTransform: 'uppercase', letterSpacing: '0.06em' }}>point asset</span>
        )}
        <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-mono)', fontSize: 12, color: D.amber, fontWeight: 700 }}>{row.combinedCompletionPct.toFixed(1)}% <span style={{ fontSize: 8, color: D.sub, fontWeight: 400 }}>actual</span></span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: D.sub }}>
          {row.plannedPct.toFixed(1)}% <span style={{ fontSize: 8, color: D.sub, fontWeight: 400 }}>planned</span>
        </span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700, color: ahead ? D.green : D.red }}>{ahead ? '+' : ''}{row.gapPct.toFixed(1)}pp</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {sides.map(([side, s]) => {
          const active = isSelected && selectedSide === side
          const color = side === 'LHS' ? D.amber : side === 'RHS' ? D.blue : D.green
          return (
            <div key={side} onClick={() => onSelectSide(row.entityType, side)}
              style={{ cursor: 'pointer', padding: '4px 8px', borderRadius: 6, background: active ? `${color}12` : 'transparent', border: active ? `1px solid ${color}40` : '1px solid transparent', transition: `background 0.2s ${EASE}, border-color 0.2s ${EASE}` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color, width: 32, flexShrink: 0 }}>{side}</span>
                <div style={{ flex: 1, height: 8, background: 'rgba(255,255,255,0.04)', borderRadius: 4, overflow: 'hidden', border: `1px solid ${D.border}` }}>
                  <div style={{ height: '100%', width: ready ? `${s.completionPct}%` : '0%', background: `linear-gradient(90deg, ${color}88, ${color})`, borderRadius: 4, transition: `width 1s ${EASE}`, boxShadow: active ? `0 0 8px ${color}66` : 'none' }} />
                </div>
                <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: D.muted, width: 44, textAlign: 'right', flexShrink: 0 }}>{s.completionPct.toFixed(1)}%</span>
                <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: s.gapCount > 0 ? D.red : D.green, width: 70, textAlign: 'right', flexShrink: 0 }}>
                  {s.gapCount > 0 ? `${s.gapCount} gap${s.gapCount === 1 ? '' : 's'}` : 'no gaps'}
                </span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* ── Gap detail panel ──────────────────────────────────────────────────── */
function GapDetailPanel({ detail, loading }: { detail: GapDetail | null; loading: boolean }) {
  const { colors: D } = useTheme()
  if (loading) return <div style={{ color: D.muted, fontFamily: 'var(--font-mono)', fontSize: 12, padding: '30px 0', textAlign: 'center' }}>Loading gaps…</div>
  if (!detail) return <div style={{ color: D.muted, fontFamily: 'var(--font-mono)', fontSize: 12, padding: '30px 0', textAlign: 'center' }}>Click an entity/side row to see its gap chainages</div>
  if (!detail.gaps.length) return <div style={{ color: D.green, fontFamily: 'var(--font-mono)', fontSize: 12, padding: '30px 0', textAlign: 'center' }}>No gaps ≥10m found for {detail.entityType} · {detail.side}</div>
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 360, overflowY: 'auto' }}>
      {detail.gaps.map((g, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 6, background: 'rgba(255,255,255,0.02)', border: `1px solid ${D.border}` }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: D.text }}>{fmtChainage(g.fromStation)} → {fmtChainage(g.toStation)}</span>
          <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-mono)', fontSize: 11, color: D.red, fontWeight: 700 }}>{fmtLength(g.gapM)}</span>
        </div>
      ))}
    </div>
  )
}

/* ── Small stat tile (mirrors KPICard's visual language, but for text/percent
   values with an optional tag rather than an integer count-up) ── */
function StatCard({ label, value, color, icon, delay = 0, tag }: { label: string; value: string; color: string; icon: React.ReactNode; delay?: number; tag?: string }) {
  const { colors: D, shadows: SH } = useTheme()
  const [vis, setVis] = useState(false)
  const [hov, setHov] = useState(false)
  useEffect(() => { const t = setTimeout(() => setVis(true), delay + 100); return () => clearTimeout(t) }, [delay])
  return (
    <div onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{ background: hov ? D.panel2 : D.panel, borderRadius: 22, padding: '20px 22px', position: 'relative', overflow: 'hidden', opacity: vis ? 1 : 0, transform: `translateY(${vis ? (hov ? -3 : 0) : 16}px)`, transition: `opacity 0.6s ease ${delay}ms, transform 0.45s ${EASE}, box-shadow 0.3s ease, border-color 0.3s ease`, border: hov ? `1px solid rgba(212,160,64,0.2)` : `1px solid ${D.border}`, boxShadow: hov ? SH.cardLg : SH.card }}>
      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 2, background: `linear-gradient(180deg, transparent, ${color}, transparent)`, opacity: hov ? 1 : 0.5 }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <div style={{ width: 44, height: 44, borderRadius: 14, background: `${color}20`, border: `1px solid ${color}35`, display: 'flex', alignItems: 'center', justifyContent: 'center', color, transform: hov ? 'scale(1.08)' : 'scale(1)', transition: `transform 0.3s ${EASE_SPRING}` }}>{icon}</div>
        {tag && <span style={{ fontSize: 8, fontFamily: 'var(--font-mono)', color: D.sub, background: `${D.muted}15`, border: `1px solid ${D.border}`, padding: '2px 6px', borderRadius: 4, textTransform: 'uppercase', letterSpacing: '0.04em', alignSelf: 'flex-start' }}>{tag}</span>}
      </div>
      <div style={{ fontFamily: 'var(--font-loader)', fontSize: '1.9rem', fontWeight: 400, color, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: '0.58rem', color: D.muted, fontFamily: 'var(--font-mono)', letterSpacing: '0.14em', textTransform: 'uppercase', marginTop: 8 }}>{label}</div>
    </div>
  )
}

/* ── Radial gauge ──────────────────────────────────────────────────────── */
function Gauge({ value, label, color, delay = 0 }: { value: number; label: string; color: string; delay?: number }) {
  const { colors: D } = useTheme()
  const [ready, setReady] = useState(false)
  useEffect(() => { const t = setTimeout(() => setReady(true), delay + 200); return () => clearTimeout(t) }, [delay])
  const r = 54, sw = 12
  const circ = 2 * Math.PI * r
  const arcFrac = 0.75 // 270° arc, gap at the bottom
  const arcLen = circ * arcFrac
  const rotateStart = 135
  const clamped = Math.max(0, Math.min(100, value))
  const valueLen = (clamped / 100) * arcLen

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
      <svg width={140} height={140} viewBox="-70 -70 140 140">
        <circle r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={sw} strokeDasharray={`${arcLen} ${circ}`} strokeLinecap="round" transform={`rotate(${rotateStart})`} />
        <circle r={r} fill="none" stroke={color} strokeWidth={sw} strokeDasharray={`${ready ? valueLen : 0} ${circ}`} strokeLinecap="round" transform={`rotate(${rotateStart})`}
          style={{ transition: `stroke-dasharray 1.2s ${EASE}`, filter: `drop-shadow(0 0 6px ${color}66)` }} />
        <text x="0" y="-2" textAnchor="middle" fill={D.text} fontFamily="var(--font-loader)" fontSize="26">{value.toFixed(0)}%</text>
        <text x="0" y="18" textAnchor="middle" fill={D.muted} fontFamily="var(--font-mono)" fontSize="8" letterSpacing="1.5">{label.toUpperCase()}</text>
      </svg>
    </div>
  )
}

/* ── Paired planned-vs-actual bar chart, per entity ────────────────────── */
function PlannedActualBars({ entities, selectedEntity, onSelectEntity, dimRange }: { entities: EntityRow[]; selectedEntity?: string | null; onSelectEntity?: (entityType: string, side: string) => void; dimRange?: [number, number] | null }) {
  const { colors: D } = useTheme()
  const [ready, setReady] = useState(false)
  const [hov, setHov] = useState<string | null>(null)
  useEffect(() => { const t = setTimeout(() => setReady(true), 200); return () => clearTimeout(t) }, [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><div style={{ width: 10, height: 10, borderRadius: 2, background: D.amber }} /><span style={{ fontSize: 10, color: D.muted, fontFamily: 'var(--font-mono)' }}>Actual</span></div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><div style={{ width: 10, height: 10, borderRadius: 2, background: D.sub }} /><span style={{ fontSize: 10, color: D.muted, fontFamily: 'var(--font-mono)' }}>Planned</span></div>
      </div>
      {entities.map((e, i) => {
        const isActive = selectedEntity === e.entityType
        const inRange = !dimRange || (e.combinedCompletionPct >= dimRange[0] && e.combinedCompletionPct < dimRange[1])
        const firstSide = Object.keys(e.sides).sort()[0]
        return (
        <div key={e.entityType} onMouseEnter={() => setHov(e.entityType)} onMouseLeave={() => setHov(null)}
          onClick={onSelectEntity && firstSide ? () => onSelectEntity(e.entityType, firstSide) : undefined}
          style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: onSelectEntity ? 'pointer' : 'default', opacity: !inRange ? 0.3 : 1, padding: '3px 6px', margin: '-3px -6px', borderRadius: 6, background: isActive ? `${D.amber}10` : 'transparent', border: isActive ? `1px solid ${D.amber}40` : '1px solid transparent', transition: `opacity 0.2s ${EASE}, background 0.2s ${EASE}, border-color 0.2s ${EASE}` }}
          title={onSelectEntity ? `View gaps for ${e.label} · ${firstSide}` : undefined}>
          <div style={{ width: 120, flexShrink: 0, fontSize: 11, color: hov === e.entityType || isActive ? D.text : D.muted, fontFamily: 'var(--font-mono)', textAlign: 'right', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', transition: 'color 0.2s' }}>{e.label}</div>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 3 }}>
            <div style={{ height: 9, background: 'rgba(255,255,255,0.04)', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: ready ? `${e.combinedCompletionPct}%` : '0%', background: `linear-gradient(90deg, ${D.amber}88, ${D.amber})`, borderRadius: 3, transition: `width 1s ${EASE} ${i * 0.02}s` }} />
            </div>
            <div style={{ height: 9, background: 'rgba(255,255,255,0.04)', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: ready ? `${e.plannedPct}%` : '0%', background: D.sub, borderRadius: 3, transition: `width 1s ${EASE} ${i * 0.02 + 0.08}s` }} />
            </div>
          </div>
          <div style={{ width: 50, fontSize: 10, fontFamily: 'var(--font-mono)', color: e.gapPct >= 0 ? D.green : D.red, textAlign: 'right', flexShrink: 0 }}>{e.gapPct >= 0 ? '+' : ''}{e.gapPct.toFixed(0)}pp</div>
        </div>
        )
      })}
    </div>
  )
}

/* ── Per-entity Gantt schedule ─────────────────────────────────────────── */
function EntityGanttChart({ entities, sectionStart, sectionEnd, selectedEntity, onSelectEntity, dimRange }: { entities: EntityRow[]; sectionStart: string; sectionEnd: string; selectedEntity?: string | null; onSelectEntity?: (entityType: string, side: string) => void; dimRange?: [number, number] | null }) {
  const { colors: D } = useTheme()
  const [ready, setReady] = useState(false)
  const [hov, setHov] = useState<string | null>(null)
  useEffect(() => { const t = setTimeout(() => setReady(true), 200); return () => clearTimeout(t) }, [])

  const sorted = [...entities].sort((a, b) => a.plannedStart.localeCompare(b.plannedStart))
  const minDate = new Date(sectionStart)
  const maxDate = new Date(sectionEnd)
  const totalDays = Math.max(1, (maxDate.getTime() - minDate.getTime()) / 86400000)
  const toX = (s: string) => `${((new Date(s).getTime() - minDate.getTime()) / 86400000 / totalDays) * 100}%`
  const toW = (s: string, e: string) => `${Math.max(0.5, ((new Date(e).getTime() - new Date(s).getTime()) / 86400000 / totalDays) * 100)}%`

  const months: { label: string; pct: number }[] = []
  const cur = new Date(minDate.getFullYear(), minDate.getMonth(), 1)
  while (cur <= maxDate) {
    const pct = (cur.getTime() - minDate.getTime()) / (maxDate.getTime() - minDate.getTime()) * 100
    if (pct >= 0 && pct <= 100) months.push({ label: cur.toLocaleString('en', { month: 'short', year: '2-digit' }), pct })
    cur.setMonth(cur.getMonth() + 3)
  }

  const STATUS_COLOR: Record<string, string> = { Completed: D.green, 'In Progress': D.amber, 'Not Started': D.sub, Delayed: D.red }
  const todayPct = Math.min(100, Math.max(0, (Date.now() - minDate.getTime()) / (maxDate.getTime() - minDate.getTime()) * 100))

  return (
    <div style={{ overflowX: 'auto' }}>
      <div style={{ position: 'relative', height: 20, marginLeft: 130, marginBottom: 6, minWidth: 600 }}>
        {months.map((m, i) => <div key={i} style={{ position: 'absolute', left: `${m.pct}%`, fontSize: 9, color: D.muted, fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap', transform: 'translateX(-50%)' }}>{m.label}</div>)}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 600, position: 'relative' }}>
        <div style={{ position: 'absolute', left: `calc(130px + ${todayPct}% * (100% - 130px) / 100%)`, top: 0, bottom: 0, width: 1, background: D.blue, opacity: 0.4, zIndex: 1 }} />
        {sorted.map(e => {
          const color = STATUS_COLOR[e.status] || D.sub
          const isActive = selectedEntity === e.entityType
          const inRange = !dimRange || (e.combinedCompletionPct >= dimRange[0] && e.combinedCompletionPct < dimRange[1])
          const firstSide = Object.keys(e.sides).sort()[0]
          return (
            <div key={e.entityType} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: onSelectEntity ? 'pointer' : 'default', opacity: !inRange ? 0.3 : 1, padding: '2px 6px', margin: '-2px -6px', borderRadius: 6, background: isActive ? `${D.amber}10` : 'transparent', border: isActive ? `1px solid ${D.amber}40` : '1px solid transparent', transition: `opacity 0.2s ${EASE}, background 0.2s ${EASE}, border-color 0.2s ${EASE}` }}
              onMouseEnter={() => setHov(e.entityType)} onMouseLeave={() => setHov(null)}
              onClick={onSelectEntity && firstSide ? () => onSelectEntity(e.entityType, firstSide) : undefined}
              title={onSelectEntity ? `View gaps for ${e.label} · ${firstSide}` : undefined}>
              <div style={{ width: 130, flexShrink: 0, fontSize: 11, color: hov === e.entityType || isActive ? D.text : D.muted, fontFamily: 'var(--font-mono)', textAlign: 'right', paddingRight: 10, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', transition: 'color 0.2s' }}>{e.label}</div>
              <div style={{ flex: 1, height: 26, background: 'rgba(255,255,255,0.03)', borderRadius: 5, position: 'relative', overflow: 'hidden', border: `1px solid ${D.border}` }}>
                <div style={{ position: 'absolute', left: toX(e.plannedStart), width: ready ? toW(e.plannedStart, e.plannedEnd) : '0%', top: 3, bottom: 3, borderRadius: 3, background: `${color}25`, border: `1px solid ${color}55`, transition: `width 1.1s ${EASE}`, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${e.combinedCompletionPct}%`, background: color, opacity: 0.85 }} />
                </div>
              </div>
              <span style={{ width: 78, fontSize: 9, fontFamily: 'var(--font-mono)', color, flexShrink: 0 }}>{e.status}</span>
            </div>
          )
        })}
      </div>
      <div style={{ display: 'flex', gap: 14, marginTop: 14, flexWrap: 'wrap' }}>
        {Object.entries(STATUS_COLOR).map(([k, c]) => (
          <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 6 }}><div style={{ width: 8, height: 8, borderRadius: 2, background: c }} /><span style={{ fontSize: 9, color: D.muted, fontFamily: 'var(--font-mono)' }}>{k}</span></div>
        ))}
      </div>
    </div>
  )
}

/* ── Completion distribution histogram ─────────────────────────────────── */
function CompletionHistogram({ entities, activeRange, onSelectRange }: { entities: EntityRow[]; activeRange?: [number, number] | null; onSelectRange?: (range: [number, number] | null) => void }) {
  const { colors: D } = useTheme()
  const [ready, setReady] = useState(false)
  useEffect(() => { const t = setTimeout(() => setReady(true), 300); return () => clearTimeout(t) }, [])

  const buckets = [
    { label: '0–25%', min: 0, max: 25, color: D.red },
    { label: '25–50%', min: 25, max: 50, color: D.red },
    { label: '50–75%', min: 50, max: 75, color: D.amber },
    { label: '75–90%', min: 75, max: 90, color: D.amber },
    { label: '90–100%', min: 90, max: 100.01, color: D.green },
  ]
  const counts = buckets.map(b => entities.filter(e => e.combinedCompletionPct >= b.min && e.combinedCompletionPct < b.max).length)
  const maxCount = Math.max(...counts, 1)

  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 14, flex: 1, minHeight: 180, padding: '0 6px' }}>
      {buckets.map((b, i) => {
        const isActive = activeRange && activeRange[0] === b.min && activeRange[1] === b.max
        const dimmed = !!activeRange && !isActive
        return (
          <div key={b.label} onClick={onSelectRange ? () => onSelectRange(isActive ? null : [b.min, b.max]) : undefined}
            style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1, height: '100%', justifyContent: 'flex-end', gap: 8, cursor: onSelectRange ? 'pointer' : 'default', opacity: dimmed ? 0.4 : 1, transition: `opacity 0.2s ${EASE}` }}
            title={onSelectRange ? `Filter entities to ${b.label} completion` : undefined}>
            <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: isActive ? D.amber : D.text, fontWeight: 700 }}>{counts[i]}</span>
            <div style={{ width: '100%', maxWidth: 46, height: ready ? `${(counts[i] / maxCount) * 100}%` : '0%', minHeight: counts[i] > 0 ? 4 : 0, background: `linear-gradient(180deg, ${b.color}, ${b.color}88)`, borderRadius: '6px 6px 2px 2px', transition: `height 0.9s ${EASE} ${i * 0.05}s`, boxShadow: isActive ? `0 0 14px ${b.color}77` : `0 0 10px ${b.color}33`, outline: isActive ? `1px solid ${b.color}` : 'none' }} />
            <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: D.muted, textAlign: 'center' }}>{b.label}</span>
          </div>
        )
      })}
    </div>
  )
}

/* ── Planned-vs-actual dual-line chart ─────────────────────────────────── */
function TimelineChart({ points, granularity }: { points: TimelinePoint[]; granularity: Granularity }) {
  const { colors: D } = useTheme()
  const [ready, setReady] = useState(false)
  const [hov, setHov] = useState<number | null>(null)
  useEffect(() => { setReady(false); const t = setTimeout(() => setReady(true), 200); return () => clearTimeout(t) }, [points])

  if (!points.length) return <div style={{ color: D.muted, fontFamily: 'var(--font-mono)', fontSize: 12, padding: '40px 0', textAlign: 'center' }}>No timeline data</div>

  const W = 900, H = 300, padL = 44, padB = 38, padR = 24, padT = 24
  const chartW = W - padL - padR, chartH = H - padB - padT
  const n = points.length
  const toX = (i: number) => padL + (n <= 1 ? 0 : (i / (n - 1)) * chartW)
  const toY = (pct: number) => padT + chartH - (Math.max(0, Math.min(100, pct)) / 100) * chartH

  const actualLen = points.filter(p => p.actualPct != null).length
  const actualPts = points.slice(0, actualLen)

  const plannedPathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${toX(i)} ${toY(p.plannedPct)}`).join(' ')
  const actualPathD = actualPts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${toX(i)} ${toY(p.actualPct ?? 0)}`).join(' ')
  const gapAreaD = actualLen > 1
    ? actualPts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${toX(i)} ${toY(p.actualPct ?? 0)}`).join(' ')
      + ' ' + [...actualPts].reverse().map((p, i) => `L ${toX(actualLen - 1 - i)} ${toY(p.plannedPct)}`).join(' ') + ' Z'
    : ''

  const todayX = actualLen > 0 ? toX(actualLen - 1) : null
  const labelEvery = Math.max(1, Math.floor(n / 8))

  return (
    <div style={{ width: '100%', overflowX: 'auto' }}>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: 'block', minWidth: 420 }} onMouseLeave={() => setHov(null)}>
        {[0, 25, 50, 75, 100].map(v => {
          const y = toY(v)
          return <g key={v}>
            <line x1={padL} y1={y} x2={W - padR} y2={y} stroke={v === 50 ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.04)'} strokeWidth={1} strokeDasharray={v === 50 ? '4 4' : undefined} />
            <text x={padL - 8} y={y + 4} textAnchor="end" fill={D.muted} fontSize="9" fontFamily="var(--font-mono)">{v}%</text>
          </g>
        })}

        {gapAreaD && <path d={gapAreaD} fill={D.red} opacity={ready ? 0.08 : 0} style={{ transition: `opacity 0.8s ${EASE}` }} />}

        {todayX != null && <line x1={todayX} y1={padT} x2={todayX} y2={padT + chartH} stroke={D.blue} strokeWidth={1} strokeDasharray="3 3" opacity={0.5} />}
        {todayX != null && <text x={todayX} y={padT - 8} textAnchor="middle" fill={D.blue} fontSize="8" fontFamily="var(--font-mono)" opacity={0.7}>TODAY</text>}

        <path d={plannedPathD} fill="none" stroke={D.sub} strokeWidth={2} strokeDasharray="5 4" strokeLinecap="round" strokeLinejoin="round" opacity={ready ? 1 : 0} style={{ transition: `opacity 1s ${EASE}` }} />

        <path d={actualPathD} fill="none" stroke={D.amber} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"
          style={{ strokeDasharray: 3000, strokeDashoffset: ready ? 0 : 3000, transition: `stroke-dashoffset 1.3s ${EASE}` }} />

        {actualPts.map((p, i) => (
          <circle key={i} cx={toX(i)} cy={toY(p.actualPct ?? 0)} r={hov === i ? 5 : 2.5}
            fill={hov === i ? D.amberL : D.amber} opacity={hov === i ? 1 : 0.35}
            style={{ cursor: 'pointer', transition: 'r 0.15s, opacity 0.15s' }}
            onMouseEnter={() => setHov(i)} />
        ))}

        {hov !== null && actualPts[hov] && (() => {
          const p = actualPts[hov]
          const x = toX(hov), y = toY(p.actualPct ?? 0)
          const gap = Math.round(((p.actualPct ?? 0) - p.plannedPct) * 10) / 10
          const tx = Math.min(Math.max(padL, x - 62), W - padR - 132), ty = Math.max(padT + 4, y - 60)
          return <g>
            <rect x={tx} y={ty} width={132} height={52} rx={6} fill="#0a0a0c" stroke={`${D.amber}44`} strokeWidth={1} />
            <text x={tx + 10} y={ty + 15} fill={D.muted} fontSize="9" fontFamily="var(--font-mono)">{fmtTimelineDate(p.date, granularity)}</text>
            <text x={tx + 10} y={ty + 29} fill={D.amber} fontSize="10" fontFamily="var(--font-mono)">Actual {(p.actualPct ?? 0).toFixed(1)}%</text>
            <text x={tx + 10} y={ty + 43} fill={D.sub} fontSize="10" fontFamily="var(--font-mono)">Plan {p.plannedPct.toFixed(1)}% ({gap >= 0 ? '+' : ''}{gap}pp)</text>
          </g>
        })()}

        {points.filter((_, i) => i % labelEvery === 0 || i === n - 1).map(p => {
          const i = points.indexOf(p)
          return <text key={p.date} x={toX(i)} y={H - 6} textAnchor="middle" fill={D.muted} fontSize="8" fontFamily="var(--font-mono)">{fmtTimelineDate(p.date, granularity)}</text>
        })}
      </svg>
      <div style={{ display: 'flex', gap: 18, marginTop: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><div style={{ width: 16, height: 2, background: D.amber }} /><span style={{ fontSize: 10, color: D.muted, fontFamily: 'var(--font-mono)' }}>Actual</span></div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><div style={{ width: 16, height: 2, background: D.sub, backgroundImage: `repeating-linear-gradient(90deg, ${D.sub} 0 3px, transparent 3px 6px)` }} /><span style={{ fontSize: 10, color: D.muted, fontFamily: 'var(--font-mono)' }}>Planned</span></div>
      </div>
    </div>
  )
}

/* ── Timeline tab ──────────────────────────────────────────────────────── */
function TimelineTab({ timeline, entities, selected, gapDetail, gapLoading, onSelectSide }: {
  timeline: TimelineData; entities: EntityRow[]
  selected: { entityType: string; side: string } | null; gapDetail: GapDetail | null; gapLoading: boolean
  onSelectSide: (entityType: string, side: string) => void
}) {
  const { colors: D, shadows: SH } = useTheme()
  const [granularity, setGranularity] = useState<Granularity>('monthly')
  const [histogramRange, setHistogramRange] = useState<[number, number] | null>(null)
  useEffect(() => { setHistogramRange(null) }, [timeline])
  const points = aggregateTimeline(timeline.daily, granularity)
  const ahead = timeline.gapPctToday >= 0
  const onTrack = Math.abs(timeline.gapPctToday) < 3
  const statusLabel = onTrack ? 'On Track' : ahead ? 'Ahead of Plan' : 'Behind Plan'
  const statusColor = onTrack ? D.blue : ahead ? D.green : D.red

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.2fr) minmax(0, 1fr)', gap: 16, alignItems: 'stretch' }}>
        <Reveal>
          <Panel title="Completion — Planned vs Actual" style={{ height: '100%' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, alignItems: 'center', justifyContent: 'space-around' }}>
              <Gauge value={timeline.plannedPctToday} label="Planned" color={D.sub} delay={0} />
              <Gauge value={timeline.actualPctToday} label="Actual" color={D.green} delay={100} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div>
                  <div style={{ fontFamily: 'var(--font-loader)', fontSize: '1.6rem', color: ahead ? D.green : D.red, lineHeight: 1 }}>{timeline.gapPctToday >= 0 ? '+' : ''}{timeline.gapPctToday.toFixed(1)}pp</div>
                  <div style={{ fontSize: '0.58rem', color: D.muted, fontFamily: 'var(--font-mono)', letterSpacing: '0.14em', textTransform: 'uppercase', marginTop: 4 }}>Gap</div>
                </div>
                <div>
                  <div style={{ fontFamily: 'var(--font-loader)', fontSize: '1.6rem', color: statusColor, lineHeight: 1 }}>{statusLabel}</div>
                  <div style={{ fontSize: '0.58rem', color: D.muted, fontFamily: 'var(--font-mono)', letterSpacing: '0.14em', textTransform: 'uppercase', marginTop: 4 }}>Status</div>
                </div>
              </div>
            </div>
          </Panel>
        </Reveal>
        <Reveal delay={60}>
          <Panel title="Completion Distribution" style={{ height: '100%' }}>
            <CompletionHistogram entities={entities} activeRange={histogramRange} onSelectRange={setHistogramRange} />
          </Panel>
        </Reveal>
      </div>

      <Reveal delay={80}>
        <Panel title="Progress Over Time">
          <div style={{ display: 'flex', gap: 6, background: D.bg, borderRadius: 8, padding: 4, border: `1px solid ${D.border}`, width: 'fit-content' }}>
            {(['daily', 'monthly', 'yearly'] as const).map(g => (
              <button key={g} onClick={() => setGranularity(g)}
                style={{ background: granularity === g ? D.amber : 'transparent', color: granularity === g ? '#0e0e10' : D.muted, border: 'none', borderRadius: 5, padding: '5px 16px', fontSize: 11, cursor: 'pointer', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: 1, fontWeight: granularity === g ? 700 : 400, boxShadow: granularity === g ? SH.glowAmber : 'none', transition: `background 0.2s ${EASE}, color 0.2s ${EASE}` }}>
                {g}
              </button>
            ))}
          </div>
          <TimelineChart points={points} granularity={granularity} />
        </Panel>
      </Reveal>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr)', gap: 16, alignItems: 'flex-start' }}>
        <Reveal delay={140}>
          <Panel title="Planned vs Actual — By Entity">
            <PlannedActualBars entities={entities} selectedEntity={selected?.entityType} onSelectEntity={onSelectSide} dimRange={histogramRange} />
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: D.muted, margin: 0, lineHeight: 1.6 }}>Click a row to see its gap chainages. Click a bucket above to filter by completion range.</p>
          </Panel>
        </Reveal>
        <Reveal delay={180}>
          <Panel title={selected ? `Gaps — ${selected.entityType} · ${selected.side}` : 'Gap Detail'}>
            <GapDetailPanel detail={gapDetail} loading={gapLoading} />
          </Panel>
        </Reveal>
      </div>

      <Reveal delay={200}>
        <Panel title="Entity Schedule">
          <EntityGanttChart entities={entities} sectionStart={timeline.startDate} sectionEnd={timeline.endDate} selectedEntity={selected?.entityType} onSelectEntity={onSelectSide} dimRange={histogramRange} />
        </Panel>
      </Reveal>
    </div>
  )
}

/* ── Chainage coverage bar (real data — from bins) ─────────────────────── */
function ChainageCoverageBar({ bins }: { bins: ChainageBin[] }) {
  const { colors: D } = useTheme()
  const [ready, setReady] = useState(false)
  useEffect(() => { setReady(false); const t = setTimeout(() => setReady(true), 200); return () => clearTimeout(t) }, [bins])
  if (!bins.length) return null
  return (
    <div>
      <div style={{ display: 'flex', gap: 2, height: 70 }}>
        {bins.map((b, i) => {
          const color = b.builtPct >= 90 ? D.green : b.builtPct >= 50 ? D.amber : b.builtPct > 0 ? D.red : D.sub
          return (
            <div key={i} title={`${fmtChainage(b.fromChainage)} – ${fmtChainage(b.toChainage)}: ${b.builtPct}%`}
              style={{ flex: 1, display: 'flex', alignItems: 'flex-end', background: 'rgba(255,255,255,0.03)', borderRadius: 2, overflow: 'hidden', border: `1px solid ${D.border}`, cursor: 'default' }}>
              <div style={{ width: '100%', height: ready ? `${b.builtPct}%` : '0%', background: color, transition: `height 0.8s ${EASE} ${i * 0.02}s` }} />
            </div>
          )
        })}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
        <span style={{ fontSize: 9, color: D.muted, fontFamily: 'var(--font-mono)' }}>{fmtChainage(bins[0].fromChainage)}</span>
        <span style={{ fontSize: 9, color: D.muted, fontFamily: 'var(--font-mono)' }}>{fmtChainage(bins[bins.length - 1].toChainage)}</span>
      </div>
    </div>
  )
}

/* ── Itemized completion log table ─────────────────────────────────────── */
function ChainageLogTable({ entries, totalCount, page, onPage }: { entries: ChainageLogEntry[]; totalCount: number; page: number; onPage: (p: number) => void }) {
  const { colors: D } = useTheme()
  const PAGE = 20
  const pageData = entries.slice(page * PAGE, page * PAGE + PAGE)
  if (!entries.length) return <div style={{ color: D.muted, fontFamily: 'var(--font-mono)', fontSize: 12, padding: '30px 0', textAlign: 'center' }}>No completions match these filters</div>
  return (
    <div>
      {totalCount > entries.length && (
        <div style={{ fontSize: 10, color: D.sub, fontFamily: 'var(--font-mono)', marginBottom: 8 }}>Showing {entries.length} of {totalCount.toLocaleString()} matching segments</div>
      )}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
          <thead><tr style={{ borderBottom: `1px solid ${D.border}` }}>{['Chainage Range', 'Length', 'Date Completed'].map(h => <th key={h} style={{ padding: '10px 14px', textAlign: 'left', color: D.amber, fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{h}</th>)}</tr></thead>
          <tbody>
            {pageData.map((e, i) => (
              <tr key={i} style={{ borderBottom: `1px solid rgba(255,255,255,0.03)` }}>
                <td style={{ padding: '10px 14px', color: D.text, fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>{fmtChainage(e.fromStation)} → {fmtChainage(e.toStation)}</td>
                <td style={{ padding: '10px 14px', color: D.muted, fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>{fmtLength(e.lengthM)}</td>
                <td style={{ padding: '10px 14px', color: D.text, fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>{new Date(e.completedDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {entries.length > PAGE && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 14 }}>
          <button onClick={() => onPage(Math.max(0, page - 1))} disabled={page === 0} style={{ background: 'transparent', color: page === 0 ? D.sub : D.amber, border: `1px solid ${page === 0 ? D.sub : D.amber}30`, borderRadius: 7, padding: '6px 16px', fontSize: 11, cursor: page === 0 ? 'not-allowed' : 'pointer', fontFamily: 'var(--font-mono)' }}>‹ Prev</button>
          <span style={{ fontSize: 10, color: D.sub, fontFamily: 'var(--font-mono)' }}>{page * PAGE + 1}–{Math.min((page + 1) * PAGE, entries.length)} of {entries.length}</span>
          <button onClick={() => onPage(Math.min(Math.ceil(entries.length / PAGE) - 1, page + 1))} style={{ background: 'transparent', color: D.amber, border: `1px solid ${D.amber}30`, borderRadius: 7, padding: '6px 16px', fontSize: 11, cursor: 'pointer', fontFamily: 'var(--font-mono)' }}>Next ›</button>
        </div>
      )}
    </div>
  )
}

/* ── By Chainage tab ────────────────────────────────────────────────────── */
function ByChainageTab({ section, entities }: { section: string; entities: EntityRow[] }) {
  const { colors: D, shadows: SH } = useTheme()
  const firstEntity = entities[0]?.entityType ?? ''
  const firstSide = entities[0] ? Object.keys(entities[0].sides).sort()[0] ?? '' : ''

  const [entityType, setEntityType] = useState(firstEntity)
  const [side, setSide] = useState(firstSide)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [chFrom, setChFrom] = useState('')
  const [chTo, setChTo] = useState('')
  const [applied, setApplied] = useState({ entityType: firstEntity, side: firstSide, dateFrom: '', dateTo: '', chFrom: '', chTo: '' })
  const [analysis, setAnalysis] = useState<ChainageAnalysis | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(0)
  const requestIdRef = useRef(0)

  // Section changed (new entity list) — reset to that section's first entity/side.
  useEffect(() => {
    setEntityType(firstEntity); setSide(firstSide)
    setDateFrom(''); setDateTo(''); setChFrom(''); setChTo('')
    setApplied({ entityType: firstEntity, side: firstSide, dateFrom: '', dateTo: '', chFrom: '', chTo: '' })
    setPage(0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section])

  const availableSides = Object.keys(entities.find(e => e.entityType === entityType)?.sides ?? {}).sort()
  const handleEntityChange = (et: string) => {
    setEntityType(et)
    const sides = Object.keys(entities.find(e => e.entityType === et)?.sides ?? {}).sort()
    setSide(sides[0] ?? '')
  }

  useEffect(() => {
    if (!applied.entityType || !applied.side) { setLoading(false); return }
    const reqId = ++requestIdRef.current
    setLoading(true)
    setError(null)
    const qs = new URLSearchParams({ section, entity_type: applied.entityType, side: applied.side })
    if (applied.dateFrom) qs.set('date_from', applied.dateFrom)
    if (applied.dateTo) qs.set('date_to', applied.dateTo)
    if (applied.chFrom) qs.set('ch_from', applied.chFrom)
    if (applied.chTo) qs.set('ch_to', applied.chTo)
    fetch(`/api/road-assets-coverage?${qs.toString()}`)
      .then(async r => {
        if (reqId !== requestIdRef.current) return
        const d = await r.json()
        if (!r.ok) { setError(d.error || 'Failed to load chainage analysis.'); return }
        setAnalysis(d.chainageAnalysis)
      })
      .catch(() => { if (reqId === requestIdRef.current) setError('Failed to load chainage analysis.') })
      .finally(() => { if (reqId === requestIdRef.current) setLoading(false) })
  }, [applied, section])

  const applyFilters = () => { setApplied({ entityType, side, dateFrom, dateTo, chFrom, chTo }); setPage(0) }
  const clearFilters = () => {
    setDateFrom(''); setDateTo(''); setChFrom(''); setChTo('')
    setApplied({ entityType, side, dateFrom: '', dateTo: '', chFrom: '', chTo: '' }); setPage(0)
  }
  const hasActiveFilters = !!(applied.dateFrom || applied.dateTo || applied.chFrom || applied.chTo)

  const selectStyle: React.CSSProperties = { background: D.bg, color: D.text, border: `1px solid ${D.border}`, borderRadius: 8, padding: '7px 12px', fontSize: 12, fontFamily: 'var(--font-mono)', cursor: 'pointer', minWidth: 140, outline: 'none' }
  const inputStyle: React.CSSProperties = { ...selectStyle, minWidth: 120, cursor: 'text' }
  const labelStyle: React.CSSProperties = { fontSize: 10, color: D.muted, letterSpacing: 1.5, fontFamily: 'var(--font-mono)', textTransform: 'uppercase' as const, marginBottom: 5 }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end', padding: '16px 20px', background: D.panel, border: `1px solid ${D.border}`, borderRadius: 14, boxShadow: SH.panel }}>
        <div><div style={labelStyle}>Entity</div>
          <select value={entityType} onChange={e => handleEntityChange(e.target.value)} style={selectStyle}>
            {entities.map(e => <option key={e.entityType} value={e.entityType}>{e.label}</option>)}
          </select>
        </div>
        <div><div style={labelStyle}>Side</div>
          <select value={side} onChange={e => setSide(e.target.value)} style={selectStyle}>
            {availableSides.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div><div style={labelStyle}>Date From</div><input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={inputStyle} /></div>
        <div><div style={labelStyle}>Date To</div><input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={inputStyle} /></div>
        <div><div style={labelStyle}>Chainage From (m)</div><input type="number" placeholder="e.g. 20000" value={chFrom} onChange={e => setChFrom(e.target.value)} style={inputStyle} /></div>
        <div><div style={labelStyle}>Chainage To (m)</div><input type="number" placeholder="e.g. 35000" value={chTo} onChange={e => setChTo(e.target.value)} style={inputStyle} /></div>
        <button onClick={applyFilters} style={{ background: `linear-gradient(135deg, ${D.amber}, ${D.amberL})`, color: '#000', border: 'none', borderRadius: 8, padding: '7px 22px', fontSize: 12, cursor: 'pointer', fontFamily: 'var(--font-mono)', letterSpacing: 1, fontWeight: 700, textTransform: 'uppercase' }}>Apply</button>
        {hasActiveFilters && <button onClick={clearFilters} style={{ background: 'transparent', color: D.amber, border: `1px solid rgba(212,160,64,0.3)`, borderRadius: 8, padding: '7px 18px', fontSize: 12, cursor: 'pointer', fontFamily: 'var(--font-mono)', letterSpacing: 1 }}>✕ Clear</button>}
      </div>

      {error && <div style={{ padding: 16, borderRadius: 10, background: `${D.red}12`, border: `1px solid ${D.red}40`, color: D.red, fontFamily: 'var(--font-mono)', fontSize: 12 }}>{error}</div>}

      {!error && !applied.entityType && (
        <div style={{ color: D.muted, fontFamily: 'var(--font-mono)', fontSize: 12, padding: '40px 0', textAlign: 'center' }}>No entities available for this section</div>
      )}

      {analysis && (
        <div style={{ opacity: loading ? 0.55 : 1, filter: loading ? 'blur(1.5px) saturate(0.85)' : 'none', transition: `opacity 0.3s ${EASE}, filter 0.3s ${EASE}` }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14, marginBottom: 16 }}>
            <StatCard label="Completed Today" value={fmtLength(analysis.summary.completedTodayM)} color={D.green} icon={<IconClock/>} delay={0} />
            <StatCard label="Completed This Month" value={fmtLength(analysis.summary.completedThisMonthM)} color={D.blue} icon={<IconLayers/>} delay={60} />
            <StatCard label="Completed So Far" value={fmtLength(analysis.summary.completedSoFarM)} color={D.amber} icon={<IconPct/>} delay={120} />
            {analysis.summary.completedInRangeM != null && (
              <StatCard label="In Selected Range" value={fmtLength(analysis.summary.completedInRangeM)} color={D.purple} icon={<IconTarget/>} delay={180} />
            )}
          </div>

          <Reveal>
            <Panel title={`Chainage Coverage — ${entities.find(e => e.entityType === entityType)?.label ?? entityType} · ${side}`}>
              <ChainageCoverageBar bins={analysis.bins} />
            </Panel>
          </Reveal>

          <Reveal delay={80} style={{ marginTop: 16 }}>
            <Panel title="Completion Log">
              <ChainageLogTable entries={analysis.log} totalCount={analysis.logTotalCount} page={page} onPage={setPage} />
            </Panel>
          </Reveal>
        </div>
      )}
    </div>
  )
}

/* ── Icons ──────────────────────────────────────────────────────────────── */
const IconRoad   = () => <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round"><path d="M4 20 9 4h6l5 16"/><path d="M12 4v16" strokeDasharray="2 3"/></svg>
const IconLayers = () => <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 22 8.5 12 15 2 8.5 12 2"/><polyline points="2 15.5 12 22 22 15.5"/><polyline points="2 12 12 18.5 22 12"/></svg>
const IconPct    = () => <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round"><line x1="19" y1="5" x2="5" y2="19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/></svg>
const IconGap    = () => <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round"><path d="M3 12h4"/><path d="M17 12h4"/><path d="M9 5l-3 7 3 7"/><path d="M15 5l3 7-3 7"/></svg>
const IconTarget = () => <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/></svg>
const IconClock  = () => <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>

/* ── Skeleton ──────────────────────────────────────────────────────────── */
function Skeleton() {
  const { colors: D } = useTheme()
  return (
    <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ height: 28, width: 200, background: D.panel, borderRadius: 8 }} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
        {[0, 1, 2, 3].map(i => <div key={i} style={{ height: 120, background: D.panel, borderRadius: 22 }} />)}
      </div>
      <div style={{ height: 400, background: D.panel, borderRadius: 16 }} />
    </div>
  )
}

/* ── Page ──────────────────────────────────────────────────────────────── */
export default function RoadAssetsPage() {
  const { colors: D, shadows: SH } = useTheme()
  const router = useRouter()
  const [section, setSection] = useState<string>('Calabar')
  const [activeTab, setActiveTab] = useState<'overview' | 'timeline' | 'chainage'>('overview')
  const [data, setData] = useState<RoadAssetsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<{ entityType: string; side: string } | null>(null)
  const [gapDetail, setGapDetail] = useState<GapDetail | null>(null)
  const [gapLoading, setGapLoading] = useState(false)
  const requestIdRef = useRef(0)

  const loadData = useCallback(async (sec: string) => {
    const reqId = ++requestIdRef.current
    setLoading(true)
    setError(null)
    try {
      const r = await fetch(`/api/road-assets-coverage?section=${encodeURIComponent(sec)}`)
      if (reqId !== requestIdRef.current) return
      if (r.status === 401) { router.replace('/login'); return }
      if (!r.ok) { const d = await r.json().catch(() => ({})); setError(d.error || 'Failed to load road assets data.'); return }
      const d: RoadAssetsData = await r.json()
      setData(d)
      setSelected(null)
      setGapDetail(null)
    } catch {
      if (reqId === requestIdRef.current) setError('Failed to load road assets data.')
    } finally {
      if (reqId === requestIdRef.current) setLoading(false)
    }
  }, [router])

  useEffect(() => { loadData(section) }, [section, loadData])

  const handleSelectSide = useCallback((entityType: string, side: string) => {
    setSelected({ entityType, side })
    setGapLoading(true)
    fetch(`/api/road-assets-coverage?section=${encodeURIComponent(section)}&entity_type=${encodeURIComponent(entityType)}&side=${encodeURIComponent(side)}`)
      .then(r => r.ok ? r.json() : Promise.reject())
      .then((d: RoadAssetsData) => setGapDetail(d.gapDetail))
      .catch(() => setGapDetail(null))
      .finally(() => setGapLoading(false))
  }, [section])

  return (
    <div style={{ padding: '24px 28px 60px', maxWidth: 1400, margin: '0 auto', minHeight: '100vh' }}>
      <Reveal>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 14, marginBottom: 24 }}>
          <div>
            <h1 style={{ fontFamily: 'var(--font-loader)', fontSize: '1.8rem', color: D.text, margin: 0, letterSpacing: '0.02em' }}>Asset Coverage</h1>
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: D.muted, margin: '4px 0 0' }}>As-built asset-layer coverage vs. total road length, per section</p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', gap: 4, background: D.bg, borderRadius: 8, padding: 3, border: `1px solid ${D.border}` }}>
              {([{ key: 'overview', label: 'Overview' }, { key: 'timeline', label: 'Timeline' }, { key: 'chainage', label: 'By Chainage' }] as const).map(t => (
                <button key={t.key} onClick={() => setActiveTab(t.key)}
                  style={{ background: activeTab === t.key ? D.amber : 'transparent', color: activeTab === t.key ? '#0e0e10' : D.sub, border: 'none', borderRadius: 6, padding: '5px 16px', fontSize: 11, cursor: 'pointer', fontFamily: 'var(--font-mono)', letterSpacing: 0.8, textTransform: 'uppercase', fontWeight: activeTab === t.key ? 700 : 400, boxShadow: activeTab === t.key ? SH.glowAmber : 'none', transition: `background 0.2s ${EASE}, color 0.2s ${EASE}` }}>
                  {t.label}
                </button>
              ))}
            </div>
            <SectionPills active={section} onSelect={setSection} />
          </div>
        </div>
      </Reveal>

      {loading && !data && <Skeleton />}

      {error && (
        <div style={{ padding: 16, borderRadius: 10, background: `${D.red}12`, border: `1px solid ${D.red}40`, color: D.red, fontFamily: 'var(--font-mono)', fontSize: 12, marginBottom: 20 }}>{error}</div>
      )}

      {data && (
        <div style={{ opacity: loading ? 0.55 : 1, filter: loading ? 'blur(1.5px) saturate(0.85)' : 'none', transform: loading ? 'scale(0.997)' : 'scale(1)', pointerEvents: loading ? 'none' : 'auto', transition: `opacity 0.3s ${EASE}, filter 0.3s ${EASE}, transform 0.3s ${EASE}` }}>
          {activeTab === 'overview' ? (
            <>
              <Reveal delay={60}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 20 }}>
                  <KPICard label="Total Road Length" value={Math.round(data.totalLengthM)} suffix=" m" icon={<IconRoad/>} delay={0} />
                  <KPICard label="Asset Layers Tracked" value={data.summary.entityTypeCount} icon={<IconLayers/>} color={D.blue} delay={80} />
                  <KPICard label="Avg Completion" value={Math.round(data.summary.avgCompletionPct)} suffix="%" icon={<IconPct/>} color={D.green} delay={160} />
                  <KPICard label="Total Gaps (≥10m)" value={data.summary.totalGaps} icon={<IconGap/>} color={D.red} delay={240} />
                </div>
              </Reveal>

              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr)', gap: 16, alignItems: 'flex-start' }}>
                <Reveal delay={120}>
                  <Panel title={`Entity Layers — ${section}`}>
                    <div>
                      {data.entities.map(row => (
                        <EntityCompletionRow key={row.entityType} row={row}
                          isSelected={selected?.entityType === row.entityType}
                          selectedSide={selected?.entityType === row.entityType ? selected.side : null}
                          onSelectSide={handleSelectSide} />
                      ))}
                    </div>
                    <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: D.muted, margin: 0, lineHeight: 1.6 }}>
                      Continuous layers (subbase, stonebase, CRCP, kerb, red filling) are meant to run the whole road — a gap there is a real construction gap.
                      Layers tagged <strong style={{ color: D.text }}>point asset</strong> (street lights, ducts, barriers, fiber, etc.) are placed at discrete intervals by design, so a lower coverage % doesn&apos;t mean the same thing.
                    </p>
                  </Panel>
                </Reveal>

                <Reveal delay={180}>
                  <Panel title={selected ? `Gaps — ${selected.entityType} · ${selected.side}` : 'Gap Detail'}>
                    <GapDetailPanel detail={gapDetail} loading={gapLoading} />
                  </Panel>
                </Reveal>
              </div>
            </>
          ) : activeTab === 'timeline' ? (
            <TimelineTab timeline={data.timeline} entities={data.entities} selected={selected} gapDetail={gapDetail} gapLoading={gapLoading} onSelectSide={handleSelectSide} />
          ) : (
            <ByChainageTab section={section} entities={data.entities} />
          )}
        </div>
      )}
    </div>
  )
}
