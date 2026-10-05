'use client'

import { usePathname } from 'next/navigation'
import DashHeader from './DashHeader'
import SideNav from './SideNav'
import { useSidebar } from '@/lib/sidebar'
import { useTheme } from '@/lib/theme'

/**
 * The app frame: a fixed full-bleed background photo (`.app-bg`, see
 * globals.css — drop the real image at /public/bg.jpg), the floating glass
 * nav pill, and a content column that clears the pill (left on desktop,
 * bottom on mobile). Glass surfaces blur whatever sits under them here.
 */
export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const { isMobile } = useSidebar()
  const { colors: D } = useTheme()
  const bare = pathname === '/login'

  return (
    <div style={{ minHeight: '100vh', color: D.text }}>
      <div className="app-bg" aria-hidden />
      <SideNav />
      <div style={{
        position: 'relative', zIndex: 1,
        marginLeft: bare || isMobile ? 0 : 88,
        paddingBottom: !bare && isMobile ? 84 : 0,
        minWidth: 0, minHeight: '100vh', display: 'flex', flexDirection: 'column',
      }}>
        <DashHeader />
        {children}
      </div>
    </div>
  )
}
