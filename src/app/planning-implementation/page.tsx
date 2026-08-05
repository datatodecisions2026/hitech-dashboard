'use client'

import { useEffect, useRef, useState, useCallback, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import dynamic from 'next/dynamic'
import { useTheme } from '@/lib/theme'

const RoadAssetsMap = dynamic(() => import('@/components/RoadAssetsMap'), { ssr: false })

const EASE        = 'cubic-bezier(0.16,1,0.3,1)'
const EASE_SPRING = 'cubic-bezier(0.34,1.56,0.64,1)'

// Canonical project list for this page's filter bar. `label` is what's sent
// as `project` to /api/planning-implementation (RPC-side matching is
// case-insensitive there). `assetsName` is the exact literal string
// road_assets.project actually holds — confirmed live it does NOT match
// `label`'s casing ("Coastal road" vs "Coastal Road"), and /api/road-assets
// matches project by strict equality, so RoadAssetsMap needs the exact
// string, not a normalized one. Add a project here when onboarding a new
// one — same config-edit convention as PROJECT_ID_MAP/ROAD_DESIGN_LAYERS.
const PROJECTS = [
  { key: 'coastal-road', label: 'Coastal Road', assetsName: 'Coastal road' },
  { key: 'kebbi-sokoto', label: 'Kebbi - Sokoto Project', assetsName: 'Kebbi - Sokoto project' },
]

interface SectionRow {
  section: string
  total: number
  planned: number
  implemented: number
}

interface RoadAssetSectionRow {
  project: string
  section: string
  total: number
  geolocated: number
  implemented: number
  matchedKeyword: string | null
}

interface PlanningData {
  project: string
  sections: SectionRow[]
  summary: {
    total: number
    planned: number
    implemented: number
    sectionCount: number
    plannedPct: number
    implementedPct: number
  }
  roadAssets: {
    summary: {
      total_estimate: number
      geolocated_estimate: number
      project_count: number
      section_count: number
      entity_type_count: number
      refreshed_at: string
    } | null
    projects: Array<{ project: string; point_count: number; geolocated_point_count: number }>
    sections: RoadAssetSectionRow[]
    entityTypes: Array<{ entity_type: string; point_count: number }>
    total: number
    geolocated: number
    implemented: number
  }
  combined: {
    total: number
    planned: number
    implemented: number
    implementedPct: number
    totalBreakdown: { activities: number; roadAssets: number }
    implementedBreakdown: { activities: number; roadAssets: number }
  }
}

interface LoadStats { queryMs: number; clientMs: number; count: number; mode: 'live' | 'mv' }

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
  const { colors: D, shadows: SH } = useTheme()
  const [hov, setHov] = useState(false)
  return (
    <div onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{ background: D.panel, borderRadius: 16, padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: 18, border: hov ? '1px solid rgba(212,160,64,0.16)' : `1px solid ${D.border}`, boxShadow: hov ? SH.panelLg : SH.panel, transform: hov ? 'translateY(-2px)' : 'translateY(0)', transition: `border-color 0.35s ${EASE}, box-shadow 0.35s ${EASE}, transform 0.35s ${EASE}`, ...st }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ position: 'relative', width: 7, height: 7, flexShrink: 0 }}>
          <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: D.amber, animation: 'pingAnim 3s ease-out infinite', opacity: 0.5 }} />
          <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: D.amber, boxShadow: `0 0 6px ${D.amber}` }} />
        </div>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.58rem', letterSpacing: '0.16em', textTransform: 'uppercase', color: hov ? D.text : D.muted, background: D.bg, padding: '2px 10px', borderRadius: 4, border: `1px solid ${hov ? 'rgba(212,160,64,0.25)' : D.border}`, transition: `color 0.3s ${EASE}, border-color 0.3s ${EASE}` }}>{title}</span>
      </div>
      {children}
    </div>
  )
}

/* ── KPI Card ──────────────────────────────────────────────── */
function KPICard({ label, value, suffix, sub, icon, delay = 0, color: colorProp }: { label: string; value: number; suffix?: string; sub?: string; icon: React.ReactNode; delay?: number; color?: string }) {
  const { colors: D, shadows: SH } = useTheme()
  const color = colorProp ?? D.amber
  const [vis, setVis] = useState(false)
  const [hov, setHov] = useState(false)
  useEffect(() => { const t = setTimeout(() => setVis(true), delay + 80); return () => clearTimeout(t) }, [delay])
  const displayed = useCountUp(vis ? value : 0, 1200, 0)
  const entranceY = vis ? 0 : 14
  const hoverY    = hov ? -3 : 0
  return (
    <div onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{ background: hov ? D.panel2 : D.panel, borderRadius: 22, padding: '20px 22px', position: 'relative', overflow: 'hidden', opacity: vis ? 1 : 0, transform: `translateY(${entranceY + hoverY}px) scale(${vis ? 1 : 0.97})`, transition: `opacity 0.6s ease ${delay}ms, transform 0.45s ${EASE} ${vis ? '0ms' : `${delay}ms`}, border-color 0.3s, box-shadow 0.3s, background 0.3s`, border: hov ? `1px solid ${color}33` : `1px solid ${D.border}`, boxShadow: hov ? SH.cardLg : SH.card }}>
      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 2, background: `linear-gradient(180deg, transparent, ${color}, transparent)`, opacity: hov ? 1 : 0.5, transition: 'opacity 0.3s' }} />
      <div style={{ position: 'absolute', top: -24, right: -24, width: 90, height: 90, borderRadius: '50%', background: `radial-gradient(circle, ${color}${hov ? '22' : '15'} 0%, transparent 70%)`, pointerEvents: 'none', transition: `background 0.3s ${EASE}` }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <div style={{ width: 44, height: 44, borderRadius: 14, background: `${color}20`, border: `1px solid ${color}35`, display: 'flex', alignItems: 'center', justifyContent: 'center', color, transform: hov ? 'scale(1.08)' : 'scale(1)', transition: `transform 0.3s ${EASE_SPRING}` }}>{icon}</div>
      </div>
      <div style={{ fontFamily: 'var(--font-loader)', fontSize: '2.5rem', fontWeight: 400, lineHeight: 1, letterSpacing: '0.03em', color, textShadow: hov ? `0 0 24px ${color}44` : 'none', transition: 'text-shadow 0.3s' }}>{displayed.toLocaleString()}{suffix ?? ''}</div>
      <div style={{ fontSize: '0.58rem', color: D.muted, fontFamily: 'var(--font-mono)', letterSpacing: '0.14em', textTransform: 'uppercase', marginTop: 8 }}>{label}</div>
      {sub && <div style={{ fontSize: '0.6rem', color: D.sub, fontFamily: 'var(--font-mono)', marginTop: 4 }}>{sub}</div>}
    </div>
  )
}

/* ── Horizontal bar chart (single series) ──────────────────── */
function HBarChart({ data, color: colorProp }: { data: Array<{ name: string; count: number }>; color?: string }) {
  const { colors: D } = useTheme()
  const color = colorProp ?? D.amber
  const [ready, setReady] = useState(false)
  const [hov, setHov]     = useState<number | null>(null)
  useEffect(() => { const t = setTimeout(() => setReady(true), 300); return () => clearTimeout(t) }, [])
  const max   = Math.max(...data.map(d => d.count), 1)
  const total = data.reduce((s, d) => s + d.count, 0)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7, width: '100%' }}>
      {data.map((d, i) => {
        const pct    = total > 0 ? Math.round((d.count / total) * 100) : 0
        const barPct = (d.count / max) * 100
        const isHov  = hov === i
        const isTop  = i < 3
        return (
          <div key={d.name} onMouseEnter={() => setHov(i)} onMouseLeave={() => setHov(null)}
            style={{ display: 'flex', alignItems: 'center', gap: 10, opacity: hov !== null && !isHov ? 0.35 : 1, transform: isHov ? 'translateX(2px)' : 'translateX(0)', transition: `opacity 0.2s, transform 0.25s ${EASE}` }}>
            <div style={{ width: 18, height: 18, borderRadius: 5, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: isTop ? `${color}18` : 'transparent', border: isTop ? `1px solid ${color}35` : `1px solid transparent`, fontSize: 9, fontFamily: 'var(--font-mono)', color: isTop ? color : D.sub, fontWeight: isTop ? 700 : 400 }}>{i+1}</div>
            <span style={{ width: 150, fontSize: '0.7rem', color: isHov ? D.text : D.muted, fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flexShrink: 0, transition: 'color 0.2s' }} title={d.name}>{d.name}</span>
            <div style={{ flex: 1, height: 5, background: 'rgba(255,255,255,0.04)', borderRadius: 6, overflow: 'hidden', position: 'relative' }}>
              <div style={{ position: 'absolute', inset: 0, right: 'auto', width: ready ? `${barPct}%` : '0%', background: isTop ? `linear-gradient(90deg, ${color}, ${color}bb)` : `linear-gradient(90deg, ${color}66, ${color}33)`, borderRadius: 6, transition: `width 0.9s ${EASE} ${i*0.04}s, box-shadow 0.2s`, boxShadow: isTop && isHov ? `0 0 8px ${color}55` : 'none' }} />
            </div>
            <span style={{ width: 70, textAlign: 'right', fontSize: '0.7rem', color: isHov ? color : D.text, fontWeight: 700, fontFamily: 'var(--font-mono)', flexShrink: 0 }}>{d.count.toLocaleString()}</span>
            <span style={{ width: 30, textAlign: 'right', fontSize: '0.62rem', color: D.sub, fontFamily: 'var(--font-mono)', flexShrink: 0 }}>{pct}%</span>
          </div>
        )
      })}
    </div>
  )
}

/* ── Funnel bar — Total (track) → Planned (mid layer) → Implemented (top layer) ── */
function FunnelBar({ total, planned, implemented }: { total: number; planned: number; implemented: number }) {
  const { colors: D } = useTheme()
  const [ready, setReady] = useState(false)
  useEffect(() => { const t = setTimeout(() => setReady(true), 250); return () => clearTimeout(t) }, [])
  const plannedPct     = total > 0 ? (planned / total) * 100 : 0
  const implementedPct = total > 0 ? (implemented / total) * 100 : 0
  return (
    <div style={{ position: 'relative', height: 9, borderRadius: 5, background: 'rgba(255,255,255,0.05)', overflow: 'hidden', minWidth: 90 }}>
      <div style={{ position: 'absolute', inset: 0, width: ready ? `${plannedPct}%` : '0%', background: `${D.blue}55`, borderRadius: 5, transition: `width 0.8s ${EASE}` }} />
      <div style={{ position: 'absolute', inset: 0, width: ready ? `${implementedPct}%` : '0%', background: D.green, borderRadius: 5, boxShadow: `0 0 6px ${D.green}55`, transition: `width 0.8s ${EASE} 0.1s` }} />
    </div>
  )
}

/* ── Empty state ────────────────────────────────────────────── */
function EmptyState({ label }: { label: string }) {
  const { colors: D } = useTheme()
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
const IconLayers   = () => <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>
const IconClipboard = () => <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/></svg>
const IconCheck     = () => <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
const IconMap       = () => <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/></svg>
const IconClock     = () => <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 16 14"/></svg>

/* ── Skeleton ───────────────────────────────────────────────── */
function Skel({ h }: { h: number }) {
  const { colors: D } = useTheme()
  return (
    <div style={{ height:h, borderRadius:16, background:D.panel, position:'relative', overflow:'hidden', border:`1px solid ${D.border}` }}>
      <div style={{ position:'absolute', inset:0, background:'linear-gradient(90deg, transparent 0%, rgba(212,160,64,0.04) 50%, transparent 100%)', animation:'shimmer 2s ease-in-out infinite' }} />
    </div>
  )
}
function PageSkeleton() {
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
      <div className="kpi-grid" style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:14 }}>{[0,1,2,3,4].map(i=><Skel key={i} h={108}/>)}</div>
      <div className="kpi-grid2" style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:14 }}>{[0,1,2].map(i=><Skel key={i} h={90}/>)}</div>
      <div className="pi-grid" style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(420px, 1fr))', gap:14 }}><Skel h={320}/><Skel h={320}/></div>
      <Skel h={560}/>
    </div>
  )
}

/* ── Section table (planning activities) ──────────────────────── */
function SectionTable({ sections }: { sections: SectionRow[] }) {
  const { colors: D } = useTheme()
  const [page, setPage] = useState(0)
  const PAGE = 20, total = sections.length
  const pageData = sections.slice(page * PAGE, page * PAGE + PAGE)
  return (
    <div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${D.border}` }}>
              {['Section', 'Total', 'Planned', 'Implemented', 'Impl. Rate', 'Coverage'].map(h => (
                <th key={h} style={{ padding: '10px 14px', textAlign: h === 'Section' ? 'left' : 'right', color: D.amber, fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageData.map((r, i) => {
              const rate = r.total > 0 ? Math.round((r.implemented / r.total) * 100) : 0
              const unlinked = r.section === 'Unlinked / No Section'
              return (
                <tr key={r.section + i} className="tbl-row" style={{ borderBottom: `1px solid rgba(255,255,255,0.03)` }}>
                  <td style={{ padding: '10px 14px', color: unlinked ? D.sub : D.text, fontFamily: 'var(--font-mono)', fontWeight: 600, fontStyle: unlinked ? 'italic' : 'normal' }}>{r.section}</td>
                  <td style={{ padding: '10px 14px', textAlign: 'right', color: D.text, fontFamily: 'var(--font-mono)' }}>{r.total.toLocaleString()}</td>
                  <td style={{ padding: '10px 14px', textAlign: 'right', color: D.blue, fontFamily: 'var(--font-mono)' }}>{r.planned.toLocaleString()}</td>
                  <td style={{ padding: '10px 14px', textAlign: 'right', color: D.green, fontFamily: 'var(--font-mono)' }}>{r.implemented.toLocaleString()}</td>
                  <td style={{ padding: '10px 14px', textAlign: 'right' }}>
                    <span style={{ background: 'rgba(52,211,153,0.12)', color: D.green, border: `1px solid ${D.green}30`, padding: '3px 10px', borderRadius: 5, fontFamily: 'var(--font-mono)', fontSize: 10 }}>{rate}%</span>
                  </td>
                  <td style={{ padding: '10px 14px', minWidth: 100 }}><FunnelBar total={r.total} planned={r.planned} implemented={r.implemented} /></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {total > PAGE && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 14 }}>
          <button className="btn-ghost" onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} style={{ background: 'transparent', color: page === 0 ? D.sub : D.amber, border: `1px solid ${page === 0 ? D.sub : D.amber}30`, borderRadius: 7, padding: '6px 16px', fontSize: 11, cursor: page === 0 ? 'not-allowed' : 'pointer', fontFamily: 'var(--font-mono)' }}>‹ Prev</button>
          <span style={{ fontSize: 10, color: D.sub, fontFamily: 'var(--font-mono)' }}>{page * PAGE + 1}–{Math.min((page + 1) * PAGE, total)} of {total.toLocaleString()}</span>
          <button className="btn-ghost" onClick={() => setPage(p => Math.min(Math.ceil(total / PAGE) - 1, p + 1))} disabled={page >= Math.ceil(total / PAGE) - 1} style={{ background: 'transparent', color: page >= Math.ceil(total / PAGE) - 1 ? D.sub : D.amber, border: `1px solid ${page >= Math.ceil(total / PAGE) - 1 ? D.sub : D.amber}30`, borderRadius: 7, padding: '6px 16px', fontSize: 11, cursor: page >= Math.ceil(total / PAGE) - 1 ? 'not-allowed' : 'pointer', fontFamily: 'var(--font-mono)' }}>Next ›</button>
        </div>
      )}
    </div>
  )
}

/* ── Road assets by section (small, always ≤ a handful of rows) ── */
function RoadAssetSectionTable({ rows, activeSection }: { rows: RoadAssetSectionRow[]; activeSection: string }) {
  const { colors: D } = useTheme()
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
        <thead>
          <tr style={{ borderBottom: `1px solid ${D.border}` }}>
            {['Section', 'Project', 'Total Assets', 'Geolocated', 'Implemented'].map(h => (
              <th key={h} style={{ padding: '10px 14px', textAlign: h === 'Section' || h === 'Project' ? 'left' : 'right', color: D.amber, fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={`${r.project}|${r.section}`} className="tbl-row" style={{ borderBottom: '1px solid rgba(255,255,255,0.03)', background: r.section === activeSection ? 'rgba(212,160,64,0.06)' : undefined }}>
              <td style={{ padding: '10px 14px', color: D.text, fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{r.section}</td>
              <td style={{ padding: '10px 14px', color: D.muted, fontFamily: 'var(--font-mono)' }}>{r.project}</td>
              <td style={{ padding: '10px 14px', textAlign: 'right', color: D.text, fontFamily: 'var(--font-mono)' }}>{r.total.toLocaleString()}</td>
              <td style={{ padding: '10px 14px', textAlign: 'right', color: D.muted, fontFamily: 'var(--font-mono)' }}>{r.geolocated.toLocaleString()}</td>
              <td style={{ padding: '10px 14px', textAlign: 'right' }}>
                {r.matchedKeyword ? (
                  <span title={`Matched a report section containing "${r.matchedKeyword}"`} style={{ background: 'rgba(52,211,153,0.12)', color: D.green, border: `1px solid ${D.green}30`, padding: '3px 10px', borderRadius: 5, fontFamily: 'var(--font-mono)', fontSize: 10 }}>✓ {r.implemented.toLocaleString()}</span>
                ) : (
                  <span style={{ color: D.sub, fontFamily: 'var(--font-mono)', fontSize: 10 }}>— none</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/* ── Main page ──────────────────────────────────────────────── */
function PlanningImplementationPageInner() {
  const { colors: D } = useTheme()
  const router       = useRouter()
  const searchParams = useSearchParams()
  const [data, setData]       = useState<PlanningData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')
  const [loadStats, setLoadStats] = useState<LoadStats | null>(null)
  const requestIdRef = useRef(0)

  const activeProjectKey = searchParams.get('project') || ''
  const activeProject    = PROJECTS.find(p => p.key === activeProjectKey) ?? null
  const activeSection    = searchParams.get('section') || ''

  const loadData = useCallback(() => {
    const reqId = ++requestIdRef.current
    setLoading(true)
    const qs = new URLSearchParams()
    if (activeProject) qs.set('project', activeProject.label)
    fetch(`/api/planning-implementation?${qs}`)
      .then(async r => {
        const d = await r.json()
        if (!r.ok) throw new Error(d?.error || 'Failed to load')
        return d
      })
      .then(d => { if (reqId === requestIdRef.current) { setData(d); setLoading(false) } })
      .catch(() => { if (reqId === requestIdRef.current) { setError('Failed to load planning/implementation data'); setLoading(false) } })
  }, [activeProject])

  useEffect(() => { loadData() }, [loadData])

  function handleProjectFilter(key: string) {
    const p = new URLSearchParams(searchParams.toString())
    if (key) p.set('project', key); else p.delete('project')
    p.delete('section') // section belongs to a project — clear it on project change
    router.push(`/planning-implementation?${p.toString()}`)
  }
  function handleSectionFilter(section: string) {
    const p = new URLSearchParams(searchParams.toString())
    if (section) p.set('section', section); else p.delete('section')
    router.push(`/planning-implementation?${p.toString()}`)
  }
  function clearFilters() {
    router.push('/planning-implementation')
  }

  // Instant client-side cross-filter: a section change never refetches
  // /api/planning-implementation (the full per-project section lists are
  // already local) — it just narrows what's displayed/summed, so selecting
  // a section is immediate, no network round trip. Only RoadAssetsMap (fed
  // activeSection directly below) does its own fetch, since road_assets is
  // too large to ever hold client-side in full.
  const planningSections   = data?.sections ?? []
  const roadAssetSections  = data?.roadAssets.sections ?? []
  const filteredPlanning   = activeSection ? planningSections.filter(s => s.section === activeSection) : planningSections
  const filteredRoadAssets = activeSection ? roadAssetSections.filter(s => s.section === activeSection) : roadAssetSections

  const planningSummary = filteredPlanning.reduce(
    (acc, s) => ({ total: acc.total + s.total, planned: acc.planned + s.planned, implemented: acc.implemented + s.implemented }),
    { total: 0, planned: 0, implemented: 0 }
  )
  const roadAssetsTotal       = filteredRoadAssets.reduce((s, r) => s + r.total, 0)
  const roadAssetsGeolocated  = filteredRoadAssets.reduce((s, r) => s + r.geolocated, 0)
  const roadAssetsImplemented = filteredRoadAssets.reduce((s, r) => s + r.implemented, 0)

  const combinedTotal       = planningSummary.total + roadAssetsTotal
  const combinedImplemented = planningSummary.implemented + roadAssetsImplemented
  const combinedImplementedPct = combinedTotal > 0 ? Math.round((combinedImplemented / combinedTotal) * 100) : 0
  const combinedSectionCount = new Set([...filteredPlanning.map(s => s.section), ...filteredRoadAssets.map(s => s.section)]).size

  const topSections = filteredPlanning.slice(0, 12).map(s => ({ name: s.section, count: s.total }))
  const assetTypeBars = (data?.roadAssets.entityTypes ?? []).slice(0, 10).map(t => ({ name: t.entity_type, count: t.point_count }))

  const geoGapNationwide = data?.roadAssets.summary
    ? data.roadAssets.summary.total_estimate - data.roadAssets.summary.geolocated_estimate
    : 0

  return (
    <div style={{ minHeight:'100vh', background:D.bg, color:D.text, fontFamily:'var(--font-dm-sans)' }}>
      <div style={{ padding:'28px 32px 80px', maxWidth:1480, margin:'0 auto' }}>
        <div style={{ marginBottom:20 }}>
          <div style={{ fontFamily:'var(--font-loader)', fontSize:'1.4rem', letterSpacing:'0.08em', color:D.amber }}>PLANNING &amp; IMPLEMENTATION</div>
          <div style={{ fontFamily:'var(--font-mono)', fontSize:'0.65rem', color:D.muted, letterSpacing:'0.08em', marginTop:4 }}>
            Planned/field-confirmed activities and surveyed road-design assets, combined — filter by project or section to cross-filter every panel below
          </div>
        </div>

        {error && <div style={{ background:'rgba(248,113,113,0.06)', border:'1px solid rgba(248,113,113,0.2)', borderRadius:12, padding:'14px 18px', color:D.red, fontFamily:'var(--font-mono)', fontSize:'0.78rem', marginBottom:20 }}>{error}</div>}

        {/* Project / Section filters */}
        {data && (
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end', padding: '16px 20px', background: D.panel, border: `1px solid ${D.border}`, borderRadius: 14, marginBottom: 24 }}>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <div style={{ fontSize: 10, color: D.muted, letterSpacing: 1.5, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', marginBottom: 5 }}>Project</div>
              <select value={activeProjectKey} onChange={e => handleProjectFilter(e.target.value)}
                style={{ background: D.bg, color: D.text, border: `1px solid ${D.border}`, borderRadius: 8, padding: '7px 12px', fontSize: 12, fontFamily: 'var(--font-mono)', cursor: 'pointer', minWidth: 220, outline: 'none' }}>
                <option value=''>All Projects (nationwide)</option>
                {PROJECTS.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <div style={{ fontSize: 10, color: D.muted, letterSpacing: 1.5, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', marginBottom: 5 }}>Section</div>
              <select value={activeSection} onChange={e => handleSectionFilter(e.target.value)}
                style={{ background: D.bg, color: D.text, border: `1px solid ${D.border}`, borderRadius: 8, padding: '7px 12px', fontSize: 12, fontFamily: 'var(--font-mono)', cursor: 'pointer', minWidth: 240, outline: 'none' }}>
                <option value=''>All Sections</option>
                {planningSections.length > 0 && (
                  <optgroup label="Planning Sections">
                    {planningSections.map(s => <option key={`p|${s.section}`} value={s.section}>{s.section} ({s.total.toLocaleString()})</option>)}
                  </optgroup>
                )}
                {roadAssetSections.length > 0 && (
                  <optgroup label="Road Asset Sections">
                    {roadAssetSections.map(s => <option key={`r|${s.section}`} value={s.section}>{s.section} ({s.total.toLocaleString()})</option>)}
                  </optgroup>
                )}
              </select>
            </div>
            {(activeProjectKey || activeSection) && <button className="btn-ghost" onClick={clearFilters}
              style={{ background: 'transparent', color: D.amber, border: '1px solid rgba(212,160,64,0.3)', borderRadius: 8, padding: '7px 18px', fontSize: 12, cursor: 'pointer', fontFamily: 'var(--font-mono)', letterSpacing: 1, alignSelf: 'flex-end', transition: 'all 0.2s' }}>✕ Clear</button>}
          </div>
        )}

        {loading && !data && <PageSkeleton/>}

        {data && (
          <div style={{ opacity: loading ? 0.55 : 1, filter: loading ? 'blur(1.5px) saturate(0.85)' : 'blur(0) saturate(1)', transform: loading ? 'scale(0.997)' : 'scale(1)', pointerEvents: loading ? 'none' : 'auto', transition: `opacity 0.35s ${EASE}, filter 0.35s ${EASE}, transform 0.35s ${EASE}` }}>

            {geoGapNationwide > 0 && (
              <div style={{ background: 'rgba(212,160,64,0.07)', border: '1px solid rgba(212,160,64,0.22)', borderRadius: 10, padding: '10px 16px', color: D.amber, fontFamily: 'var(--font-mono)', fontSize: '0.68rem', marginBottom: 14 }}>
                {geoGapNationwide.toLocaleString()} road assets nationwide have no coordinates on file (mostly in the Ogun section) and can&apos;t appear on the map below.
              </div>
            )}

            <div className="kpi-grid" style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:14, marginBottom:14 }}>
              <KPICard label="Total (Combined)"       value={combinedTotal}          icon={<IconLayers/>}     delay={0}   color={D.amber}
                sub={`Activities: ${planningSummary.total.toLocaleString()} · Road Assets: ${roadAssetsTotal.toLocaleString()}`} />
              <KPICard label="Planned Activities"     value={planningSummary.planned} icon={<IconClipboard/>} delay={80}  color={D.blue}
                sub="Activities only — road assets have no planned_date" />
              <KPICard label="Implemented (Combined)" value={combinedImplemented}     icon={<IconCheck/>}     delay={160} color={D.green}
                sub={`Activities: ${planningSummary.implemented.toLocaleString()} · Road Assets: ${roadAssetsImplemented.toLocaleString()}`} />
              <KPICard label="Sections"               value={combinedSectionCount}    icon={<IconMap/>}       delay={240} color={D.purple} />
              <KPICard label="Implementation Rate"    value={combinedImplementedPct} suffix="%" icon={<IconCheck/>} delay={320} color={D.green} />
            </div>

            <div className="kpi-grid2" style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:14, marginBottom:20 }}>
              <KPICard label="Road Assets (est.)"      value={roadAssetsTotal} icon={<IconLayers/>} delay={0}  color={D.amber} />
              <KPICard label="Road Assets Geolocated"  value={roadAssetsGeolocated} icon={<IconMap/>} delay={80} color={D.blue} />
              <div style={{ background: D.panel, borderRadius: 22, padding: '20px 22px', position: 'relative', overflow: 'hidden', border: `1px solid ${D.border}`, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                <div style={{ width: 44, height: 44, borderRadius: 14, background: `${D.green}20`, border: `1px solid ${D.green}35`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: D.green, marginBottom: 16 }}><IconClock /></div>
                {loadStats ? (
                  <>
                    <div style={{ fontFamily: 'var(--font-loader)', fontSize: '1.5rem', fontWeight: 400, lineHeight: 1, letterSpacing: '0.03em', color: D.green }}>
                      {loadStats.queryMs}ms <span style={{ fontSize: '0.9rem', color: D.sub }}>db</span> / {loadStats.clientMs}ms <span style={{ fontSize: '0.9rem', color: D.sub }}>total</span>
                    </div>
                    <div style={{ fontSize: '0.58rem', color: D.muted, fontFamily: 'var(--font-mono)', letterSpacing: '0.1em', textTransform: 'uppercase', marginTop: 8 }}>
                      Map Load Time · {loadStats.mode === 'live' ? 'live query' : 'materialized view'}
                    </div>
                  </>
                ) : (
                  <div style={{ fontSize: '0.7rem', color: D.sub, fontFamily: 'var(--font-mono)' }}>waiting for map…</div>
                )}
              </div>
            </div>

            <Reveal style={{ marginBottom:16 }}>
              <div className="pi-grid" style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(420px, 1fr))', gap:14 }}>
                <Panel title="Activities by Section">
                  {topSections.length > 0
                    ? <HBarChart data={topSections} color={D.amber}/>
                    : <EmptyState label="No planning activities recorded for this project/section"/>}
                </Panel>
                <Panel title="Planning vs Implementation Coverage">
                  <div style={{ display:'flex', gap:16, alignItems:'center', fontSize:'0.68rem', fontFamily:'var(--font-mono)', color:D.muted, marginBottom:-4 }}>
                    <span style={{ display:'flex', alignItems:'center', gap:6 }}><span style={{ width:8, height:8, borderRadius:2, background:`${D.blue}55` }}/>Planned</span>
                    <span style={{ display:'flex', alignItems:'center', gap:6 }}><span style={{ width:8, height:8, borderRadius:2, background:D.green }}/>Implemented</span>
                    <span style={{ color:D.sub }}>— relative to that section&apos;s total</span>
                  </div>
                  {filteredPlanning.length > 0
                    ? <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
                        {filteredPlanning.slice(0, 12).map(s => {
                          const rate = s.total > 0 ? Math.round((s.implemented / s.total) * 100) : 0
                          return (
                            <div key={s.section} style={{ display:'flex', alignItems:'center', gap:10 }}>
                              <span style={{ width:130, fontSize:'0.68rem', color:D.muted, fontFamily:'var(--font-mono)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', flexShrink:0 }} title={s.section}>{s.section}</span>
                              <div style={{ flex:1 }}><FunnelBar total={s.total} planned={s.planned} implemented={s.implemented}/></div>
                              <span style={{ width:36, textAlign:'right', fontSize:'0.68rem', color:D.green, fontWeight:700, fontFamily:'var(--font-mono)', flexShrink:0 }}>{rate}%</span>
                            </div>
                          )
                        })}
                      </div>
                    : <EmptyState label="No coverage data available"/>}
                </Panel>
              </div>
            </Reveal>

            <Reveal delay={40} style={{ marginBottom:16 }}>
              <Panel title={`Road Asset Types (${(data.roadAssets.entityTypes.length).toLocaleString()} total, top 10 shown, nationwide)`}>
                {assetTypeBars.length > 0
                  ? <HBarChart data={assetTypeBars} color={D.blue}/>
                  : <EmptyState label="No road asset type data available"/>}
              </Panel>
            </Reveal>

            <Reveal delay={60} style={{ marginBottom:16 }}>
              <Panel title={`Road Assets Map${activeProject ? ` · ${activeProject.label}` : ''}${activeSection ? ` · ${activeSection}` : ''}`}>
                <RoadAssetsMap project={activeProject?.assetsName ?? ''} section={activeSection} onLoadStats={setLoadStats} />
              </Panel>
            </Reveal>

            <Reveal delay={80} style={{ marginBottom:16 }}>
              <Panel title={`Road Assets by Section (${roadAssetSections.length})`}>
                {roadAssetSections.length > 0
                  ? <RoadAssetSectionTable rows={roadAssetSections} activeSection={activeSection} />
                  : <EmptyState label="No road asset sections found for this project"/>}
              </Panel>
            </Reveal>

            <Reveal delay={100}>
              <Panel title={`Sections Breakdown (${filteredPlanning.length})`}>
                {filteredPlanning.length > 0
                  ? <SectionTable sections={filteredPlanning}/>
                  : <EmptyState label="No planning activities recorded for this project/section"/>}
              </Panel>
            </Reveal>
          </div>
        )}
      </div>

      <style>{`
        @keyframes fadeIn    { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:translateY(0); } }
        @keyframes shimmer   { 0% { transform:translateX(-100%); } 100% { transform:translateX(600%); } }
        @keyframes pingAnim  { 0% { transform:scale(1); opacity:0.5; } 75%,100% { transform:scale(2.8); opacity:0; } }
        select:focus { outline:none; border-color:rgba(212,160,64,0.4) !important; box-shadow:0 0 0 2px rgba(212,160,64,0.1) !important; }
        select option { background:${D.bg}; }
        .btn-ghost { transition: background 0.2s ${EASE}, border-color 0.2s ${EASE}, color 0.2s ${EASE}, transform 0.2s ${EASE} !important; }
        .btn-ghost:not(:disabled):hover { background:rgba(212,160,64,0.1) !important; border-color:rgba(212,160,64,0.55) !important; color:${D.amberL} !important; transform:translateY(-1px); }
        .btn-ghost:not(:disabled):active { transform:translateY(0) scale(0.97); }
        .tbl-row { transition: background 0.15s ${EASE}; }
        .tbl-row:nth-child(even) { background: rgba(255,255,255,0.014); }
        .tbl-row:hover { background: rgba(212,160,64,0.045) !important; }
        @media (max-width: 1180px) { .kpi-grid { grid-template-columns: repeat(3,1fr) !important; } .kpi-grid2 { grid-template-columns: repeat(2,1fr) !important; } }
        @media (max-width: 640px)  { .kpi-grid { grid-template-columns: repeat(2,1fr) !important; } .kpi-grid2 { grid-template-columns: repeat(1,1fr) !important; } }
      `}</style>
    </div>
  )
}

export default function PlanningImplementationPage() {
  const { colors: D } = useTheme()
  return (
    <Suspense fallback={<div style={{ minHeight: '100vh', background: D.bg, padding: '28px 32px 60px' }}><PageSkeleton /></div>}>
      <PlanningImplementationPageInner />
    </Suspense>
  )
}
