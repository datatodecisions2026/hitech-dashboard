'use client'

import { useState } from 'react'
import { usePathname } from 'next/navigation'
import { useTheme, ColorTokens } from '@/lib/theme'
import { useSidebar } from '@/lib/sidebar'

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

type NavItem = { label: string; href: string; icon: () => React.ReactElement }
type NavGroup = { label: string; items: NavItem[] }

const NAV: NavGroup[] = [
  { label: 'Overview', items: [
    { label: 'Dashboard', href: '/dashboard', icon: IconDashboard },
  ]},
  { label: 'Field Activity', items: [
    { label: 'Machines', href: '/machines', icon: IconTruck },
    { label: 'Personnel', href: '/personnel', icon: IconPeople },
  ]},
  { label: 'Planning', items: [
    { label: 'Progress', href: '/progress', icon: IconTrending },
    { label: 'Planning & Implementation', href: '/planning-implementation', icon: IconClipboard },
  ]},
  { label: 'Coverage', items: [
    { label: 'Asset Coverage', href: '/road-assets-coverage', icon: IconLayers },
  ]},
]

function NavButton({ item, active, collapsed, D, onNavigate }: {
  item: NavItem; active: boolean; collapsed: boolean; D: ColorTokens; onNavigate: () => void
}) {
  const [hov, setHov] = useState(false)
  const Icon = item.icon
  return (
    <a href={item.href} title={collapsed ? item.label : undefined} onClick={onNavigate}
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 10, width: '100%',
        padding: collapsed ? '7px 0' : '7px 9px', borderRadius: 8,
        justifyContent: collapsed ? 'center' : 'flex-start',
        fontSize: 13, fontWeight: active ? 600 : 500, lineHeight: 1.2,
        color: active ? D.amber : hov ? D.text : D.muted,
        background: active ? `${D.amber}1a` : hov ? D.panel2 : 'transparent',
        textDecoration: 'none', whiteSpace: 'nowrap',
        transition: 'background 0.15s ease, color 0.15s ease',
      }}>
      <span style={{ flexShrink: 0, display: 'flex' }}><Icon /></span>
      {!collapsed && <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.label}</span>}
    </a>
  )
}

export default function SideNav() {
  const pathname = usePathname()
  const { theme, colors: D, shadows: SH } = useTheme()
  const { collapsed, isMobile, mobileOpen, setMobileOpen } = useSidebar()

  if (pathname === '/login') return null

  const isCollapsed = collapsed && !isMobile
  const width = isMobile ? '18rem' : isCollapsed ? '3rem' : '16rem'
  const railBg = theme === 'light' ? '#fbfcfd' : '#0d1319'

  const rail = (
    <aside aria-label="Primary" style={{
      display: 'flex', flexDirection: 'column', flexShrink: 0,
      width, background: railBg, borderRight: `1px solid ${D.border}`,
      transition: 'width 0.18s ease, transform 0.2s ease',
      ...(isMobile
        ? {
            position: 'fixed', top: 0, bottom: 0, left: 0, zIndex: 120,
            transform: mobileOpen ? 'translateX(0)' : 'translateX(-100%)',
            boxShadow: mobileOpen ? SH.cardLg : 'none',
          }
        : { position: 'sticky', top: 0, height: '100vh', zIndex: 40 }),
    } as React.CSSProperties}>
      {/* brand */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 9, height: '3.5rem', flexShrink: 0,
        padding: isCollapsed ? 0 : '0 .75rem', justifyContent: isCollapsed ? 'center' : 'flex-start',
        borderBottom: `1px solid ${D.border}`,
      }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.jpg" alt="Hitech" style={{ width: 22, height: 22, borderRadius: 6, flexShrink: 0 }} />
        {!isCollapsed && (
          <span style={{ fontWeight: 600, letterSpacing: '-0.01em', fontSize: 14, color: D.text, whiteSpace: 'nowrap' }}>
            Hitech Analytics
          </span>
        )}
      </div>

      {/* groups */}
      <nav style={{ flex: 1, overflowY: 'auto', padding: '10px 8px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {NAV.map(group => (
          <div key={group.label}>
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
