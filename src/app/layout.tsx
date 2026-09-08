import type { Metadata } from 'next'
import Script from 'next/script'
import { Space_Grotesk, Fira_Sans, JetBrains_Mono } from 'next/font/google'
import './globals.css'
import AppShell from '@/components/AppShell'
import { ThemeProvider } from '@/lib/theme'
import { SidebarProvider } from '@/lib/sidebar'
import { THEME_STORAGE_KEY } from '@/lib/theme-constants'

// Runs before hydration so there is no flash of the wrong theme. Resolves
// the stored MODE ('light' | 'dark' | 'system', default 'system') down to
// an explicit data-theme of 'light' | 'dark' — CSS only keys on [data-theme].
const THEME_INIT_SCRIPT = `try{var m=localStorage.getItem('${THEME_STORAGE_KEY}')||'system';var d=m==='dark'||(m==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.dataset.theme=d?'dark':'light';}catch(e){document.documentElement.dataset.theme='light';}`

const fontDisplay = Space_Grotesk({ variable: '--font-space-grotesk', subsets: ['latin'], weight: ['400', '500', '600', '700'], display: 'swap' })
const fontBody = Fira_Sans({ variable: '--font-fira-sans', subsets: ['latin'], weight: ['300', '400', '500', '600', '700'], display: 'swap' })
const fontMono = JetBrains_Mono({ variable: '--font-jetbrains-mono', subsets: ['latin'], weight: ['400', '500', '600', '700'], display: 'swap' })

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
      <body className={`${fontDisplay.variable} ${fontBody.variable} ${fontMono.variable}`} suppressHydrationWarning>
        <ThemeProvider>
          <SidebarProvider>
            <AppShell>{children}</AppShell>
          </SidebarProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
