'use client'

import { useEffect, useRef, useState, useCallback, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import dynamic from 'next/dynamic'
import { useTheme } from '@/lib/theme'

const StreetlightsMap = dynamic(() => import('@/components/StreetlightsMap'), { ssr: false })

const EASE        = 'cubic-bezier(0.16,1,0.3,1)'
const EASE_SPRING = 'cubic-bezier(0.34,1.56,0.64,1)'

interface StreetlightsData {
  summary: {
    total_estimate: number
    lhs_count: number
    rhs_count: number
    median_count: number
    section_count: number
    refreshed_at: string
  } | null
  sections: Array<{ section: string; point_count: number }>
  imageVariants: Array<{ variant: number; label: string; image_url: string }>
  queryMs: number
}

interface LoadStats { queryMs: number; clientMs: number; count: number; mode: 'live' | 'mv' }

/* ── Animated counter (same as machines/page.tsx) ────────────── */
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
function KPICard({ label, value, icon, delay = 0, color: colorProp, suffix }: { label: string; value: number; icon: React.ReactNode; delay?: number; color?: string; suffix?: string }) {
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
      <div style={{ fontFamily: 'var(--font-loader)', fontSize: '2.5rem', fontWeight: 400, lineHeight: 1, letterSpacing: '0.03em', color, textShadow: hov ? `0 0 24px ${color}44` : 'none', transition: 'text-shadow 0.3s' }}>{displayed.toLocaleString()}{suffix}</div>
      <div style={{ fontSize: '0.58rem', color: D.muted, fontFamily: 'var(--font-mono)', letterSpacing: '0.14em', textTransform: 'uppercase', marginTop: 8 }}>{label}</div>
    </div>
  )
}

/* ── Icons ──────────────────────────────────────────────────── */
const IconBulb  = () => <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.1v.2h6v-.2c0-.8.4-1.6 1-2.1A7 7 0 0 0 12 2Z"/></svg>
const IconMap    = () => <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/></svg>
const IconLayers = () => <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>
const IconClock  = () => <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 16 14"/></svg>

/* ── Side breakdown mini-bars ─────────────────────────────────── */
function SideBreakdown({ lhs, rhs, median }: { lhs: number; rhs: number; median: number }) {
  const { colors: D } = useTheme()
  const [ready, setReady] = useState(false)
  useEffect(() => { const t = setTimeout(() => setReady(true), 250); return () => clearTimeout(t) }, [])
  const rows = [
    { name: 'LHS', count: lhs, color: D.amber },
    { name: 'RHS', count: rhs, color: D.blue },
    { name: 'Median', count: median, color: D.green },
  ]
  const max = Math.max(lhs, rhs, median, 1)
  const total = lhs + rhs + median
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%' }}>
      {rows.map((r, i) => (
        <div key={r.name} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ width: 56, fontSize: '0.7rem', color: D.text, fontFamily: 'var(--font-mono)', flexShrink: 0 }}>{r.name}</span>
          <div style={{ flex: 1, height: 7, background: 'rgba(255,255,255,0.04)', borderRadius: 6, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: ready ? `${(r.count / max) * 100}%` : '0%', background: `linear-gradient(90deg, ${r.color}, ${r.color}bb)`, borderRadius: 6, transition: `width 0.9s ${EASE} ${i * 0.08}s` }} />
          </div>
          <span style={{ width: 74, textAlign: 'right', fontSize: '0.7rem', color: r.color, fontWeight: 700, fontFamily: 'var(--font-mono)', flexShrink: 0 }}>{r.count.toLocaleString()}</span>
          <span style={{ width: 34, textAlign: 'right', fontSize: '0.62rem', color: D.sub, fontFamily: 'var(--font-mono)', flexShrink: 0 }}>{total ? Math.round((r.count / total) * 100) : 0}%</span>
        </div>
      ))}
    </div>
  )
}

/* ── Image legend strip — answers "with the images also" independent of
   map zoom/clustering state, since map popups only show one image at a
   time when a single light resolves. ──────────────────────────────── */
function ImageLegend({ variants }: { variants: StreetlightsData['imageVariants'] }) {
  const { colors: D, shadows: SH } = useTheme()
  if (!variants?.length) return null
  return (
    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
      {variants.map(v => (
        <div key={v.variant} style={{ display: 'flex', flexDirection: 'column', gap: 6, width: 130 }}>
          <img src={v.image_url} alt={v.label} loading="lazy" decoding="async"
            style={{ width: '100%', height: 78, objectFit: 'cover', borderRadius: 8, boxShadow: SH.card, border: `1px solid ${D.border}` }} />
          <span style={{ fontSize: '0.6rem', color: D.muted, fontFamily: 'var(--font-mono)', lineHeight: 1.3 }}>{v.label}</span>
        </div>
      ))}
    </div>
  )
}

/* ── Skeleton ───────────────────────────────────────────────── */
function Skel({ h }: { h: number }) {
  const { colors: D } = useTheme()
  return (
    <div style={{ height: h, borderRadius: 16, background: D.panel, position: 'relative', overflow: 'hidden', border: `1px solid ${D.border}` }}>
      <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(90deg, transparent 0%, rgba(212,160,64,0.04) 50%, transparent 100%)', animation: 'shimmer 2s ease-in-out infinite' }} />
    </div>
  )
}
function PageSkeleton() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="kpi-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 14 }}>{[0, 1, 2, 3].map(i => <Skel key={i} h={108} />)}</div>
      <Skel h={140} />
      <Skel h={560} />
    </div>
  )
}

/* ── Main page ──────────────────────────────────────────────── */
function StreetlightsPageInner() {
  const { colors: D } = useTheme()
  const router       = useRouter()
  const searchParams = useSearchParams()
  const [data, setData]       = useState<StreetlightsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState('')
  const [loadStats, setLoadStats] = useState<LoadStats | null>(null)
  const requestIdRef = useRef(0)

  const activeSection = searchParams.get('section') || ''

  // One-time (per section change) fetch for KPIs / section dropdown / image
  // legend — these don't depend on map viewport. StreetlightsMap does its
  // own independent viewport-scoped fetching against the same route, same
  // pattern as HitechMap fetching /api/map independently of /dashboard.
  const loadData = useCallback(() => {
    const reqId = ++requestIdRef.current
    setLoading(true)
    const qs = activeSection ? `?section=${encodeURIComponent(activeSection)}` : ''
    fetch(`/api/streetlights${qs}`)
      .then(r => r.json())
      .then(d => { if (reqId === requestIdRef.current) { setData(d); setLoading(false) } })
      .catch(() => { if (reqId === requestIdRef.current) { setError('Failed to load streetlights data'); setLoading(false) } })
  }, [activeSection])

  useEffect(() => { loadData() }, [loadData])

  function handleFilter(section: string) {
    const p = new URLSearchParams(searchParams.toString())
    if (section) p.set('section', section)
    else p.delete('section')
    router.push(`/streetlights?${p.toString()}`)
  }

  const summary = data?.summary

  return (
    <div style={{ minHeight: '100vh', background: D.bg, color: D.text, fontFamily: 'var(--font-dm-sans)' }}>
      <div style={{ padding: '28px 32px 80px', maxWidth: 1480, margin: '0 auto' }}>
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontFamily: 'var(--font-loader)', fontSize: '1.4rem', letterSpacing: '0.08em', color: D.amber }}>STREETLIGHTS OVERVIEW</div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: D.muted, letterSpacing: '0.08em', marginTop: 4 }}>
            3M-row scale test — clustered map rendering, live load-time readout
          </div>
        </div>

        {error && <div style={{ background: 'rgba(248,113,113,0.06)', border: '1px solid rgba(248,113,113,0.2)', borderRadius: 12, padding: '14px 18px', color: D.red, fontFamily: 'var(--font-mono)', fontSize: '0.78rem', marginBottom: 20 }}>{error}</div>}

        {/* Section filter */}
        {data && (
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end', padding: '16px 20px', background: D.panel, border: `1px solid ${D.border}`, borderRadius: 14, marginBottom: 24 }}>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <div style={{ fontSize: 10, color: D.muted, letterSpacing: 1.5, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', marginBottom: 5 }}>Section</div>
              <select value={activeSection} onChange={e => handleFilter(e.target.value)}
                style={{ background: D.bg, color: D.text, border: `1px solid ${D.border}`, borderRadius: 8, padding: '7px 12px', fontSize: 12, fontFamily: 'var(--font-mono)', cursor: 'pointer', minWidth: 220, outline: 'none' }}>
                <option value=''>All Sections ({(summary?.section_count ?? 0).toLocaleString()})</option>
                {data.sections.map(s => <option key={s.section} value={s.section}>{s.section} ({s.point_count.toLocaleString()})</option>)}
              </select>
            </div>
            {activeSection && <button className="btn-ghost" onClick={() => handleFilter('')}
              style={{ background: 'transparent', color: D.amber, border: '1px solid rgba(212,160,64,0.3)', borderRadius: 8, padding: '7px 18px', fontSize: 12, cursor: 'pointer', fontFamily: 'var(--font-mono)', letterSpacing: 1, alignSelf: 'flex-end', transition: 'all 0.2s' }}>✕ Clear</button>}
          </div>
        )}

        {loading && !data && <PageSkeleton />}

        {data && (
          <div style={{ opacity: loading ? 0.55 : 1, filter: loading ? 'blur(1.5px) saturate(0.85)' : 'blur(0) saturate(1)', transform: loading ? 'scale(0.997)' : 'scale(1)', pointerEvents: loading ? 'none' : 'auto', transition: `opacity 0.35s ${EASE}, filter 0.35s ${EASE}, transform 0.35s ${EASE}` }}>

            <div className="kpi-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 14, marginBottom: 20 }}>
              <KPICard label="Total Streetlights (est.)" value={summary?.total_estimate ?? 0} icon={<IconBulb />} delay={0}   color={D.amber} />
              <KPICard label="Sections"                  value={summary?.section_count ?? 0}  icon={<IconMap />}  delay={80}  color={D.blue} />
              <KPICard label="Points Rendered"            value={loadStats?.count ?? 0}        icon={<IconLayers />} delay={160} color={D.green} />
              <div style={{ background: D.panel, borderRadius: 22, padding: '20px 22px', position: 'relative', overflow: 'hidden', border: `1px solid ${D.border}`, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                <div style={{ width: 44, height: 44, borderRadius: 14, background: `${D.purple}20`, border: `1px solid ${D.purple}35`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: D.purple, marginBottom: 16 }}><IconClock /></div>
                {loadStats ? (
                  <>
                    <div style={{ fontFamily: 'var(--font-loader)', fontSize: '1.5rem', fontWeight: 400, lineHeight: 1, letterSpacing: '0.03em', color: D.purple }}>
                      {loadStats.queryMs}ms <span style={{ fontSize: '0.9rem', color: D.sub }}>db</span> / {loadStats.clientMs}ms <span style={{ fontSize: '0.9rem', color: D.sub }}>total</span>
                    </div>
                    <div style={{ fontSize: '0.58rem', color: D.muted, fontFamily: 'var(--font-mono)', letterSpacing: '0.1em', textTransform: 'uppercase', marginTop: 8 }}>
                      Load Time · {loadStats.mode === 'live' ? 'live query' : 'materialized view'}
                    </div>
                  </>
                ) : (
                  <div style={{ fontSize: '0.7rem', color: D.sub, fontFamily: 'var(--font-mono)' }}>waiting for map…</div>
                )}
              </div>
            </div>

            <Reveal style={{ marginBottom: 16 }}>
              <div className="sl-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <Panel title="Side Breakdown">
                  <SideBreakdown lhs={summary?.lhs_count ?? 0} rhs={summary?.rhs_count ?? 0} median={summary?.median_count ?? 0} />
                </Panel>
                <Panel title="Streetlight Image Reference">
                  <ImageLegend variants={data.imageVariants} />
                </Panel>
              </div>
            </Reveal>

            <Reveal delay={80}>
              <Panel title={`Map${activeSection ? ` · ${activeSection}` : ''}`}>
                <StreetlightsMap section={activeSection} onLoadStats={setLoadStats} />
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
        @media (max-width: 1180px) { .kpi-grid { grid-template-columns: repeat(2,1fr) !important; } }
        @media (max-width: 480px)  { .kpi-grid { grid-template-columns: repeat(1,1fr) !important; } }
        @media (max-width: 900px)  { .sl-grid { grid-template-columns: 1fr !important; } }
      `}</style>
    </div>
  )
}

export default function StreetlightsPage() {
  const { colors: D } = useTheme()
  return (
    <Suspense fallback={<div style={{ minHeight: '100vh', background: D.bg, padding: '28px 32px 60px' }}><PageSkeleton /></div>}>
      <StreetlightsPageInner />
    </Suspense>
  )
}
