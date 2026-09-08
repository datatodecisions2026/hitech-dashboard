'use client'

import { usePathname } from 'next/navigation'
import DashHeader from './DashHeader'
import SideNav from './SideNav'
import { useSidebar } from '@/lib/sidebar'
import { useTheme } from '@/lib/theme'
import { SIDEBAR_WIDTH, SIDEBAR_WIDTH_COLLAPSED } from '@/lib/theme-constants'

/**
 * The app frame: a genuinely fixed rail on the left (out of the scroll
 * flow entirely — it never moves with the page) and a content column that
 * simply reserves the rail's width as a left margin. On mobile the rail
 * becomes an overlay drawer, so the content column reclaims the full width.
 */
export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const { collapsed, isMobile } = useSidebar()
  const { colors: D } = useTheme()

  const bare = pathname === '/login'
  const railWidth = bare || isMobile ? '0px' : collapsed ? SIDEBAR_WIDTH_COLLAPSED : SIDEBAR_WIDTH

  return (
    <div style={{ minHeight: '100vh', background: D.bg, color: D.text }}>
      <SideNav />
      <div
        style={{
          marginLeft: railWidth,
          minWidth: 0,
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          transition: 'margin-left 0.18s ease',
        }}
      >
        <DashHeader />
        {children}
      </div>
    </div>
  )
}
