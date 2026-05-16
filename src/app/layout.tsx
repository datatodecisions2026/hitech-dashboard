import type { Metadata } from 'next'
import { DM_Sans, DM_Mono, Bebas_Neue } from 'next/font/google'
import './globals.css'
import DashHeader from '@/components/DashHeader'

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
    <html lang="en">
      <head>
        <link href='https://api.mapbox.com/mapbox-gl-js/v3.3.0/mapbox-gl.css' rel='stylesheet' />
      </head>
      <body className={`${dmSans.variable} ${dmMono.variable} ${bebasNeue.variable}`}>
        <DashHeader />
        {children}
      </body>
    </html>
  )
}
