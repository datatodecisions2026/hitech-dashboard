import type { Metadata } from 'next'
import Script from 'next/script'
import { DM_Sans, DM_Mono, Bebas_Neue } from 'next/font/google'
import './globals.css'
import DashHeader from '@/components/DashHeader'
import SideNav from '@/components/SideNav'
import { ThemeProvider } from '@/lib/theme'
import { THEME_STORAGE_KEY } from '@/lib/theme-constants'

// Sets data-theme on <html> before hydration so there's no flash of the
// wrong theme on load. Deliberately does NOT fall back to the OS's
// prefers-color-scheme — the user's saved choice (or dark, the app's
// original default) always wins.
const THEME_INIT_SCRIPT = `try{var t=localStorage.getItem('${THEME_STORAGE_KEY}');document.documentElement.dataset.theme=(t==='light'||t==='dark')?t:'dark';}catch(e){document.documentElement.dataset.theme='dark';}`

const dmSans = DM_Sans({
  variable: '--font-dm-sans',
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700', '800'],
})

const dmMono = DM_Mono({
  variable: '--font-dm-mono',
  subsets: ['latin'],
  weight: ['300', '400', '500'],
})

const bebasNeue = Bebas_Neue({
  variable: '--font-loader',
  subsets: ['latin'],
  weight: '400',
})

export const metadata: Metadata = {
  title: 'Hitech Analytics',
  description: 'Activity Analytics — Hitech Construction Ltd',
  icons: { icon: '/logo.jpg', apple: '/logo.jpg' },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link href='https://api.mapbox.com/mapbox-gl-js/v3.3.0/mapbox-gl.css' rel='stylesheet' />
        <Script id="theme-init" strategy="beforeInteractive">{THEME_INIT_SCRIPT}</Script>
      </head>
      <body className={`${dmSans.variable} ${dmMono.variable} ${bebasNeue.variable}`} suppressHydrationWarning>
        <ThemeProvider>
          <DashHeader />
          <div style={{ display: 'flex', alignItems: 'stretch', minHeight: 'calc(100vh - 52px)' }}>
            <SideNav />
            <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
          </div>
        </ThemeProvider>
      </body>
    </html>
  )
}
