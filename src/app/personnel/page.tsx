'use client'

import { useEffect, useRef, useState, useCallback, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

/* ── Design tokens (subset ported from /dashboard) ─────────── */
const D = {
  bg:     '#0e0e10',
  panel:  '#141416',
  panel2: '#1a1a1e',
  border: 'rgba(255,255,255,0.06)',
  text:   '#e8e2d8',
  muted:  '#8c867e',
  sub:    '#3d3b42',
  amber:  '#d4a040',
  amberL: '#f0c060',
  red:    '#f87171',
  green:  '#34d399',
  blue:   '#60a5fa',
  purple: '#a78bfa',
}
const SH_CARD    = '0 4px 20px rgba(0,0,0,0.7), 0 1px 0 rgba(255,255,255,0.05)'
const SH_CARDLG  = '0 10px 36px rgba(0,0,0,0.82), 0 1px 0 rgba(255,255,255,0.06), 0 0 28px rgba(212,160,64,0.08)'
const SH_PANEL   = '0 4px 24px rgba(0,0,0,0.6), 0 1px 0 rgba(255,255,255,0.04), inset 0 1px 0 rgba(255,255,255,0.03)'
const SH_PANELLG = '0 10px 36px rgba(0,0,0,0.7), 0 1px 0 rgba(255,255,255,0.05), inset 0 1px 0 rgba(255,255,255,0.03), 0 0 32px rgba(212,160,64,0.05)'
const EASE        = 'cubic-bezier(0.16,1,0.3,1)'
const EASE_SPRING = 'cubic-bezier(0.34,1.56,0.64,1)'
const CAT_COLORS  = ['#d4a040','#60a5fa','#34d399','#a78bfa','#f87171','#f472b6','#e87040']

interface DashData {
  summary: { totalReports: number }
  byEmployee:   Array<{ name: string; count: number }>
  byEngineer:   Array<{ name: string; count: number }>
  bySupervisor: Array<{ name: string; count: number }>
  byEmployeeRole:    Array<{ name: string; count: number }>
  byEngineerParty:   Array<{ name: string; count: number }>
  bySupervisorParty: Array<{ name: string; count: number }>
  employeeSummary:   { totalMentions: number; distinctEmployees: number }
  engineerSummary:   { totalMentions: number; distinctEngineers: number }
  supervisorSummary: { totalMentions: number; distinctSupervisors: number }
  filterOptions: { categories: string[]; projects: string[] }
  activeFilters: {
    filterCategory: string; filterProject: string; filterDateFrom: string; filterDateTo: string; filterChFrom: string; filterChTo: string; filterSearch: string
    filterWeather: string; filterMachine: string; filterEmployee: string; filterEngineer: string; filterSupervisor: string
  }
}

/* ── Animated counter ───────────────────────────────────────── */
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

/* ── Reveal on scroll ───────────────────────────────────────── */
function Reveal({ children, delay = 0, style: st }: { children: React.ReactNode; delay?: number; style?: React.CSSProperties }) {
  const ref = useRef<HTMLDivElement>(null)
  const [vis, setVis] = useState(false)
  useEffect(() => {
    const el = ref.current; if (!el) return
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setVis(true); obs.disconnect() } }, { threshold: 0.05 })
    obs.observe(el); return () => obs.disconnect()
  }, [])
  return (
    <div ref={ref} style={{ opacity: vis ? 1 : 0, transform: vis ? 'translateY(0) scale(1)' : 'translateY(22px) scale(0.985)', transition: `opacity 0.7s ease ${delay}ms, transform 0.7s ${EASE} ${delay}ms`, willChange: vis ? 'auto' : 'opacity, transform', ...st }}>
      {children}
    </div>
  )
}

/* ── Panel ──────────────────────────────────────────────────── */
function Panel({ children, title, style: st }: { children: React.ReactNode; title: string; style?: React.CSSProperties }) {
  const [hov, setHov] = useState(false)
  return (
    <div onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{ background: D.panel, borderRadius: 16, padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: 18, border: hov ? '1px solid rgba(212,160,64,0.16)' : `1px solid ${D.border}`, boxShadow: hov ? SH_PANELLG : SH_PANEL, transform: hov ? 'translateY(-2px)' : 'translateY(0)', transition: `border-color 0.35s ${EASE}, box-shadow 0.35s ${EASE}, transform 0.35s ${EASE}`, ...st }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ position: 'relative', width: 7, height: 7, flexShrink: 0 }}>
          <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: D.amber, animation: 'pingAnim 3s ease-out infinite', opacity: 0.5 }} />
          <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: D.amber, boxShadow: `0 0 6px ${D.amber}` }} />
        </div>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.58rem', letterSpacing: '0.16em', textTransform: 'uppercase', color: hov ? D.text : D.muted, background: '#0e0e10', padding: '2px 10px', borderRadius: 4, border: `1px solid ${hov ? 'rgba(212,160,64,0.25)' : D.border}`, transition: `color 0.3s ${EASE}, border-color 0.3s ${EASE}` }}>{title}</span>
      </div>
      {children}
    </div>
  )
}

/* ── KPI Card ──────────────────────────────────────────────── */
function KPICard({ label, value, icon, delay = 0, color = D.amber }: { label: string; value: number; icon: React.ReactNode; delay?: number; color?: string }) {
  const [vis, setVis] = useState(false)
  const [hov, setHov] = useState(false)
  useEffect(() => { const t = setTimeout(() => setVis(true), delay + 80); return () => clearTimeout(t) }, [delay])
  const displayed = useCountUp(vis ? value : 0, 1200, 0)
  const entranceY = vis ? 0 : 14
  const hoverY    = hov ? -3 : 0
  return (
    <div onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{ background: hov ? D.panel2 : D.panel, borderRadius: 22, padding: '20px 22px', position: 'relative', overflow: 'hidden', opacity: vis ? 1 : 0, transform: `translateY(${entranceY + hoverY}px) scale(${vis ? 1 : 0.97})`, transition: `opacity 0.6s ease ${delay}ms, transform 0.45s ${EASE} ${vis ? '0ms' : `${delay}ms`}, border-color 0.3s, box-shadow 0.3s, background 0.3s`, border: hov ? `1px solid ${color}33` : `1px solid ${D.border}`, boxShadow: hov ? SH_CARDLG : SH_CARD }}>
      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 2, background: `linear-gradient(180deg, transparent, ${color}, transparent)`, opacity: hov ? 1 : 0.5, transition: 'opacity 0.3s' }} />
      <div style={{ position: 'absolute', top: -24, right: -24, width: 90, height: 90, borderRadius: '50%', background: `radial-gradient(circle, ${color}${hov ? '22' : '15'} 0%, transparent 70%)`, pointerEvents: 'none', transition: `background 0.3s ${EASE}` }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <div style={{ width: 44, height: 44, borderRadius: 14, background: `${color}20`, border: `1px solid ${color}35`, display: 'flex', alignItems: 'center', justifyContent: 'center', color, transform: hov ? 'scale(1.08)' : 'scale(1)', transition: `transform 0.3s ${EASE_SPRING}` }}>{icon}</div>
      </div>
      <div style={{ fontFamily: 'var(--font-loader)', fontSize: '2.5rem', fontWeight: 400, lineHeight: 1, letterSpacing: '0.03em', color, textShadow: hov ? `0 0 24px ${color}44` : 'none', transition: 'text-shadow 0.3s' }}>{displayed.toLocaleString()}</div>
      <div style={{ fontSize: '0.58rem', color: D.muted, fontFamily: 'var(--font-mono)', letterSpacing: '0.14em', textTransform: 'uppercase', marginTop: 8 }}>{label}</div>
    </div>
  )
}

/* ── Horizontal bar chart ───────────────────────────────────── */
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
            style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: onBarClick ? 'pointer' : 'default', opacity: hasActive ? (isActive ? 1 : 0.35) : (hov !== null && !isHov ? 0.35 : 1), transform: isHov || isActive ? 'translateX(2px)' : 'translateX(0)', transition: `opacity 0.2s, transform 0.25s ${EASE}` }}>
            <div style={{ width: 18, height: 18, borderRadius: 5, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: isTop ? `${color}18` : 'transparent', border: isTop ? `1px solid ${color}35` : `1px solid transparent`, fontSize: 9, fontFamily: 'var(--font-mono)', color: isTop ? color : D.sub, fontWeight: isTop ? 700 : 400 }}>{i+1}</div>
            <span style={{ width: 140, fontSize: '0.7rem', color: isHov || isActive ? D.text : D.muted, fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flexShrink: 0, transition: 'color 0.2s' }} title={d.name}>{d.name}</span>
            <div style={{ flex: 1, height: 5, background: 'rgba(255,255,255,0.04)', borderRadius: 6, overflow: 'hidden', position: 'relative' }}>
              <div style={{ position: 'absolute', inset: 0, right: 'auto', width: ready ? `${barPct}%` : '0%', background: isTop ? `linear-gradient(90deg, ${color}, ${color}bb)` : `linear-gradient(90deg, ${color}66, ${color}33)`, borderRadius: 6, transition: `width 0.9s ${EASE} ${i*0.04}s, box-shadow 0.2s`, boxShadow: (isTop && isHov) || isActive ? `0 0 8px ${color}55` : 'none' }} />
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

/* ── Donut chart ───────────────────────────────────────────── */
function DonutChart({ data }: { data: Array<{ name: string; count: number }> }) {
  const [ready, setReady] = useState(false)
  const [hov, setHov] = useState<number | null>(null)
  useEffect(() => { const t = setTimeout(() => setReady(true), 200); return () => clearTimeout(t) }, [])
  const total = data.reduce((s, d) => s + d.count, 0)
  if (!total) return null
  const r = 66, sw = 22, gap = 2, circ = 2 * Math.PI * r
  let cumLen = 0
  const segments = data.map((d, i) => {
    const len = (d.count / total) * (circ - data.length * gap)
    const s = { ...d, offset: cumLen, len, color: CAT_COLORS[i % CAT_COLORS.length] }
    cumLen += len + gap
    return s
  })
  const hovSeg = hov !== null ? segments[hov] : null
  return (
    <div style={{ display: 'flex', gap: 22, alignItems: 'center', flexWrap: 'wrap' }}>
      <svg width={160} height={160} viewBox="-80 -80 160 160" style={{ flexShrink: 0 }} onMouseLeave={() => setHov(null)}>
        <circle r={r} fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth={sw} />
        {segments.map((seg, i) => {
          const isHov = hov === i
          return <circle key={i} r={r} fill="none" stroke={seg.color} strokeWidth={isHov ? sw + 5 : sw}
            strokeDasharray={`${ready ? seg.len : 0} ${circ}`} strokeDashoffset={-(seg.offset)} strokeLinecap="butt"
            strokeOpacity={hov !== null && !isHov ? 0.25 : 1}
            style={{ transition: `stroke-dasharray 0.85s ${EASE} ${i * 0.07}s, stroke-width 0.25s ${EASE_SPRING}, stroke-opacity 0.2s`, filter: isHov ? `drop-shadow(0 0 6px ${seg.color}88)` : 'none' }}
            onMouseEnter={() => setHov(i)} />
        })}
        {hovSeg ? (<>
          <text x="0" y="-8" textAnchor="middle" fill={hovSeg.color} fontFamily="var(--font-loader)" fontSize="20">{hovSeg.count}</text>
          <text x="0" y="10" textAnchor="middle" fill={D.muted} fontFamily="var(--font-mono)" fontSize="7">{hovSeg.name.length > 13 ? hovSeg.name.slice(0,12)+'…' : hovSeg.name}</text>
        </>) : (<>
          <text x="0" y="-4" textAnchor="middle" fill={D.text} fontFamily="var(--font-loader)" fontSize="24">{total}</text>
          <text x="0" y="14" textAnchor="middle" fill={D.muted} fontFamily="var(--font-mono)" fontSize="7" letterSpacing="2">TOTAL</text>
        </>)}
      </svg>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7, flex: 1, minWidth: 120 }}>
        {segments.map((seg, i) => {
          const isHov = hov === i
          return (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, opacity: hov !== null && !isHov ? 0.4 : 1, transform: isHov ? 'translateX(3px)' : 'translateX(0)', transition: `opacity 0.2s, transform 0.25s ${EASE}` }}
              onMouseEnter={() => setHov(i)} onMouseLeave={() => setHov(null)}>
              <div style={{ width: 8, height: 8, borderRadius: 2, background: seg.color, flexShrink: 0, transform: isHov ? 'scale(1.4)' : 'scale(1)', boxShadow: isHov ? `0 0 8px ${seg.color}` : 'none', transition: `transform 0.3s ${EASE_SPRING}, box-shadow 0.2s` }} />
              <span style={{ fontSize: '0.7rem', color: isHov ? D.text : D.muted, flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontFamily: 'var(--font-mono)', transition: 'color 0.2s' }}>{seg.name}</span>
              <span style={{ fontSize: '0.7rem', color: D.text, fontWeight: 600, fontFamily: 'var(--font-mono)', flexShrink: 0 }}>{seg.count}</span>
              <span style={{ fontSize: '0.62rem', color: D.sub, fontFamily: 'var(--font-mono)', flexShrink: 0 }}>{Math.round(seg.count / total * 100)}%</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* ── Empty state ────────────────────────────────────────────── */
function EmptyState({ label }: { label: string }) {
  return (
    <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:10, padding:'32px 0', animation:`fadeIn 0.4s ${EASE}` }}>
      <div style={{ width:34, height:34, borderRadius:9, background:'rgba(255,255,255,0.03)', border:`1px solid ${D.border}`, display:'flex', alignItems:'center', justifyContent:'center', color:D.sub }}>
        <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"/><line x1="9" y1="9" x2="15" y2="15"/><line x1="15" y1="9" x2="9" y2="15"/></svg>
      </div>
      <div style={{ color:D.sub, fontSize:'0.78rem', fontFamily:'var(--font-mono)', textAlign:'center' }}>{label}</div>
    </div>
  )
}

/* ── Icons ──────────────────────────────────────────────────── */
const IconPeople = () => <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
const IconHat    = () => <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M3 18a9 9 0 0 1 18 0"/><rect x="2" y="18" width="20" height="3" rx="1"/><line x1="12" y1="8" x2="12" y2="4"/><circle cx="12" cy="3" r="1"/></svg>
const IconShield = () => <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5z"/></svg>
const IconUsers  = () => <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>

/* ── Filter bar (ported as-is from /dashboard — generic, keyed by onFilter) ── */
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
          {search && <button className="btn-close-x-plain" onClick={() => setSearch('')} aria-label="Clear search"
            style={{ position:'absolute', right:8, top:'50%', transform:'translateY(-50%)', background:'none', border:'none', color:D.sub, cursor:'pointer', fontSize:13, lineHeight:1, padding:0, transition:`color 0.2s ${EASE}` }}>✕</button>}
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

      {hasFilters && <button className="btn-ghost" onClick={() => { setChFrom(''); setChTo(''); setSearch(''); onFilter('__clear__','') }}
        style={{ background:'transparent', color:D.amber, border:`1px solid rgba(212,160,64,0.3)`, borderRadius:8, padding:'7px 18px', fontSize:12, cursor:'pointer', fontFamily:'var(--font-mono)', letterSpacing:1, alignSelf:'flex-end', transition:'all 0.2s' }}>✕ Clear</button>}

      {hasFilters && <div style={{ alignSelf:'flex-end', fontSize:11, color:D.text, fontFamily:'var(--font-mono)', display:'flex', alignItems:'center', gap:7, background:'rgba(212,160,64,0.07)', border:'1px solid rgba(212,160,64,0.2)', borderRadius:8, padding:'6px 12px', animation:'fadeIn 0.25s ease' }}>
        <span style={{ width:5, height:5, borderRadius:'50%', background:D.amber, boxShadow:`0 0 6px ${D.amber}`, flexShrink:0 }}/>
        <span style={{ color:D.muted }}>Filtered</span> <span style={{ color:D.amberL, fontWeight:700 }}>{data.summary.totalReports.toLocaleString()}</span> <span style={{ color:D.muted }}>reports</span>
      </div>}
    </div>
  )
}

/* ── Skeleton ───────────────────────────────────────────────── */
function Skel({ h }: { h: number }) {
  return (
    <div style={{ height:h, borderRadius:16, background:D.panel, position:'relative', overflow:'hidden', border:`1px solid ${D.border}` }}>
      <div style={{ position:'absolute', inset:0, background:'linear-gradient(90deg, transparent 0%, rgba(212,160,64,0.04) 50%, transparent 100%)', animation:'shimmer 2s ease-in-out infinite' }} />
    </div>
  )
}
function PageSkeleton() {
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
      <div className="kpi-grid" style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:14 }}>{[0,1,2,3].map(i=><Skel key={i} h={108}/>)}</div>
      <div className="personnel-grid" style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(320px, 1fr))', gap:14 }}>{[0,1,2,3,4,5].map(i=><Skel key={i} h={260}/>)}</div>
    </div>
  )
}

/* ── Main page ──────────────────────────────────────────────── */
function PersonnelPageInner() {
  const router       = useRouter()
  const searchParams = useSearchParams()
  const [data, setData]       = useState<DashData | null>(null)
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
      .catch(() => { if (reqId === requestIdRef.current) { setError('Failed to load personnel data'); setLoading(false) } })
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
    router.push(`/personnel?${p.toString()}`)
  }

  const totalMentions = (data?.employeeSummary?.totalMentions ?? 0) + (data?.engineerSummary?.totalMentions ?? 0) + (data?.supervisorSummary?.totalMentions ?? 0)

  return (
    <div style={{ minHeight:'100vh', background:D.bg, color:D.text, fontFamily:'var(--font-dm-sans)' }}>
      <div style={{ padding:'28px 32px 80px', maxWidth:1480, margin:'0 auto' }}>
        <div style={{ marginBottom:20 }}>
          <div style={{ fontFamily:'var(--font-loader)', fontSize:'1.4rem', letterSpacing:'0.08em', color:D.amber }}>PERSONNEL OVERVIEW</div>
          <div style={{ fontFamily:'var(--font-mono)', fontSize:'0.65rem', color:D.muted, letterSpacing:'0.08em', marginTop:4 }}>Employees, engineers &amp; supervisors across activity reports</div>
        </div>

        {error && <div style={{ background:'rgba(248,113,113,0.06)', border:'1px solid rgba(248,113,113,0.2)', borderRadius:12, padding:'14px 18px', color:D.red, fontFamily:'var(--font-mono)', fontSize:'0.78rem', marginBottom:20 }}>{error}</div>}

        {data && <FilterBar data={data} onFilter={handleFilter} />}
        {loading && !data && <PageSkeleton/>}

        {data && (
          <div style={{ opacity: loading ? 0.55 : 1, filter: loading ? 'blur(1.5px) saturate(0.85)' : 'blur(0) saturate(1)', transform: loading ? 'scale(0.997)' : 'scale(1)', pointerEvents: loading ? 'none' : 'auto', transition: `opacity 0.35s ${EASE}, filter 0.35s ${EASE}, transform 0.35s ${EASE}` }}>

            <div className="kpi-grid" style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:14, marginBottom:20 }}>
              <KPICard label="Employees Logged"   value={data.employeeSummary?.distinctEmployees ?? 0}     icon={<IconPeople/>} delay={0}   color={D.green} />
              <KPICard label="Engineers Logged"   value={data.engineerSummary?.distinctEngineers ?? 0}     icon={<IconHat/>}    delay={80}  color={D.blue} />
              <KPICard label="Supervisors Logged" value={data.supervisorSummary?.distinctSupervisors ?? 0} icon={<IconShield/>} delay={160} color={D.purple} />
              <KPICard label="Total Mentions"     value={totalMentions}                                    icon={<IconUsers/>}  delay={240} color={D.amber} />
            </div>

            <Reveal style={{ marginBottom:16 }}>
              <div className="personnel-grid" style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(320px, 1fr))', gap:14 }}>
                <Panel title="Top Employees">
                  {data.byEmployee?.length > 0
                    ? <HBarChart data={data.byEmployee} color={D.green} activeName={data.activeFilters.filterEmployee} onBarClick={name => handleFilter('employee', name)}/>
                    : <EmptyState label="No employee data matches your filters"/>}
                </Panel>
                <Panel title="Employees by Role">
                  {data.byEmployeeRole?.length > 0
                    ? <DonutChart data={data.byEmployeeRole}/>
                    : <EmptyState label="No role data matches your filters"/>}
                </Panel>
                <Panel title="Engineers Activity">
                  {data.byEngineer?.length > 0
                    ? <HBarChart data={data.byEngineer} color={D.blue} activeName={data.activeFilters.filterEngineer} onBarClick={name => handleFilter('engineer', name)}/>
                    : <EmptyState label="No engineer data matches your filters"/>}
                </Panel>
                <Panel title="Engineers by Party">
                  {data.byEngineerParty?.length > 0
                    ? <DonutChart data={data.byEngineerParty}/>
                    : <EmptyState label="No party data matches your filters"/>}
                </Panel>
                <Panel title="Supervisors Activity">
                  {data.bySupervisor?.length > 0
                    ? <HBarChart data={data.bySupervisor} color={D.purple} activeName={data.activeFilters.filterSupervisor} onBarClick={name => handleFilter('supervisor', name)}/>
                    : <EmptyState label="No supervisor data matches your filters"/>}
                </Panel>
                <Panel title="Supervisors by Party">
                  {data.bySupervisorParty?.length > 0
                    ? <DonutChart data={data.bySupervisorParty}/>
                    : <EmptyState label="No party data matches your filters"/>}
                </Panel>
              </div>
            </Reveal>
          </div>
        )}
      </div>

      <style>{`
        @keyframes fadeIn    { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:translateY(0); } }
        @keyframes shimmer   { 0% { transform:translateX(-100%); } 100% { transform:translateX(600%); } }
        @keyframes pingAnim  { 0% { transform:scale(1); opacity:0.5; } 75%,100% { transform:scale(2.8); opacity:0; } }
        select:focus, input:focus { outline:none; border-color:rgba(212,160,64,0.4) !important; box-shadow:0 0 0 2px rgba(212,160,64,0.1) !important; }
        select option { background:#0e0e10; }
        input[type='date']::-webkit-calendar-picker-indicator { filter:invert(0.5) sepia(0.3); cursor:pointer; }
        input[type='number']::-webkit-inner-spin-button, input[type='number']::-webkit-outer-spin-button { opacity:0.3; }
        .btn-ghost { transition: background 0.2s ${EASE}, border-color 0.2s ${EASE}, color 0.2s ${EASE}, transform 0.2s ${EASE} !important; }
        .btn-ghost:not(:disabled):hover { background:rgba(212,160,64,0.1) !important; border-color:rgba(212,160,64,0.55) !important; color:${D.amberL} !important; transform:translateY(-1px); }
        .btn-ghost:not(:disabled):active { transform:translateY(0) scale(0.97); }
        .btn-close-x-plain:hover { color:${D.amberL} !important; }
        @media (max-width: 1180px) { .kpi-grid { grid-template-columns: repeat(2,1fr) !important; } }
        @media (max-width: 480px)  { .kpi-grid { grid-template-columns: repeat(1,1fr) !important; } }
      `}</style>
    </div>
  )
}

export default function PersonnelPage() {
  return (
    <Suspense fallback={<div style={{ minHeight:'100vh', background:'#0e0e10', padding:'28px 32px 60px' }}><PageSkeleton/></div>}>
      <PersonnelPageInner/>
    </Suspense>
  )
}
