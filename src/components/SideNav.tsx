'use client'

import { useState } from 'react'
import { usePathname } from 'next/navigation'
import { useTheme, ColorTokens } from '@/lib/theme'
import { useSidebar } from '@/lib/sidebar'
import { SIDEBAR_WIDTH, SIDEBAR_WIDTH_COLLAPSED } from '@/lib/theme-constants'

/* ── icons (lucide-approximate) ────────────────────────────── */
const mk = (d: React.ReactNode) => () => (
  <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>{d}</svg>
)
const IconDashboard = mk(<><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /></>)
const IconTruck = mk(<><path d="M14 18V6a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h1" /><path d="M14 9h4l4 4v4a1 1 0 0 1-1 1h-1" /><circle cx="7" cy="18" r="2" /><circle cx="17" cy="18" r="2" /></>)
const IconPeople = mk(<><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></>)
const IconTrending = mk(<><path d="M3 3v18h18" /><path d="m19 9-5 5-4-4-3 3" /></>)
const IconClipboard = mk(<><rect x="8" y="2" width="8" height="4" rx="1" /><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" /><path d="m9 14 2 2 4-4" /></>)
const IconLayers = mk(<><polygon points="12 2 22 8.5 12 15 2 8.5 12 2" /><polyline points="2 15.5 12 22 22 15.5" /><polyline points="2 12 12 18.5 22 12" /></>)
const IconSatellite = mk(<><path d="m13 7 4 4-6.5 6.5a4.95 4.95 0 1 1-7-7L10 4l4 4" /><path d="m14.5 4.5 5 5" /><path d="m21 3-3.5 3.5" /><path d="m3 21 3.5-3.5" /></>)

type NavItem = { label: string; href: string; icon: () => React.ReactElement; color: string }
type NavGroup = { label: string; items: NavItem[] }

// A distinct vivid colour per item — always visible (not just on hover/
// active), so the rail reads as colourful at rest rather than a monochrome
// gold-on-navy list. Confirmed with the user via a reference marketing
// dashboard screenshot showing exactly this convention (each KPI/nav-style
// icon its own bright hue) — 2026-09-19 "brighter colours / bland sidebar"
// follow-up. Kept local to this file rather than the shared theme tokens,
// since these are per-item identity colours, not a semantic/theme concept.
const NAV_VIVID = {
  purple: '#8b5cf6', cyan: '#06b6d4', rose: '#f43f5e', orange: '#f97316',
  blue: '#3b82f6', teal: '#14b8a6',
}

const NAV: NavGroup[] = [
  { label: 'Overview', items: [
    { label: 'Dashboard', href: '/dashboard', icon: IconDashboard, color: NAV_VIVID.purple },
  ]},
  { label: 'Field Activity', items: [
    { label: 'Machines', href: '/machines', icon: IconTruck, color: NAV_VIVID.orange },
    { label: 'Personnel', href: '/personnel', icon: IconPeople, color: NAV_VIVID.rose },
  ]},
  { label: 'Planning', items: [
    { label: 'Progress', href: '/progress', icon: IconTrending, color: NAV_VIVID.cyan },
    { label: 'Planning & Implementation', href: '/planning-implementation', icon: IconClipboard, color: NAV_VIVID.blue },
  ]},
  { label: 'Coverage', items: [
    { label: 'Asset Coverage', href: '/road-assets-coverage', icon: IconLayers, color: NAV_VIVID.teal },
    { label: 'Road Corridors', href: '/road-corridors', icon: IconSatellite, color: NAV_VIVID.purple },
  ]},
]

function NavButton({ item, active, collapsed, D, onNavigate }: {
  item: NavItem; active: boolean; collapsed: boolean; D: ColorTokens; onNavigate: () => void
}) {
  const [hov, setHov] = useState(false)
  const Icon = item.icon
  const c = item.color
  return (
    <a href={item.href} title={collapsed ? item.label : undefined} onClick={onNavigate}
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{
        position: 'relative',
        display: 'flex', alignItems: 'center', gap: 10, width: '100%',
        padding: collapsed ? '7px 0' : '7px 10px', borderRadius: 8,
        justifyContent: collapsed ? 'center' : 'flex-start',
        fontSize: 13, fontWeight: active ? 600 : 500, lineHeight: 1.2,
        letterSpacing: active ? '-0.01em' : 0,
        color: active ? D.text : hov ? D.text : D.muted,
        background: active ? `${c}1c` : hov ? D.panel2 : 'transparent',
        boxShadow: active && !collapsed ? `inset 3px 0 0 ${c}` : 'none',
        textDecoration: 'none', whiteSpace: 'nowrap',
        transition: 'background 0.15s ease, color 0.15s ease, box-shadow 0.15s ease',
      }}>
      <span style={{
        flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
        width: 26, height: 26, borderRadius: 7, color: c,
        background: `${c}20`, border: `1px solid ${c}38`,
        transition: 'transform 0.15s ease, background 0.15s ease',
        transform: hov && !active ? 'translateX(1px) scale(1.04)' : 'none',
      }}><Icon /></span>
      {!collapsed && <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.label}</span>}
      {!collapsed && active && <span style={{ width: 5, height: 5, borderRadius: '50%', background: c, flexShrink: 0 }} />}
    </a>
  )
}

export default function SideNav() {
  const pathname = usePathname()
  const { theme, colors: D, shadows: SH } = useTheme()
  const { collapsed, isMobile, mobileOpen, setMobileOpen } = useSidebar()

  if (pathname === '/login') return null

  const isCollapsed = collapsed && !isMobile
  const width = isMobile ? '18rem' : isCollapsed ? SIDEBAR_WIDTH_COLLAPSED : SIDEBAR_WIDTH
  // Subtly navy-tinted rather than a flat neutral, so the rail reads as part
  // of the navy/gold system rather than a plain grey shell (2026-09-19).
  const railBg = theme === 'light' ? '#f6f8fb' : '#0a1424'
  const railShadow = theme === 'light'
    ? '1px 0 0 rgba(14,21,28,.05), 6px 0 28px -14px rgba(14,21,28,.14)'
    : '1px 0 0 rgba(0,0,0,.5), 8px 0 32px -16px rgba(0,0,0,.6)'

  const rail = (
    <aside aria-label="Primary" style={{
      display: 'flex', flexDirection: 'column', flexShrink: 0,
      width, background: railBg, borderRight: `1px solid ${D.border}`,
      transition: 'width 0.18s ease, transform 0.2s ease',
      // Always fixed — the rail is out of the document flow so it can never
      // scroll or shift with the page content. On mobile it's an overlay
      // drawer; on desktop it's a permanent top-to-bottom rail.
      position: 'fixed', top: 0, bottom: 0, left: 0, height: '100vh',
      zIndex: isMobile ? 120 : 40,
      boxShadow: isMobile ? (mobileOpen ? SH.cardLg : 'none') : railShadow,
      ...(isMobile
        ? { transform: mobileOpen ? 'translateX(0)' : 'translateX(-100%)' }
        : {}),
    } as React.CSSProperties}>
      {/* brand — a two-line lockup (logo + wordmark + gold mono subtitle)
         mirroring the login page's own brand treatment, replacing the plain
         single-line label (2026-09-19 sidebar polish pass). */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, minHeight: '3.5rem', flexShrink: 0,
        padding: isCollapsed ? '10px 0' : '10px .85rem', justifyContent: isCollapsed ? 'center' : 'flex-start',
        borderBottom: `1px solid ${D.border}`,
      }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.jpg" alt="Hitech" style={{ width: isCollapsed ? 24 : 30, height: isCollapsed ? 24 : 30, borderRadius: 7, flexShrink: 0, boxShadow: `0 0 0 1px ${D.amber}33` }} />
        {!isCollapsed && (
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 700, letterSpacing: '-0.01em', fontSize: 14, color: D.text, whiteSpace: 'nowrap', lineHeight: 1.2 }}>
              Hitech Analytics
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase', color: D.amber, marginTop: 1 }}>
              Dashboard
            </div>
          </div>
        )}
      </div>

      {/* groups */}
      <nav style={{ flex: 1, overflowY: 'auto', padding: '12px 8px 16px', display: 'flex', flexDirection: 'column', gap: 4 }}>
        {NAV.map((group, gi) => (
          <div key={group.label} style={{ paddingTop: gi === 0 ? 0 : 10, marginTop: gi === 0 ? 0 : 6, borderTop: gi === 0 ? 'none' : `1px solid ${D.border}` }}>
            <div style={{
              fontFamily: 'var(--font-mono)', fontSize: 10.5, fontWeight: 600, letterSpacing: '0.13em',
              textTransform: 'uppercase', color: D.sub, padding: isCollapsed ? '6px 0 5px' : '6px 8px 5px',
              textAlign: isCollapsed ? 'center' : 'left', whiteSpace: 'nowrap', overflow: 'hidden',
            }}>
              {isCollapsed ? '·' : group.label}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              {group.items.map(item => (
                <NavButton key={item.href} item={item}
                  active={pathname === item.href || pathname.startsWith(item.href + '/')}
                  collapsed={isCollapsed} D={D}
                  onNavigate={() => { if (isMobile) setMobileOpen(false) }} />
              ))}
            </div>
          </div>
        ))}
      </nav>
    </aside>
  )

  if (isMobile) {
    return (
      <>
        <div onClick={() => setMobileOpen(false)} aria-hidden style={{
          position: 'fixed', inset: 0, zIndex: 110, background: 'rgba(4,10,18,0.46)',
          opacity: mobileOpen ? 1 : 0, pointerEvents: mobileOpen ? 'auto' : 'none',
          transition: 'opacity 0.2s ease',
        }} />
        {rail}
      </>
    )
  }
  return rail
}
