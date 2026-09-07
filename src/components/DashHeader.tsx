'use client'

import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { useTheme } from '@/lib/theme'
import ThemeToggle from './ThemeToggle'

interface SessionUser {
  first_name: string
  last_name: string
  email: string
}

export default function DashHeader() {
  const router   = useRouter()
  const pathname = usePathname()
  const { theme, colors: D } = useTheme()
  const isLight = theme === 'light'
  const [user, setUser]           = useState<SessionUser | null>(null)
  const [hovLogout, setHovLogout] = useState(false)

  useEffect(() => {
    fetch('/api/auth/me')
      .then(r => {
        if (r.status === 401) { router.replace('/login'); return null }
        return r.json()
      })
      .then(d => { if (d?.user) setUser(d.user) })
      .catch(() => router.replace('/login'))
  }, [router])

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' })
    router.replace('/login')
  }

  const NAV_LINKS = [
    { label: 'Dashboard',    href: '/dashboard'    },
    { label: 'Progress',     href: '/progress'     },
    { label: 'Machines',     href: '/machines'     },
    { label: 'Personnel',    href: '/personnel'    },
    { label: 'Planning & Implementation', href: '/planning-implementation' },
    { label: 'Asset Coverage', href: '/road-assets-coverage' },
  ]

  const headerBg = isLight ? '#ffffff' : '#1c1c1f'
  const headerShadow = isLight
    ? '0 2px 8px rgba(15,23,42,0.08), 0 1px 0 rgba(0,0,0,0.03)'
    : '0 2px 8px rgba(0,0,0,0.6), 0 1px 0 rgba(255,255,255,0.05), inset 0 -1px 0 rgba(0,0,0,0.5)'
  const pillBg      = isLight ? '#eef1f5' : '#252528'
  const pillRaised   = isLight
    ? '2px 2px 6px rgba(15,23,42,0.07), -1px -1px 2px rgba(255,255,255,0.7)'
    : '2px 2px 6px rgba(0,0,0,0.7), -1px -1px 2px rgba(255,255,255,0.045), inset 0 1px 0 rgba(255,255,255,0.055)'
  const pillRaisedHov = isLight
    ? '3px 3px 8px rgba(15,23,42,0.09), -1px -1px 3px rgba(255,255,255,0.75)'
    : '3px 3px 10px rgba(0,0,0,0.78), -1px -1px 3px rgba(255,255,255,0.052), inset 0 1px 0 rgba(255,255,255,0.07)'
  const hoverText = isLight ? D.text : '#848080'

  return (
    <header className="dash-header" style={{
      position: 'sticky', top: 0, zIndex: 100, height: 52,
      backgroundColor: headerBg,
      backgroundImage: isLight ? 'none' : 'repeating-linear-gradient(90deg, transparent 0px, transparent 5px, rgba(255,255,255,0.005) 5px, rgba(255,255,255,0.005) 6px)',
      boxShadow: headerShadow,
      display: 'flex', alignItems: 'center',
      padding: '0 24px', gap: 14, flexShrink: 0, overflowX: 'auto',
      transition: 'background-color 0.25s ease, box-shadow 0.25s ease',
    }}>

      {/* Logo */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo.jpg" alt="Hitech" style={{ width: 30, height: 30, borderRadius: 7, flexShrink: 0, boxShadow: isLight ? '0 0 0 1px rgba(15,23,42,0.1)' : '0 0 0 1px rgba(255,255,255,0.08)' }} />

      {/* Wordmark */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexShrink: 0 }}>
        <span style={{ fontFamily: 'var(--font-loader)', fontSize: '1rem', letterSpacing: '0.12em', color: D.amber }}>
          HITECH
        </span>
        <span className="dh-subtitle" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.55rem', letterSpacing: '0.16em', color: D.muted, textTransform: 'uppercase' }}>
          Analytics
        </span>
      </div>

      {/* Nav links — mobile-only fallback; SideNav covers this on wider screens */}
      <nav className="dh-nav-links" style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 16, flexShrink: 0 }}>
        {NAV_LINKS.map(link => {
          const isActive = pathname === link.href || pathname.startsWith(link.href + '/')
          return (
            <a
              key={link.href}
              href={link.href}
              style={{
                fontFamily: 'var(--font-mono)', fontSize: '0.6rem', letterSpacing: '0.1em',
                textTransform: 'uppercase', textDecoration: 'none',
                color: isActive ? D.amber : D.muted,
                background: isActive ? `${D.amber}15` : pillBg,
                border: isActive ? `1px solid ${D.amber}40` : '1px solid transparent',
                borderRadius: 6, padding: '4px 10px', cursor: 'pointer',
                boxShadow: isActive
                  ? `0 0 8px ${D.amber}28, inset 0 1px 0 rgba(255,255,255,${isLight ? 0.5 : 0.07})`
                  : pillRaised,
                transition: 'color 0.15s ease, background 0.15s ease, border-color 0.15s ease',
              }}
              onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLAnchorElement).style.color = hoverText }}
              onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLAnchorElement).style.color = D.muted }}
            >
              {link.label}
            </a>
          )
        })}
      </nav>

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      <ThemeToggle />

      {/* User name */}
      {user && (
        <span className="dh-username" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.6rem', color: D.muted, letterSpacing: '0.06em', whiteSpace: 'nowrap', flexShrink: 0 }}>
          {user.first_name} {user.last_name}
        </span>
      )}

      {/* Logout button */}
      <button
        onClick={handleLogout}
        onMouseEnter={() => setHovLogout(true)}
        onMouseLeave={() => setHovLogout(false)}
        style={{
          fontFamily: 'var(--font-mono)', fontSize: '0.6rem', letterSpacing: '0.1em',
          textTransform: 'uppercase', color: hovLogout ? hoverText : D.muted,
          background: pillBg, border: 'none', borderRadius: 6,
          padding: '4px 10px', cursor: 'pointer', flexShrink: 0,
          boxShadow: hovLogout ? pillRaisedHov : pillRaised,
          transition: 'box-shadow 0.15s ease, color 0.15s ease',
        }}
      >
        Logout
      </button>

      <style>{`
        @media (min-width: 641px) {
          .dh-nav-links { display: none !important; }
        }
        @media (max-width: 640px) {
          .dash-header { padding: 0 12px !important; gap: 10px !important; }
          .dh-subtitle { display: none !important; }
        }
        @media (max-width: 480px) {
          .dh-username { display: none !important; }
        }
      `}</style>
    </header>
  )
}
