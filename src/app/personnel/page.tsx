'use client'

import { useEffect, useRef, useState, useCallback, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useTheme } from '@/lib/theme'
import { VIVID } from '@/lib/theme-constants'
import { HeroBanner } from '@/components/HeroBanner'

const EASE = 'cubic-bezier(0.16,1,0.3,1)'

interface DashData {
  summary: { totalReports: number; reportsThisMonth: number }
  byEmployee:   Array<{ name: string; count: number }>
  byEngineer:   Array<{ name: string; count: number }>
  bySupervisor: Array<{ name: string; count: number }>
  byEmployeeRole:    Array<{ name: string; count: number }>
  byEngineerParty:   Array<{ name: string; count: number }>
  bySupervisorParty: Array<{ name: string; count: number }>
  employeeSummary:   { totalMentions: number; distinctEmployees: number }
  engineerSummary:   { totalMentions: number; distinctEngineers: number }
  supervisorSummary: { totalMentions: number; distinctSupervisors: number }
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

// "N activities with no engineer recorded — excluded from ranking" — surfaces the
// blank bucket the API strips out of the ranked series (src/app/api/dashboard/_lib.ts).
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
        // A real floor, not a cosmetic minimum — with a skewed distribution
        // (one dominant value, a long tail of small ones), a plain linear
        // scale renders most rows as an invisible sliver against the track.
        const barPct = Math.max((d.count / max) * 100, d.count > 0 ? 3 : 0)
        const isHov = hov === i
        const isTop = i < 3
        const isActive = d.name === activeName
        return (
          <div key={d.name} onMouseEnter={() => setHov(i)} onMouseLeave={() => setHov(null)}
            onClick={() => onBarClick?.(d.name === activeName ? '' : d.name)}
            style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: onBarClick ? 'pointer' : 'default', opacity: hasActive ? (isActive ? 1 : 0.4) : (hov !== null && !isHov ? 0.45 : 1), transition: 'opacity 0.2s' }}>
            <div style={{ width: 18, height: 18, borderRadius: 5, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: isTop ? `${VIVID[i]}1c` : 'transparent', border: `1px solid ${isTop ? VIVID[i] + '44' : 'transparent'}`, fontSize: 9, fontFamily: 'var(--font-mono)', color: isTop ? VIVID[i] : D.sub, fontWeight: isTop ? 700 : 400 }}>{i + 1}</div>
            <span style={{ width: 140, fontSize: 12.5, color: isHov || isActive ? D.text : D.muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flexShrink: 0 }} title={d.name}>{d.name}</span>
            <div style={{ flex: 1, height: 5, background: D.panel2, borderRadius: 6, overflow: 'hidden', position: 'relative' }}>
              <div style={{ position: 'absolute', inset: 0, right: 'auto', width: ready ? `${barPct}%` : '0%', background: isTop ? VIVID[i] : `${D.muted}88`, borderRadius: 6, transition: `width 0.8s ${EASE} ${i * 0.03}s` }} />
            </div>
            <span style={{ width: 32, textAlign: 'right', fontSize: 12.5, color: isHov || isActive ? (isTop ? VIVID[i] : D.amber) : D.text, fontWeight: 700, fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>{d.count}</span>
            <span style={{ width: 30, textAlign: 'right', fontSize: 11, color: D.sub, fontFamily: 'var(--font-mono)', flexShrink: 0 }}>{pct}%</span>
          </div>
        )
      })}
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
  const r = 66, sw = 20, gap = 2, circ = 2 * Math.PI * r
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
    <div style={{ display: 'flex', gap: 22, alignItems: 'center', flexWrap: 'wrap' }}>
      <svg width={160} height={160} viewBox="-80 -80 160 160" style={{ flexShrink: 0 }} onMouseLeave={() => setHov(null)}>
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
          <text x="0" y="-6" textAnchor="middle" fill={D.text} fontFamily="var(--font-loader)" fontSize="20" fontWeight="600">{hovSeg.count}</text>
          <text x="0" y="11" textAnchor="middle" fill={D.muted} fontFamily="var(--font-mono)" fontSize="7">{hovSeg.name.length > 13 ? hovSeg.name.slice(0, 12) + '…' : hovSeg.name}</text>
        </>) : (<>
          <text x="0" y="-3" textAnchor="middle" fill={D.text} fontFamily="var(--font-loader)" fontSize="24" fontWeight="600">{total}</text>
          <text x="0" y="14" textAnchor="middle" fill={D.muted} fontFamily="var(--font-mono)" fontSize="7" letterSpacing="1.5">TOTAL</text>
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

const IconPeople = () => <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>
const IconHat = () => <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M3 18a9 9 0 0 1 18 0" /><rect x="2" y="18" width="20" height="3" rx="1" /><line x1="12" y1="8" x2="12" y2="4" /><circle cx="12" cy="3" r="1" /></svg>
const IconShield = () => <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5z" /></svg>
const IconUsers = () => <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>

const FIconSearch = () => <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
const FIconTag = () => <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M20.59 13.41 11 3.83A2 2 0 0 0 9.61 3H4a1 1 0 0 0-1 1v5.61a2 2 0 0 0 .59 1.42l9.58 9.58a2 2 0 0 0 2.82 0l4.6-4.6a2 2 0 0 0 0-2.6z" /><circle cx="7.5" cy="7.5" r="1.2" /></svg>
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
        {row(<FIconTag />, 'Category', <select value={active.filterCategory || ''} onChange={e => onFilter('category', e.target.value)} style={{ ...field, cursor: 'pointer' }}><option value="">All Categories</option>{data.filterOptions.categories.map(c => <option key={c} value={c}>{c}</option>)}</select>)}
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

/* ── personnel history (HR roster audit trail) ────────────── */
interface RosterEmployee {
  id: number; name: string; role: string; status: string
  projectName: string | null; sectionName: string | null; dateAdded: string | null
  removed?: boolean
}
interface HistoryEvent {
  employeeId: number; kind: 'field' | 'status'; field: string
  oldValue: string | null; newValue: string | null; changedBy: string; changedAt: string
}
interface HistoryPayload { employees: RosterEmployee[]; history: HistoryEvent[] }

const fieldLabel = (f: string) =>
  f.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())

function fmtWhen(iso: string) {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

function StatusPill({ status }: { status: string }) {
  const { colors: D } = useTheme()
  const s = status.toLowerCase()
  const c = s === 'active' ? D.green : s === 'on leave' ? D.amber : s.includes('inactive') ? D.red : D.muted
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10.5, fontFamily: 'var(--font-mono)', letterSpacing: '0.04em', color: c, textTransform: 'uppercase' }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: c, flexShrink: 0 }} />{status}
    </span>
  )
}

function ChangeValue({ v }: { v: string | null }) {
  const { colors: D } = useTheme()
  if (v == null) return <span style={{ color: D.sub, fontStyle: 'italic' }}>empty</span>
  return <span>{v}</span>
}

function PersonnelHistory() {
  const { colors: D } = useTheme()
  const [payload, setPayload] = useState<HistoryPayload | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [selectedId, setSelectedId] = useState<number | null>(null)

  useEffect(() => {
    let live = true
    fetch('/api/personnel-history')
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: HistoryPayload) => {
        if (!live) return
        setPayload(d)
        setState('ready')
      })
      .catch(() => { if (live) setState('error') })
    return () => { live = false }
  }, [])

  // roster sorted by most-recent change, so the first row is the freshest story
  const lastChangeAt = useCallback((empId: number) => {
    const evs = payload?.history.filter(h => h.employeeId === empId) ?? []
    return evs.length ? evs[0].changedAt : ''
  }, [payload])

  const roster = (payload?.employees ?? []).slice().sort((a, b) => {
    if (!!a.removed !== !!b.removed) return a.removed ? 1 : -1
    const la = lastChangeAt(a.id), lb = lastChangeAt(b.id)
    if (la && lb) return lb.localeCompare(la)
    if (la) return -1
    if (lb) return 1
    return a.name.localeCompare(b.name)
  })

  const activeId = selectedId ?? roster[0]?.id ?? null
  const selected = roster.find(e => e.id === activeId) ?? null
  const events = (payload?.history ?? []).filter(h => h.employeeId === activeId)

  return (
    <Card title="Personnel History" note="Audit trail for the HR staff roster — role, status, project & section changes. Separate from activity-report mentions above.">
      {state === 'loading' && (
        <div style={{ display: 'flex', gap: 12, minHeight: 200 }}>
          <Skel h={200} /><div style={{ flex: 1 }}><Skel h={200} /></div>
        </div>
      )}
      {state === 'error' && <EmptyState label="Couldn't load personnel history" />}
      {state === 'ready' && roster.length === 0 && <EmptyState label="No staff records found" />}
      {state === 'ready' && roster.length > 0 && (
        <div className="phist-layout" style={{ display: 'flex', gap: 16, alignItems: 'stretch' }}>
          {/* roster */}
          <div className="phist-roster" style={{ width: 260, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 420, overflowY: 'auto', paddingRight: 4 }}>
            {roster.map(e => {
              const isActive = e.id === activeId
              const n = (payload?.history.filter(h => h.employeeId === e.id).length) ?? 0
              return (
                <button key={e.id} onClick={() => setSelectedId(e.id)}
                  style={{
                    textAlign: 'left', font: 'inherit', cursor: 'pointer', borderRadius: 8,
                    padding: '9px 11px', display: 'flex', flexDirection: 'column', gap: 5,
                    background: isActive ? D.panel2 : 'transparent',
                    border: `1px solid ${isActive ? `${D.amber}44` : D.border}`,
                    borderLeft: `2px solid ${isActive ? D.amber : 'transparent'}`,
                    transition: `background 0.15s ${EASE}, border-color 0.15s ${EASE}`,
                  }}>
                  <span style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
                    <span style={{ fontSize: 12.5, fontWeight: 600, color: isActive ? D.text : D.muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.name}</span>
                    <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: n ? D.amber : D.sub, flexShrink: 0 }}>{n} {n === 1 ? 'change' : 'changes'}</span>
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    {e.removed
                      ? <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', letterSpacing: '0.04em', textTransform: 'uppercase', color: D.sub, border: `1px solid ${D.border}`, borderRadius: 5, padding: '0 5px' }}>removed from roster</span>
                      : <><span style={{ fontSize: 11, color: D.sub }}>{e.role}</span><StatusPill status={e.status} /></>}
                  </span>
                </button>
              )
            })}
          </div>

          {/* timeline */}
          <div className="phist-timeline" style={{ flex: 1, minWidth: 0, borderLeft: `1px solid ${D.border}`, paddingLeft: 16 }}>
            {selected && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: D.text }}>{selected.name}</div>
                <div style={{ fontSize: 11.5, color: D.muted, marginTop: 3, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  {selected.removed
                    ? <span style={{ color: D.sub }}>Removed from roster — history retained</span>
                    : <>
                        <span>{selected.role}</span>
                        {selected.projectName && <span>· {selected.projectName}</span>}
                        {selected.sectionName && <span>· {selected.sectionName}</span>}
                        {selected.dateAdded && <span>· added {selected.dateAdded}</span>}
                      </>}
                </div>
              </div>
            )}
            {events.length === 0 ? (
              <EmptyState label="No recorded changes for this employee" />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 0, maxHeight: 420, overflowY: 'auto' }}>
                {events.map((ev, i) => {
                  const dot = ev.kind === 'status' ? D.amber : D.muted
                  return (
                    <div key={i} style={{ display: 'flex', gap: 12, paddingBottom: i === events.length - 1 ? 0 : 14 }}>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0, paddingTop: 3 }}>
                        <span style={{ width: 9, height: 9, borderRadius: '50%', background: dot, border: `2px solid ${D.panel}`, boxShadow: `0 0 0 1px ${dot}55` }} />
                        {i !== events.length - 1 && <span style={{ flex: 1, width: 1, background: D.border, marginTop: 3 }} />}
                      </div>
                      <div style={{ flex: 1, minWidth: 0, paddingBottom: 2 }}>
                        <div style={{ fontSize: 12.5, color: D.text, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', color: D.muted, background: D.panel2, border: `1px solid ${D.border}`, borderRadius: 5, padding: '1px 6px' }}>{fieldLabel(ev.field)}</span>
                          <span style={{ color: D.muted }}><ChangeValue v={ev.oldValue} /></span>
                          <span style={{ color: D.sub }}>→</span>
                          <span style={{ fontWeight: 600 }}><ChangeValue v={ev.newValue} /></span>
                        </div>
                        <div style={{ fontSize: 11, color: D.sub, marginTop: 4, fontFamily: 'var(--font-mono)' }}>
                          by {ev.changedBy} · {fmtWhen(ev.changedAt)}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </Card>
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
      <div className="personnel-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14 }}>{[0, 1, 2, 3, 4, 5].map(i => <Skel key={i} h={240} />)}</div>
    </div>
  )
}

/* ── page ─────────────────────────────────────────────────── */
function PersonnelPageInner() {
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
      .catch(() => { if (reqId === requestIdRef.current) { setError('Failed to load personnel data'); setLoading(false) } })

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
    router.push(`/personnel?${p.toString()}`)
  }

  const totalMentions = (data?.employeeSummary?.totalMentions ?? 0) + (data?.engineerSummary?.totalMentions ?? 0) + (data?.supervisorSummary?.totalMentions ?? 0)
  const gridStyle: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14, alignItems: 'start' }
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
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600, letterSpacing: '-0.01em' }}>Personnel</h2>
          <p style={{ margin: 0, marginTop: 3, fontSize: 13, color: D.muted }}>Employees, engineers &amp; supervisors across activity reports.</p>
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
              <KPICard label="Total Employee" value={data.employeeSummary?.distinctEmployees ?? 0} icon={<IconPeople />} delay={0} color={VIVID[0]} />
              <KPICard label="Total Engineer" value={data.engineerSummary?.distinctEngineers ?? 0} icon={<IconHat />} delay={60} color={VIVID[1]} />
              <KPICard label="Total Supervisor" value={data.supervisorSummary?.distinctSupervisors ?? 0} icon={<IconShield />} delay={120} color={VIVID[2]} />
              <KPICard label="Total Mentions" value={totalMentions} icon={<IconUsers />} delay={180} color={VIVID[3]} />
            </div>

            <Reveal style={{ marginBottom: 14 }}>
              <div className="personnel-grid" style={gridStyle}>
                <Card title="Activities Reported by Employees" note={unattributedNote(data, 'byEmployee', 'No employee recorded')}>
                  {data.byEmployee?.length > 0 ? <HBarChart data={data.byEmployee} activeName={data.activeFilters.filterEmployee} onBarClick={name => handleFilter('employee', name)} /> : <EmptyState label="No employee data matches your filters" />}
                </Card>
                <Card title="Employees by Role" note={unattributedNote(data, 'byEmployeeRole', 'No role recorded')}>
                  {data.byEmployeeRole?.length > 0 ? <DonutChart data={data.byEmployeeRole} activeName={data.activeFilters.filterEmployeeRole} onSliceClick={name => handleFilter('employee_role', name)} /> : <EmptyState label="No role data matches your filters" />}
                </Card>
              </div>
            </Reveal>

            <Reveal delay={60} style={{ marginBottom: 14 }}>
              <div className="personnel-grid" style={gridStyle}>
                <Card title="Engineers Activity" note={unattributedNote(data, 'byEngineer', 'No engineer recorded')}>
                  {data.byEngineer?.length > 0 ? <HBarChart data={data.byEngineer} activeName={data.activeFilters.filterEngineer} onBarClick={name => handleFilter('engineer', name)} /> : <EmptyState label="No engineer data matches your filters" />}
                </Card>
                <Card title="Engineers by Party">
                  {data.byEngineerParty?.length > 0 ? <DonutChart data={data.byEngineerParty} activeName={data.activeFilters.filterEngineerParty} onSliceClick={name => handleFilter('engineer_party', name)} /> : <EmptyState label="No party data matches your filters" />}
                </Card>
              </div>
            </Reveal>

            <Reveal delay={120}>
              <div className="personnel-grid" style={gridStyle}>
                <Card title="Supervisors Activity" note={unattributedNote(data, 'bySupervisor', 'No supervisor recorded')}>
                  {data.bySupervisor?.length > 0 ? <HBarChart data={data.bySupervisor} activeName={data.activeFilters.filterSupervisor} onBarClick={name => handleFilter('supervisor', name)} /> : <EmptyState label="No supervisor data matches your filters" />}
                </Card>
                <Card title="Supervisors by Party">
                  {data.bySupervisorParty?.length > 0 ? <DonutChart data={data.bySupervisorParty} activeName={data.activeFilters.filterSupervisorParty} onSliceClick={name => handleFilter('supervisor_party', name)} /> : <EmptyState label="No party data matches your filters" />}
                </Card>
              </div>
            </Reveal>

            <Reveal delay={160} style={{ marginTop: 14 }}>
              <PersonnelHistory />
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
        .phist-roster::-webkit-scrollbar, .phist-timeline div::-webkit-scrollbar { width: 6px; }
        .phist-roster::-webkit-scrollbar-thumb, .phist-timeline div::-webkit-scrollbar-thumb { background:${D.border}; border-radius:3px; }
        @media (max-width: 760px) {
          .phist-layout { flex-direction: column !important; }
          .phist-roster { width: 100% !important; max-height: 260px !important; }
          .phist-timeline { border-left: none !important; padding-left: 0 !important; border-top: 1px solid ${D.border} !important; padding-top: 14px !important; }
        }
      `}</style>
    </div>
  )
}

export default function PersonnelPage() {
  const { colors: D } = useTheme()
  return (
    <Suspense fallback={<div style={{ minHeight: '100vh', background: D.bg, padding: '28px 36px' }}><PageSkeleton /></div>}>
      <PersonnelPageInner />
    </Suspense>
  )
}
