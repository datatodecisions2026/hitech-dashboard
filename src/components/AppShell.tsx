'use client'

import { usePathname } from 'next/navigation'
import DashHeader from './DashHeader'
import SideNav from './SideNav'
import { useSidebar } from '@/lib/sidebar'
import { useTheme } from '@/lib/theme'
import Waves from './Waves'

/**
 * The app frame: a fixed full-bleed background photo (`.app-bg`, see
 * globals.css — drop the real image at /public/bg.jpg), the floating glass
 * nav pill, and a content column that clears the pill (left on desktop,
 * bottom on mobile). Glass surfaces blur whatever sits under them here.
 */
export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const { isMobile } = useSidebar()
  const { colors: D, theme } = useTheme()
  const bare = pathname === '/login'

  return (
    <div style={{ minHeight: '100vh', color: D.text }}>
      <div className="app-bg" aria-hidden>
        <Waves lineColor={theme === 'dark' ? 'rgba(255,255,255,0.13)' : 'rgba(20,24,40,0.14)'}
          waveSpeedX={0.02} waveSpeedY={0.01} waveAmpX={40} waveAmpY={20}
          friction={0.9} tension={0.01} maxCursorMove={120} xGap={12} yGap={36} />
      </div>
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
