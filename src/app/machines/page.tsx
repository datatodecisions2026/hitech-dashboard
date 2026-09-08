'use client'

import { useEffect, useRef, useState, useCallback, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useTheme } from '@/lib/theme'

const EASE = 'cubic-bezier(0.16,1,0.3,1)'

interface DashData {
  summary: { totalReports: number }
  byMachine:   Array<{ name: string; count: number }>
  byOwnership: Array<{ name: string; count: number }>
  byDriver:    Array<{ name: string; count: number }>
  machineSummary: { totalMentions: number; distinctMachines: number; distinctDrivers: number }
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

function Card({ children, title }: { children: React.ReactNode; title: string }) {
  const { colors: D, shadows: SH } = useTheme()
  return (
    <div style={{ background: D.panel, border: `1px solid ${D.border}`, borderRadius: 10, boxShadow: SH.card, display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '14px 16px 8px' }}>
        <h3 style={{ margin: 0, fontSize: 13.5, fontWeight: 600, letterSpacing: '-0.01em', color: D.text }}>{title}</h3>
      </div>
      <div style={{ padding: '4px 16px 16px' }}>{children}</div>
    </div>
  )
}

function KPICard({ label, value, icon, delay = 0, color }: { label: string; value: number; icon: React.ReactNode; delay?: number; color?: string }) {
  const { colors: D, shadows: SH } = useTheme()
  const [vis, setVis] = useState(false)
  useEffect(() => { const t = setTimeout(() => setVis(true), delay + 80); return () => clearTimeout(t) }, [delay])
  const displayed = useCountUp(vis ? value : 0, 1200, 0)
  return (
    <div style={{ background: D.panel, border: `1px solid ${D.border}`, borderRadius: 10, boxShadow: SH.card, padding: '14px 16px', opacity: vis ? 1 : 0, transform: vis ? 'translateY(0)' : 'translateY(10px)', transition: `opacity 0.5s ease ${delay}ms, transform 0.5s ${EASE} ${delay}ms` }}>
      <div style={{ width: 26, height: 26, borderRadius: 7, background: D.panel2, border: `1px solid ${D.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: D.muted, marginBottom: 10 }}>{icon}</div>
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

/* ── donut (single-hue ramp) ──────────────────────────────── */
function DonutChart({ data, activeName, onSliceClick }: { data: Array<{ name: string; count: number }>; activeName?: string; onSliceClick?: (name: string) => void }) {
  const { colors: D } = useTheme()
  const [ready, setReady] = useState(false)
  const [hov, setHov] = useState<number | null>(null)
  useEffect(() => { const t = setTimeout(() => setReady(true), 180); return () => clearTimeout(t) }, [])
  const RAMP = [D.amber, `${D.amber}c8`, `${D.amber}96`, `${D.amber}64`, D.muted, `${D.muted}b0`, `${D.muted}80`]
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

const IconTruck = () => <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="6" width="14" height="11" /><path d="M15 9h4l3 3v5h-7z" /><circle cx="6" cy="19" r="2" /><circle cx="17.5" cy="19" r="2" /></svg>
const IconLayers = () => <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2" /><polyline points="2 17 12 22 22 17" /><polyline points="2 12 12 17 22 12" /></svg>
const IconUser = () => <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
const IconTag = () => <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M20.59 13.41 11 3.83A2 2 0 0 0 9.61 3H4a1 1 0 0 0-1 1v5.61a2 2 0 0 0 .59 1.42l9.58 9.58a2 2 0 0 0 2.82 0l4.6-4.6a2 2 0 0 0 0-2.6z" /><circle cx="7.5" cy="7.5" r="1.2" /></svg>

/* ── filter bar ───────────────────────────────────────────── */
function FilterBar({ data, onFilter }: { data: DashData; onFilter: (key: string, val: string) => void }) {
  const { colors: D } = useTheme()
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
        { l: 'Date From', el: <input type="date" value={active.filterDateFrom || ''} onChange={e => onFilter('date_from', e.target.value)} style={inp} /> },
        { l: 'Date To', el: <input type="date" value={active.filterDateTo || ''} onChange={e => onFilter('date_to', e.target.value)} style={inp} /> },
        { l: 'Chainage From', el: <input type="number" placeholder="20000" value={chFrom} onChange={e => setChFrom(e.target.value)} onBlur={applyChFilter} onKeyDown={e => { if (e.key === 'Enter') applyChFilter() }} style={{ ...inp, minWidth: 110 }} /> },
        { l: 'Chainage To', el: <input type="number" placeholder="30000" value={chTo} onChange={e => setChTo(e.target.value)} onBlur={applyChFilter} onKeyDown={e => { if (e.key === 'Enter') applyChFilter() }} style={{ ...inp, minWidth: 110 }} /> },
      ].map(({ l, el }) => <div key={l} style={{ display: 'flex', flexDirection: 'column' }}><span style={lbl}>{l}</span>{el}</div>)}

      {hasFilters && <button onClick={() => { setChFrom(''); setChTo(''); setSearch(''); onFilter('__clear__', '') }}
        style={{ ...field, color: D.amber, background: 'transparent', border: `1px solid ${D.amber}55`, cursor: 'pointer', fontFamily: 'var(--font-mono)', alignSelf: 'flex-end' }}>✕ Clear</button>}
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
  const requestIdRef = useRef(0)

  const loadData = useCallback(() => {
    const reqId = ++requestIdRef.current
    setLoading(true)
    const qs = searchParams.toString()
    fetch(`/api/dashboard${qs ? `?${qs}` : ''}`)
      .then(r => { if (r.status === 401) { router.replace('/login'); return null } return r.json() })
      .then(d => { if (d && reqId === requestIdRef.current) { setData(d); setLoading(false) } })
      .catch(() => { if (reqId === requestIdRef.current) { setError('Failed to load machines data'); setLoading(false) } })
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

  return (
    <div style={{ minHeight: '100%', background: D.bg, color: D.text }}>
      <div style={{ padding: '24px', maxWidth: 1240, margin: '0 auto' }}>
        <div style={{ marginBottom: 18 }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600, letterSpacing: '-0.01em' }}>Machines</h2>
          <p style={{ margin: 0, marginTop: 3, fontSize: 13, color: D.muted }}>Equipment usage across activity reports.</p>
        </div>

        {error && <div style={{ background: `${D.red}12`, border: `1px solid ${D.red}3a`, borderRadius: 10, padding: '12px 16px', color: D.red, fontFamily: 'var(--font-mono)', fontSize: 13, marginBottom: 20 }}>{error}</div>}

        {data && <FilterBar data={data} onFilter={handleFilter} />}
        {loading && !data && <PageSkeleton />}

        {data && (
          <div style={{ opacity: loading ? 0.6 : 1, pointerEvents: loading ? 'none' : 'auto', transition: `opacity 0.25s ${EASE}` }}>
            <div className="kpi-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 14, marginBottom: 16 }}>
              <KPICard label="Machine Mentions" value={data.machineSummary?.totalMentions ?? 0} icon={<IconTruck />} delay={0} color={D.amber} />
              <KPICard label="Distinct Machines" value={data.machineSummary?.distinctMachines ?? 0} icon={<IconLayers />} delay={60} />
              <KPICard label="Distinct Drivers" value={data.machineSummary?.distinctDrivers ?? 0} icon={<IconUser />} delay={120} />
              <KPICard label="Ownership Types" value={data.byOwnership?.length ?? 0} icon={<IconTag />} delay={180} />
            </div>

            <Reveal>
              <div className="mach-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14 }}>
                <Card title="Machines Used">
                  {data.byMachine?.length > 0
                    ? <HBarChart data={data.byMachine} activeName={data.activeFilters.filterMachine} onBarClick={name => handleFilter('machine', name)} />
                    : <EmptyState label="No machine data matches your filters" />}
                </Card>
                <Card title="Ownership Breakdown">
                  {data.byOwnership?.length > 0
                    ? <DonutChart data={data.byOwnership} activeName={data.activeFilters.filterOwnership} onSliceClick={name => handleFilter('ownership', name)} />
                    : <EmptyState label="No ownership data matches your filters" />}
                </Card>
                <Card title="Top Drivers">
                  {data.byDriver?.length > 0
                    ? <HBarChart data={data.byDriver} activeName={data.activeFilters.filterDriver} onBarClick={name => handleFilter('driver', name)} />
                    : <EmptyState label="No driver data matches your filters" />}
                </Card>
              </div>
            </Reveal>
          </div>
        )}
      </div>

      <style>{`
        @keyframes shimmer { 0% { transform:translateX(-100%); } 100% { transform:translateX(400%); } }
        select:focus, input:focus { border-color:${D.amber} !important; box-shadow:0 0 0 3px ${D.amber}22 !important; }
        select option { background:${D.panel}; color:${D.text}; }
        input[type='date']::-webkit-calendar-picker-indicator { cursor:pointer; opacity:0.6; }
        input[type='number']::-webkit-inner-spin-button, input[type='number']::-webkit-outer-spin-button { opacity:0.3; }
        @media (max-width: 1024px) { .kpi-grid { grid-template-columns: repeat(2,1fr) !important; } }
        @media (max-width: 640px)  { .kpi-grid { grid-template-columns: repeat(1,1fr) !important; } }
      `}</style>
    </div>
  )
}

export default function MachinesPage() {
  const { colors: D } = useTheme()
  return (
    <Suspense fallback={<div style={{ minHeight: '100vh', background: D.bg, padding: '24px' }}><div style={{ maxWidth: 1240, margin: '0 auto' }}><PageSkeleton /></div></div>}>
      <MachinesPageInner />
    </Suspense>
  )
}
