'use client'

import { useState } from 'react'
import { usePathname } from 'next/navigation'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { useTheme, GLASS } from '@/lib/theme'
import { useSidebar } from '@/lib/sidebar'

/* ── icons (lucide-approximate) ────────────────────────────── */
const mk = (d: React.ReactNode) => () => (
  <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>{d}</svg>
)
const IconDashboard = mk(<><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /></>)
const IconTruck = mk(<><path d="M14 18V6a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h1" /><path d="M14 9h4l4 4v4a1 1 0 0 1-1 1h-1" /><circle cx="7" cy="18" r="2" /><circle cx="17" cy="18" r="2" /></>)
const IconPeople = mk(<><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></>)
const IconTrending = mk(<><path d="M3 3v18h18" /><path d="m19 9-5 5-4-4-3 3" /></>)
const IconClipboard = mk(<><rect x="8" y="2" width="8" height="4" rx="1" /><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" /><path d="m9 14 2 2 4-4" /></>)
const IconLayers = mk(<><polygon points="12 2 22 8.5 12 15 2 8.5 12 2" /><polyline points="2 15.5 12 22 22 15.5" /><polyline points="2 12 12 18.5 22 12" /></>)
const IconSatellite = mk(<><path d="m13 7 4 4-6.5 6.5a4.95 4.95 0 1 1-7-7L10 4l4 4" /><path d="m14.5 4.5 5 5" /><path d="m21 3-3.5 3.5" /><path d="m3 21 3.5-3.5" /></>)

type NavItem = { label: string; group: string; href: string; icon: () => React.ReactElement }

// Group names survive as the tooltip's caption (the pill has no room for headers).
const NAV: NavItem[] = [
  { label: 'Dashboard', group: 'Overview', href: '/dashboard', icon: IconDashboard },
  { label: 'Machines', group: 'Field Activity', href: '/machines', icon: IconTruck },
  { label: 'Personnel', group: 'Field Activity', href: '/personnel', icon: IconPeople },
  { label: 'Progress', group: 'Planning', href: '/progress', icon: IconTrending },
  { label: 'Planning & Implementation', group: 'Planning', href: '/planning-implementation', icon: IconClipboard },
  { label: 'Asset Coverage', group: 'Coverage', href: '/road-assets-coverage', icon: IconLayers },
  { label: 'Road Corridors', group: 'Coverage', href: '/road-corridors', icon: IconSatellite },
]

const SPRING = { type: 'spring', stiffness: 420, damping: 32 } as const

/**
 * Floating glass icon pill (2026-10-05 glass redesign). Desktop: vertical,
 * centred on the left edge, label tooltip on hover/focus. Mobile (<768px):
 * a bottom tab pill — the platform convention for primary nav on phones.
 * The white "active" disc slides between items via a shared layoutId.
 */
export default function SideNav() {
  const pathname = usePathname()
  const { colors: D, shadows: SH, theme } = useTheme()
  const dark = theme === 'dark'
  const { isMobile } = useSidebar()
  const reduce = useReducedMotion()
  const [hov, setHov] = useState<string | null>(null)

  if (pathname === '/login') return null

  return (
    <motion.nav aria-label="Primary"
      initial={reduce ? false : { opacity: 0, x: isMobile ? 0 : -16, y: isMobile ? 16 : 0 }}
      animate={{ opacity: 1, x: 0, y: 0 }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      style={{
        position: 'fixed', zIndex: 100,
        ...(isMobile
          ? { left: '50%', bottom: 14, translateX: '-50%', flexDirection: 'row' as const }
          : { left: 16, top: '50%', translateY: '-50%', flexDirection: 'column' as const }),
        display: 'flex', alignItems: 'center', gap: 6, padding: 6,
        background: D.panel, backdropFilter: GLASS, WebkitBackdropFilter: GLASS,
        border: `1px solid ${D.border}`, borderRadius: 999, boxShadow: SH.cardLg,
      }}>
      {!isMobile && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src="/logo.jpg" alt="Hitech" style={{ width: 36, height: 36, borderRadius: '50%', margin: '2px 0 6px', boxShadow: `0 0 0 1px ${D.border}` }} />
      )}
      {NAV.map(item => {
        const active = pathname === item.href || pathname.startsWith(item.href + '/')
        const Icon = item.icon
        const showTip = !isMobile && hov === item.href
        return (
          <a key={item.href} href={item.href} aria-label={item.label} aria-current={active ? 'page' : undefined}
            onMouseEnter={() => setHov(item.href)} onMouseLeave={() => setHov(null)}
            onFocus={() => setHov(item.href)} onBlur={() => setHov(null)}
            style={{ position: 'relative', display: 'flex', width: 44, height: 44, borderRadius: '50%', textDecoration: 'none' }}>
            {active && (
              <motion.span layoutId="nav-active" transition={SPRING}
                style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: D.text, boxShadow: '0 4px 14px rgba(0,0,0,.35)' }} />
            )}
            <motion.span
              whileHover={reduce ? undefined : { scale: 1.1 }} whileTap={reduce ? undefined : { scale: 0.92 }} transition={SPRING}
              style={{
                position: 'relative', flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '50%',
                color: active ? (dark ? '#111114' : '#fff') : D.text,
                background: !active && hov === item.href ? D.panel2 : 'transparent',
                transition: 'background .15s ease, color .15s ease',
              }}>
              <Icon />
            </motion.span>
            <AnimatePresence>
              {showTip && (
                <motion.span role="tooltip"
                  initial={{ opacity: 0, x: -6, scale: 0.96 }} animate={{ opacity: 1, x: 0, scale: 1 }} exit={{ opacity: 0, x: -6, scale: 0.96 }}
                  transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
                  style={{
                    position: 'absolute', left: 'calc(100% + 14px)', top: '50%', translateY: '-50%', pointerEvents: 'none',
                    whiteSpace: 'nowrap', padding: '6px 11px', borderRadius: 10,
                    background: dark ? 'rgba(24,24,28,0.82)' : 'rgba(255,255,255,0.9)', backdropFilter: GLASS, WebkitBackdropFilter: GLASS,
                    border: `1px solid ${D.border}`, boxShadow: SH.card, color: D.text,
                    display: 'flex', flexDirection: 'column', lineHeight: 1.25,
                  }}>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{item.label}</span>
                  <span style={{ fontSize: 10.5, color: D.muted }}>{item.group}</span>
                </motion.span>
              )}
            </AnimatePresence>
          </a>
        )
      })}
    </motion.nav>
  )
}
