'use client'

import { useEffect, useState } from 'react'
import { GLASS, type ColorTokens } from '@/lib/theme'

/* ── hero banner (navy cover-page style, real site photos) ──
   Built for /dashboard 2026-09-19 (see that page's changelog history),
   extracted into a shared component 2026-09-24 so /machines and /personnel
   could carry the same header — direct ask, "can this header be retained
   across the machine and personnels page?" Real photos come from the same
   data.mediaItems the Media Gallery/report feed already fetch — no new
   query on any page that already loads /api/dashboard/extra. */

export const WEATHER_ICON: Record<string, string> = {
  Sunny: '☀', Clear: '☀', 'Sunny/Cloudy': '🌤', Sunny_cloudy: '🌤',
  Cloudy: '🌥', Overcast: '⛅', Rainy: '🌧', Rain: '🌧',
  Stormy: '⛈', Windy: '💨', Unknown: '—',
}

function useCrossfade(count: number, intervalMs: number) {
  const [idx, setIdx] = useState(0)
  useEffect(() => {
    if (count <= 1) return
    const t = setInterval(() => setIdx(i => (i + 1) % count), intervalMs)
    return () => clearInterval(t)
  }, [count, intervalMs])
  return idx
}

const HERO_NAV = [
  { icon: '📋', label: 'Reports',    href: '/dashboard' },
  { icon: '📈', label: 'Progress',   href: '/progress' },
  { icon: '👷', label: 'Personnel',  href: '/personnel' },
  { icon: '🛰', label: 'Coverage',   href: '/road-assets-coverage' },
]

export function HeroBanner({ D, title, greeting, firstName, photos, stat, weather }: {
  D: ColorTokens
  /** Small caps label above the greeting, e.g. "Field Activity Overview". */
  title?: string
  greeting: string
  firstName: string
  photos: string[]
  stat: string
  weather?: string
}) {
  const idx = useCrossfade(photos.length, 7000)
  return (
    <div className="hero-banner" style={{
      position: 'relative', borderRadius: 24, overflow: 'hidden', marginBottom: 20,
      minHeight: 220, display: 'flex', background: D.panel, backdropFilter: GLASS, WebkitBackdropFilter: GLASS,
      border: `1px solid ${D.border}`, boxShadow: 'inset 0 1px 0 rgba(255,255,255,.12), 0 18px 48px -12px rgba(0,0,0,.55)',
    }}>
      {photos.map((src, i) => (
        <img key={src} src={src} alt="" style={{
          position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover',
          opacity: i === idx ? 1 : 0, transition: 'opacity 1.4s ease',
          filter: 'brightness(0.78) saturate(1.05)',
        }} />
      ))}
      <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(100deg, rgba(16,16,20,.88) 0%, rgba(16,16,20,.6) 42%, rgba(16,16,20,.15) 78%, transparent 100%)' }} />

      <div style={{ position: 'relative', zIndex: 1, padding: '28px 32px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', flex: 1, color: '#fff', minWidth: 0 }}>
        <div>
          <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', letterSpacing: 2, color: D.amberL, textTransform: 'uppercase' }}>{title || 'Field Activity Overview'}</span>
          <h2 style={{ margin: '6px 0 0', fontSize: 26, fontWeight: 700, letterSpacing: '-0.02em' }}>{greeting}{firstName ? `, ${firstName}` : ''}</h2>
          <p style={{ margin: '6px 0 0', fontSize: 13.5, color: 'rgba(255,255,255,0.78)', maxWidth: 420 }}>{stat}</p>
        </div>
        {weather && (
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.22)', borderRadius: 999, padding: '6px 14px', alignSelf: 'flex-start', backdropFilter: GLASS, WebkitBackdropFilter: GLASS }}>
            <span style={{ fontSize: '1.1rem', lineHeight: 1 }}>{WEATHER_ICON[weather] || '🌡'}</span>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600 }}>{weather}</div>
              <div style={{ fontSize: 9.5, color: 'rgba(255,255,255,0.62)', fontFamily: 'var(--font-mono)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Latest logged</div>
            </div>
          </div>
        )}
      </div>

      <div className="hero-nav" style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 13, padding: '28px 28px', borderLeft: '1px solid rgba(255,255,255,0.16)', minWidth: 150, flexShrink: 0 }}>
        {HERO_NAV.map(b => (
          <a key={b.label} href={b.href} style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none', color: '#fff' }}>
            <span style={{ width: 32, height: 32, borderRadius: '50%', background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.2)', backdropFilter: GLASS, WebkitBackdropFilter: GLASS, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, flexShrink: 0 }}>{b.icon}</span>
            <span style={{ fontSize: 11.5, fontFamily: 'var(--font-mono)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>{b.label}</span>
          </a>
        ))}
      </div>

      <style>{`
        @media (max-width: 760px) {
          .hero-banner { flex-direction: column; min-height: 0; }
          .hero-nav { flex-direction: row; flex-wrap: wrap; border-left: none; border-top: 1px solid rgba(255,255,255,0.16); padding: 16px 20px !important; gap: 16px !important; }
        }
      `}</style>
    </div>
  )
}
