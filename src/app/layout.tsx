import type { Metadata } from 'next'
import Script from 'next/script'
import { Geist, Geist_Mono } from 'next/font/google'
import './globals.css'
import DashHeader from '@/components/DashHeader'
import SideNav from '@/components/SideNav'
import { ThemeProvider } from '@/lib/theme'
import { SidebarProvider } from '@/lib/sidebar'
import { THEME_STORAGE_KEY } from '@/lib/theme-constants'

// Runs before hydration so there is no flash of the wrong theme. Resolves
// the stored MODE ('light' | 'dark' | 'system', default 'system') down to
// an explicit data-theme of 'light' | 'dark' — CSS only keys on [data-theme].
const THEME_INIT_SCRIPT = `try{var m=localStorage.getItem('${THEME_STORAGE_KEY}')||'system';var d=m==='dark'||(m==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.dataset.theme=d?'dark':'light';}catch(e){document.documentElement.dataset.theme='light';}`

const geist = Geist({ variable: '--font-geist', subsets: ['latin'] })
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Hitech Analytics',
  description: 'Activity Analytics — Hitech Construction Ltd',
  icons: { icon: '/logo.jpg', apple: '/logo.jpg' },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <Script id="theme-init" strategy="beforeInteractive">{THEME_INIT_SCRIPT}</Script>
      </head>
      <body className={`${geist.variable} ${geistMono.variable}`} suppressHydrationWarning>
        <ThemeProvider>
          <SidebarProvider>
            <div style={{ display: 'flex', alignItems: 'flex-start', minHeight: '100vh' }}>
              <SideNav />
              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                <DashHeader />
                {children}
              </div>
            </div>
          </SidebarProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
