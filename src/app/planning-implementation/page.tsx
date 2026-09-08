'use client'

import { useEffect, useRef, useState, useCallback, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import dynamic from 'next/dynamic'
import { useTheme } from '@/lib/theme'

const RoadAssetsMap = dynamic(() => import('@/components/RoadAssetsMap'), { ssr: false })

const EASE = 'cubic-bezier(0.16,1,0.3,1)'

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
  reportCount: number
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
  }
  // "Implemented" has no combined figure — road assets don't contribute to
  // it (see route.ts comment), so summary.implemented is the only real
  // Implemented number on this page.
  combined: {
    total: number
    planned: number
    totalBreakdown: { activities: number; roadAssets: number }
  }
}

interface LoadStats { queryMs: number; clientMs: number; count: number; mode: 'live' | 'mv' }

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

function KPICard({ label, value, suffix, sub, icon, delay = 0, color }: { label: string; value: number; suffix?: string; sub?: string; icon: React.ReactNode; delay?: number; color?: string }) {
  const { colors: D, shadows: SH } = useTheme()
  const [vis, setVis] = useState(false)
  useEffect(() => { const t = setTimeout(() => setVis(true), delay + 80); return () => clearTimeout(t) }, [delay])
  const displayed = useCountUp(vis ? value : 0, 1200, 0)
  return (
    <div style={{ background: D.panel, border: `1px solid ${D.border}`, borderRadius: 10, boxShadow: SH.card, padding: '14px 16px', opacity: vis ? 1 : 0, transform: vis ? 'translateY(0)' : 'translateY(10px)', transition: `opacity 0.5s ease ${delay}ms, transform 0.5s ${EASE} ${delay}ms` }}>
      <div style={{ width: 26, height: 26, borderRadius: 7, background: D.panel2, border: `1px solid ${D.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: D.muted, marginBottom: 10 }}>{icon}</div>
      <div style={{ fontFamily: 'var(--font-loader)', fontSize: 24, fontWeight: 600, lineHeight: 1, letterSpacing: '-0.02em', color: color ?? D.text, fontVariantNumeric: 'tabular-nums' }}>{displayed.toLocaleString()}{suffix ?? ''}</div>
      <div style={{ fontSize: 10.5, color: D.muted, fontFamily: 'var(--font-mono)', letterSpacing: '0.1em', textTransform: 'uppercase', marginTop: 8 }}>{label}</div>
      {sub && <div style={{ fontSize: 10, color: D.sub, fontFamily: 'var(--font-mono)', marginTop: 4, lineHeight: 1.5 }}>{sub}</div>}
    </div>
  )
}

/* ── horizontal bars (single series) ──────────────────────── */
function HBarChart({ data, activeName, onBarClick }: { data: Array<{ name: string; count: number }>; activeName?: string; onBarClick?: (name: string) => void }) {
  const { colors: D } = useTheme()
  const [ready, setReady] = useState(false)
  const [hov, setHov] = useState<number | null>(null)
  useEffect(() => { const t = setTimeout(() => setReady(true), 250); return () => clearTimeout(t) }, [])
  const max = Math.max(...data.map(d => d.count), 1)
  const total = data.reduce((s, d) => s + d.count, 0)
  const hasActive = !!activeName
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7, width: '100%' }}>
      {data.map((d, i) => {
        const pct = total > 0 ? Math.round((d.count / total) * 100) : 0
        const barPct = (d.count / max) * 100
        const isHov = hov === i
        const isTop = i < 3
        const isActive = d.name === activeName
        return (
          <div key={d.name} onMouseEnter={() => setHov(i)} onMouseLeave={() => setHov(null)}
            onClick={() => onBarClick?.(d.name === activeName ? '' : d.name)}
            style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: onBarClick ? 'pointer' : 'default', opacity: hasActive ? (isActive ? 1 : 0.4) : (hov !== null && !isHov ? 0.45 : 1), transition: 'opacity 0.2s' }}>
            <div style={{ width: 18, height: 18, borderRadius: 5, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: isTop ? `${D.amber}14` : 'transparent', border: `1px solid ${isTop ? D.amber + '33' : 'transparent'}`, fontSize: 9, fontFamily: 'var(--font-mono)', color: isTop ? D.amber : D.sub, fontWeight: isTop ? 700 : 400 }}>{i + 1}</div>
            <span style={{ width: 150, fontSize: 12.5, color: isHov || isActive ? D.text : D.muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flexShrink: 0 }} title={d.name}>{d.name}</span>
            <div style={{ flex: 1, height: 5, background: D.panel2, borderRadius: 6, overflow: 'hidden', position: 'relative' }}>
              <div style={{ position: 'absolute', inset: 0, right: 'auto', width: ready ? `${barPct}%` : '0%', background: isTop ? D.amber : `${D.muted}88`, borderRadius: 6, transition: `width 0.8s ${EASE} ${i * 0.03}s` }} />
            </div>
            <span style={{ width: 70, textAlign: 'right', fontSize: 12.5, color: isHov || isActive ? D.amber : D.text, fontWeight: 700, fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>{d.count.toLocaleString()}</span>
            <span style={{ width: 30, textAlign: 'right', fontSize: 11, color: D.sub, fontFamily: 'var(--font-mono)', flexShrink: 0 }}>{pct}%</span>
          </div>
        )
      })}
    </div>
  )
}

/* ── Funnel bar — Total (track) → Planned (mid) → Implemented (top) ── */
function FunnelBar({ total, planned, implemented }: { total: number; planned: number; implemented: number }) {
  const { colors: D } = useTheme()
  const [ready, setReady] = useState(false)
  useEffect(() => { const t = setTimeout(() => setReady(true), 250); return () => clearTimeout(t) }, [])
  const plannedPct = total > 0 ? (planned / total) * 100 : 0
  const implementedPct = total > 0 ? (implemented / total) * 100 : 0
  return (
    <div style={{ position: 'relative', height: 9, borderRadius: 5, background: D.panel2, overflow: 'hidden', minWidth: 90 }}>
      <div style={{ position: 'absolute', inset: 0, width: ready ? `${plannedPct}%` : '0%', background: `${D.amber}55`, borderRadius: 5, transition: `width 0.8s ${EASE}` }} />
      <div style={{ position: 'absolute', inset: 0, width: ready ? `${implementedPct}%` : '0%', background: D.green, borderRadius: 5, transition: `width 0.8s ${EASE} 0.1s` }} />
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

const IconLayers = () => <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2" /><polyline points="2 17 12 22 22 17" /><polyline points="2 12 12 17 22 12" /></svg>
const IconClipboard = () => <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><rect x="8" y="2" width="8" height="4" rx="1" /><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" /></svg>
const IconCheck = () => <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg>
const IconMap = () => <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6" /><line x1="8" y1="2" x2="8" y2="18" /><line x1="16" y1="6" x2="16" y2="22" /></svg>
const IconClock = () => <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><polyline points="12 7 12 12 16 14" /></svg>

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
      <div className="kpi-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 14 }}>{[0, 1, 2, 3, 4].map(i => <Skel key={i} h={110} />)}</div>
      <div className="kpi-grid2" style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 14 }}>{[0, 1, 2, 3].map(i => <Skel key={i} h={90} />)}</div>
      <div className="pi-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: 14 }}><Skel h={320} /><Skel h={320} /></div>
      <Skel h={520} />
    </div>
  )
}

/* ── shared table chrome ──────────────────────────────────── */
function useTh() {
  const { colors: D } = useTheme()
  return (align: 'left' | 'right' = 'left'): React.CSSProperties => ({
    padding: '9px 14px', textAlign: align, color: D.muted, fontFamily: 'var(--font-mono)', fontSize: 10,
    letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 600, background: D.panel2,
    borderBottom: `1px solid ${D.border}`, whiteSpace: 'nowrap',
  })
}

/* ── Section table (planning activities) ──────────────────── */
function SectionTable({ sections, activeSection, onSelectSection }: { sections: SectionRow[]; activeSection: string; onSelectSection: (section: string) => void }) {
  const { colors: D } = useTheme()
  const th = useTh()
  const [page, setPage] = useState(0)
  const PAGE = 20, total = sections.length
  const pageData = sections.slice(page * PAGE, page * PAGE + PAGE)
  const td: React.CSSProperties = { padding: '9px 14px', borderBottom: `1px solid ${D.border}` }
  const last = Math.ceil(total / PAGE) - 1
  const pbtn: React.CSSProperties = { background: D.panel, color: D.text, border: `1px solid ${D.border}`, borderRadius: 8, padding: '6px 14px', fontSize: 12, fontFamily: 'var(--font-mono)', cursor: 'pointer' }
  return (
    <div>
      <div style={{ overflowX: 'auto', border: `1px solid ${D.border}`, borderRadius: 10 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 600 }}>
          <thead><tr>{['Section', 'Total', 'Planned', 'Implemented', 'Impl. Rate', 'Coverage'].map(h => <th key={h} style={th(h === 'Section' ? 'left' : 'right')}>{h}</th>)}</tr></thead>
          <tbody>
            {pageData.map((r, i) => {
              const rate = r.total > 0 ? Math.round((r.implemented / r.total) * 100) : 0
              const unlinked = r.section === 'Unlinked / No Section'
              const isActive = r.section === activeSection
              return (
                <tr key={r.section + i} className="tbl-row" onClick={unlinked ? undefined : () => onSelectSection(r.section === activeSection ? '' : r.section)}
                  style={{ cursor: unlinked ? 'default' : 'pointer', background: isActive ? `${D.amber}12` : undefined }}
                  title={unlinked ? undefined : `Filter to ${r.section}`}>
                  <td style={{ ...td, color: unlinked ? D.sub : (isActive ? D.amber : D.text), fontFamily: 'var(--font-mono)', fontWeight: 600, fontStyle: unlinked ? 'italic' : 'normal' }}>{r.section}</td>
                  <td style={{ ...td, textAlign: 'right', color: D.text, fontFamily: 'var(--font-mono)' }}>{r.total.toLocaleString()}</td>
                  <td style={{ ...td, textAlign: 'right', color: D.amber, fontFamily: 'var(--font-mono)' }}>{r.planned.toLocaleString()}</td>
                  <td style={{ ...td, textAlign: 'right', color: D.green, fontFamily: 'var(--font-mono)' }}>{r.implemented.toLocaleString()}</td>
                  <td style={{ ...td, textAlign: 'right' }}>
                    <span style={{ background: `${D.green}1f`, color: D.green, border: `1px solid ${D.green}3a`, padding: '3px 8px', borderRadius: 5, fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 600 }}>{rate}%</span>
                  </td>
                  <td style={{ ...td, minWidth: 100 }}><FunnelBar total={r.total} planned={r.planned} implemented={r.implemented} /></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {total > PAGE && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 14 }}>
          <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} style={{ ...pbtn, opacity: page === 0 ? 0.4 : 1 }}>‹ Prev</button>
          <span style={{ fontSize: 11, color: D.sub, fontFamily: 'var(--font-mono)' }}>{page * PAGE + 1}–{Math.min((page + 1) * PAGE, total)} of {total.toLocaleString()}</span>
          <button onClick={() => setPage(p => Math.min(last, p + 1))} disabled={page >= last} style={{ ...pbtn, opacity: page >= last ? 0.4 : 1 }}>Next ›</button>
        </div>
      )}
    </div>
  )
}

/* ── Road assets by section (small) ──────────────────────── */
function RoadAssetSectionTable({ rows, activeSection, onSelectSection }: { rows: RoadAssetSectionRow[]; activeSection: string; onSelectSection: (section: string) => void }) {
  const { colors: D } = useTheme()
  const th = useTh()
  const td: React.CSSProperties = { padding: '9px 14px', borderBottom: `1px solid ${D.border}` }
  return (
    <div style={{ overflowX: 'auto', border: `1px solid ${D.border}`, borderRadius: 10 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 560 }}>
        <thead><tr>{['Section', 'Project', 'Total Assets', 'Geolocated', 'Field Reports'].map(h => <th key={h} style={th(h === 'Section' || h === 'Project' ? 'left' : 'right')}>{h}</th>)}</tr></thead>
        <tbody>
          {rows.map(r => {
            const isActive = r.section === activeSection
            return (
              <tr key={`${r.project}|${r.section}`} className="tbl-row" onClick={() => onSelectSection(r.section === activeSection ? '' : r.section)}
                style={{ cursor: 'pointer', background: isActive ? `${D.amber}12` : undefined }} title={`Filter to ${r.section}`}>
                <td style={{ ...td, color: isActive ? D.amber : D.text, fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{r.section}</td>
                <td style={{ ...td, color: D.muted, fontFamily: 'var(--font-mono)' }}>{r.project}</td>
                <td style={{ ...td, textAlign: 'right', color: D.text, fontFamily: 'var(--font-mono)' }}>{r.total.toLocaleString()}</td>
                <td style={{ ...td, textAlign: 'right', color: D.muted, fontFamily: 'var(--font-mono)' }}>{r.geolocated.toLocaleString()}</td>
                <td style={{ ...td, textAlign: 'right' }}>
                  {r.reportCount > 0 ? (
                    <span title={`Matched via report section names containing "${r.matchedKeyword}" — a report count, not an asset-verification count`} style={{ background: `${D.amber}1f`, color: D.amber, border: `1px solid ${D.amber}3a`, padding: '3px 8px', borderRadius: 5, fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 600 }}>{r.reportCount.toLocaleString()} report{r.reportCount === 1 ? '' : 's'}</span>
                  ) : (
                    <span style={{ color: D.sub, fontFamily: 'var(--font-mono)', fontSize: 10 }}>— none</span>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/* ── page ─────────────────────────────────────────────────── */
function PlanningImplementationPageInner() {
  const { colors: D } = useTheme()
  const router = useRouter()
  const searchParams = useSearchParams()
  const [data, setData] = useState<PlanningData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [loadStats, setLoadStats] = useState<LoadStats | null>(null)
  const requestIdRef = useRef(0)

  const activeProjectKey = searchParams.get('project') || ''
  const activeProject = PROJECTS.find(p => p.key === activeProjectKey) ?? null
  const activeSection = searchParams.get('section') || ''

  const loadData = useCallback(() => {
    const reqId = ++requestIdRef.current
    setLoading(true)
    const qs = new URLSearchParams()
    if (activeProject) qs.set('project', activeProject.label)
    fetch(`/api/planning-implementation?${qs}`)
      .then(async r => {
        if (r.status === 401) { router.replace('/login'); return null }
        const d = await r.json()
        if (!r.ok) throw new Error(d?.error || 'Failed to load')
        return d
      })
      .then(d => { if (d && reqId === requestIdRef.current) { setData(d); setLoading(false) } })
      .catch(() => { if (reqId === requestIdRef.current) { setError('Failed to load planning/implementation data'); setLoading(false) } })
  }, [activeProject, router])

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
  const planningSections = data?.sections ?? []
  const roadAssetSections = data?.roadAssets.sections ?? []
  const filteredPlanning = activeSection ? planningSections.filter(s => s.section === activeSection) : planningSections
  const filteredRoadAssets = activeSection ? roadAssetSections.filter(s => s.section === activeSection) : roadAssetSections

  const planningSummary = filteredPlanning.reduce(
    (acc, s) => ({ total: acc.total + s.total, planned: acc.planned + s.planned, implemented: acc.implemented + s.implemented }),
    { total: 0, planned: 0, implemented: 0 }
  )
  const roadAssetsTotal = filteredRoadAssets.reduce((s, r) => s + r.total, 0)
  const roadAssetsGeolocated = filteredRoadAssets.reduce((s, r) => s + r.geolocated, 0)
  const roadAssetsReportCount = filteredRoadAssets.reduce((s, r) => s + r.reportCount, 0)

  // Total legitimately sums both tables. Implementation Rate does NOT — a
  // report's existence on a road-asset section says nothing about how many
  // of that section's assets were actually verified, so folding road assets
  // into this rate would either wildly overstate it (one report flips a
  // whole section) or crater it toward ~0% (divided by 7M+ assets). This is
  // activities-only, on purpose — see route.ts's comment for the full story.
  const combinedTotal = planningSummary.total + roadAssetsTotal
  const activityImplementedPct = planningSummary.total > 0 ? Math.round((planningSummary.implemented / planningSummary.total) * 100) : 0
  const combinedSectionCount = new Set([...filteredPlanning.map(s => s.section), ...filteredRoadAssets.map(s => s.section)]).size

  const topSections = filteredPlanning.slice(0, 12).map(s => ({ name: s.section, count: s.total }))
  const assetTypeBars = (data?.roadAssets.entityTypes ?? []).slice(0, 10).map(t => ({ name: t.entity_type, count: t.point_count }))

  const geoGapNationwide = data?.roadAssets.summary
    ? data.roadAssets.summary.total_estimate - data.roadAssets.summary.geolocated_estimate
    : 0

  const selStyle: React.CSSProperties = { background: D.panel2, color: D.text, border: `1px solid ${D.border}`, borderRadius: 7, padding: '6px 9px', fontSize: 12.5, cursor: 'pointer', outline: 'none' }
  const lblStyle: React.CSSProperties = { fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: D.muted, marginBottom: 5 }

  return (
    <div style={{ minHeight: '100%', background: D.bg, color: D.text }}>
      <div style={{ padding: '28px 36px', width: '100%' }}>
        <div style={{ marginBottom: 18 }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600, letterSpacing: '-0.01em' }}>Planning &amp; Implementation</h2>
          <p style={{ margin: 0, marginTop: 3, fontSize: 13, color: D.muted }}>Planned / field-confirmed activities and surveyed road-design assets, combined — filter by project or section to cross-filter every panel.</p>
        </div>

        {error && <div style={{ background: `${D.red}12`, border: `1px solid ${D.red}3a`, borderRadius: 10, padding: '12px 16px', color: D.red, fontFamily: 'var(--font-mono)', fontSize: 13, marginBottom: 20 }}>{error}</div>}

        {data && (
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end', padding: '12px 14px', background: D.panel, border: `1px solid ${D.border}`, borderRadius: 10, marginBottom: 20 }}>
            <span style={{ alignSelf: 'center', fontFamily: 'var(--font-mono)', fontSize: 10.5, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase', color: D.muted }}>Filters</span>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={lblStyle}>Project</span>
              <select value={activeProjectKey} onChange={e => handleProjectFilter(e.target.value)} style={{ ...selStyle, minWidth: 220 }}>
                <option value=''>All Projects (nationwide)</option>
                {PROJECTS.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={lblStyle}>Section</span>
              <select value={activeSection} onChange={e => handleSectionFilter(e.target.value)} style={{ ...selStyle, minWidth: 240 }}>
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
            {(activeProjectKey || activeSection) && <button onClick={clearFilters}
              style={{ ...selStyle, color: D.amber, background: 'transparent', border: `1px solid ${D.amber}55`, fontFamily: 'var(--font-mono)', alignSelf: 'flex-end' }}>✕ Clear</button>}
          </div>
        )}

        {loading && !data && <PageSkeleton />}

        {data && (
          <div style={{ opacity: loading ? 0.6 : 1, pointerEvents: loading ? 'none' : 'auto', transition: `opacity 0.25s ${EASE}` }}>

            {geoGapNationwide > 0 && (
              <div style={{ background: `${D.amber}12`, border: `1px solid ${D.amber}3a`, borderRadius: 10, padding: '10px 16px', color: D.amber, fontFamily: 'var(--font-mono)', fontSize: 12, marginBottom: 14 }}>
                {geoGapNationwide.toLocaleString()} road assets nationwide have no coordinates on file (mostly in the Ogun section) and can&apos;t appear on the map below.
              </div>
            )}

            <div className="kpi-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 14, marginBottom: 14 }}>
              <KPICard label="Total (Combined)" value={combinedTotal} icon={<IconLayers />} delay={0}
                sub={`Activities: ${planningSummary.total.toLocaleString()} · Road Assets: ${roadAssetsTotal.toLocaleString()}`} />
              <KPICard label="Planned Activities" value={planningSummary.planned} icon={<IconClipboard />} delay={60}
                sub="Activities only — road assets have no planned_date" />
              <KPICard label="Implemented Activities" value={planningSummary.implemented} icon={<IconCheck />} delay={120} color={D.green}
                sub="Activities only — a road-asset field report confirms a section got attention, not which assets were verified" />
              <KPICard label="Sections" value={combinedSectionCount} icon={<IconMap />} delay={180} />
              <KPICard label="Activity Implementation Rate" value={activityImplementedPct} suffix="%" icon={<IconCheck />} delay={240} color={D.green} />
            </div>

            <div className="kpi-grid2" style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 14, marginBottom: 20 }}>
              <KPICard label="Road Assets (est.)" value={roadAssetsTotal} icon={<IconLayers />} delay={0} />
              <KPICard label="Road Assets Geolocated" value={roadAssetsGeolocated} icon={<IconMap />} delay={60} />
              <KPICard label="Road Asset Field Reports" value={roadAssetsReportCount} icon={<IconClipboard />} delay={120} />
              <div style={{ background: D.panel, borderRadius: 10, padding: '14px 16px', border: `1px solid ${D.border}`, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                <div style={{ width: 26, height: 26, borderRadius: 7, background: D.panel2, border: `1px solid ${D.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: D.muted, marginBottom: 10 }}><IconClock /></div>
                {loadStats ? (
                  <>
                    <div style={{ fontFamily: 'var(--font-loader)', fontSize: 15, fontWeight: 600, lineHeight: 1.2, color: D.text, fontVariantNumeric: 'tabular-nums' }}>
                      {loadStats.queryMs}ms <span style={{ fontSize: 11, color: D.sub }}>db</span> / {loadStats.clientMs}ms <span style={{ fontSize: 11, color: D.sub }}>total</span>
                    </div>
                    <div style={{ fontSize: 10, color: D.muted, fontFamily: 'var(--font-mono)', letterSpacing: '0.08em', textTransform: 'uppercase', marginTop: 8 }}>
                      Map Load Time · {loadStats.mode === 'live' ? 'live query' : 'materialized view'}
                    </div>
                  </>
                ) : (
                  <div style={{ fontSize: 12, color: D.sub, fontFamily: 'var(--font-mono)' }}>waiting for map…</div>
                )}
              </div>
            </div>

            <Reveal style={{ marginBottom: 14 }}>
              <div className="pi-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: 14 }}>
                <Card title="Activities by Section">
                  {topSections.length > 0
                    ? <HBarChart data={topSections} activeName={activeSection} onBarClick={handleSectionFilter} />
                    : <EmptyState label="No planning activities recorded for this project/section" />}
                </Card>
                <Card title="Planning vs Implementation Coverage">
                  <div style={{ display: 'flex', gap: 16, alignItems: 'center', fontSize: 11.5, fontFamily: 'var(--font-mono)', color: D.muted, marginBottom: 8 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 8, height: 8, borderRadius: 2, background: `${D.amber}55` }} />Planned</span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 8, height: 8, borderRadius: 2, background: D.green }} />Implemented</span>
                    <span style={{ color: D.sub }}>— relative to section total</span>
                  </div>
                  {filteredPlanning.length > 0
                    ? <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        {filteredPlanning.slice(0, 12).map(s => {
                          const rate = s.total > 0 ? Math.round((s.implemented / s.total) * 100) : 0
                          const isActive = s.section === activeSection
                          const unlinked = s.section === 'Unlinked / No Section'
                          return (
                            <div key={s.section} onClick={unlinked ? undefined : () => handleSectionFilter(s.section === activeSection ? '' : s.section)}
                              style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: unlinked ? 'default' : 'pointer', opacity: isActive ? 1 : (activeSection && !isActive ? 0.55 : 1), transition: `opacity 0.2s ${EASE}` }}
                              title={unlinked ? undefined : `Filter to ${s.section}`}>
                              <span style={{ width: 130, fontSize: 11.5, color: isActive ? D.amber : D.muted, fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flexShrink: 0 }} title={s.section}>{s.section}</span>
                              <div style={{ flex: 1 }}><FunnelBar total={s.total} planned={s.planned} implemented={s.implemented} /></div>
                              <span style={{ width: 36, textAlign: 'right', fontSize: 11.5, color: D.green, fontWeight: 700, fontFamily: 'var(--font-mono)', flexShrink: 0 }}>{rate}%</span>
                            </div>
                          )
                        })}
                      </div>
                    : <EmptyState label="No coverage data available" />}
                </Card>
              </div>
            </Reveal>

            <Reveal delay={40} style={{ marginBottom: 14 }}>
              <Card title={`Road Asset Types (${data.roadAssets.entityTypes.length.toLocaleString()} total, top 10, nationwide)`}>
                {assetTypeBars.length > 0
                  ? <HBarChart data={assetTypeBars} />
                  : <EmptyState label="No road asset type data available" />}
              </Card>
            </Reveal>

            <Reveal delay={60} style={{ marginBottom: 14 }}>
              <Card title={`Road Assets Map${activeProject ? ` · ${activeProject.label}` : ''}${activeSection ? ` · ${activeSection}` : ''}`}>
                <RoadAssetsMap project={activeProject?.assetsName ?? ''} section={activeSection} onLoadStats={setLoadStats} />
              </Card>
            </Reveal>

            <Reveal delay={80} style={{ marginBottom: 14 }}>
              <Card title={`Road Assets by Section (${roadAssetSections.length})`}>
                {roadAssetSections.length > 0
                  ? <RoadAssetSectionTable rows={roadAssetSections} activeSection={activeSection} onSelectSection={handleSectionFilter} />
                  : <EmptyState label="No road asset sections found for this project" />}
              </Card>
            </Reveal>

            <Reveal delay={100}>
              <Card title={`Sections Breakdown (${filteredPlanning.length})`}>
                {filteredPlanning.length > 0
                  ? <SectionTable sections={filteredPlanning} activeSection={activeSection} onSelectSection={handleSectionFilter} />
                  : <EmptyState label="No planning activities recorded for this project/section" />}
              </Card>
            </Reveal>
          </div>
        )}
      </div>

      <style>{`
        @keyframes shimmer { 0% { transform:translateX(-100%); } 100% { transform:translateX(400%); } }
        select:focus { border-color:${D.amber} !important; box-shadow:0 0 0 3px ${D.amber}22 !important; }
        select option { background:${D.panel}; color:${D.text}; }
        .tbl-row { transition: background 0.12s ease; }
        .tbl-row:nth-child(even) { background: ${D.panel2}66; }
        .tbl-row:hover { background: ${D.amber}12 !important; }
        @media (max-width: 1180px) { .kpi-grid { grid-template-columns: repeat(3,1fr) !important; } .kpi-grid2 { grid-template-columns: repeat(2,1fr) !important; } }
        @media (max-width: 640px)  { .kpi-grid { grid-template-columns: repeat(2,1fr) !important; } .kpi-grid2 { grid-template-columns: repeat(1,1fr) !important; } .pi-grid { grid-template-columns: 1fr !important; } }
      `}</style>
    </div>
  )
}

export default function PlanningImplementationPage() {
  const { colors: D } = useTheme()
  return (
    <Suspense fallback={<div style={{ minHeight: '100vh', background: D.bg, padding: '28px 36px' }}><PageSkeleton /></div>}>
      <PlanningImplementationPageInner />
    </Suspense>
  )
}
