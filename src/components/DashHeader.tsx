'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

interface SessionUser {
  first_name: string
  last_name: string
  email: string
}

export default function DashHeader() {
  const router = useRouter()
  const [user, setUser] = useState<SessionUser | null>(null)
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

  return (
    <header style={{
      position: 'sticky', top: 0, zIndex: 100, height: 52,
      background: '#1c1c1f',
      backgroundImage: 'repeating-linear-gradient(90deg, transparent 0px, transparent 5px, rgba(255,255,255,0.005) 5px, rgba(255,255,255,0.005) 6px)',
      boxShadow: '0 2px 8px rgba(0,0,0,0.6), 0 1px 0 rgba(255,255,255,0.05), inset 0 -1px 0 rgba(0,0,0,0.5)',
      display: 'flex', alignItems: 'center',
      padding: '0 24px', gap: 14, flexShrink: 0,
    }}>
      {/* Logo */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo.jpg" alt="Hitech" style={{ width: 30, height: 30, borderRadius: 7, flexShrink: 0, boxShadow: '0 0 0 1px rgba(255,255,255,0.08)' }} />

      {/* Wordmark */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{ fontFamily: 'var(--font-loader)', fontSize: '1rem', letterSpacing: '0.12em', color: '#d4a040' }}>
          HITECH
        </span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.55rem', letterSpacing: '0.16em', color: '#504e54', textTransform: 'uppercase' }}>
          Analytics
        </span>
      </div>

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* User name */}
      {user && (
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.6rem', color: '#504e54', letterSpacing: '0.06em', whiteSpace: 'nowrap' }}>
          {user.first_name} {user.last_name}
        </span>
      )}

      {/* Logout button — embossed */}
      <button
        onClick={handleLogout}
        onMouseEnter={() => setHovLogout(true)}
        onMouseLeave={() => setHovLogout(false)}
        style={{
          fontFamily: 'var(--font-mono)', fontSize: '0.6rem', letterSpacing: '0.1em',
          textTransform: 'uppercase', color: hovLogout ? '#848080' : '#504e54',
          background: '#252528', border: 'none', borderRadius: 6,
          padding: '4px 10px', cursor: 'pointer',
          boxShadow: hovLogout
            ? '3px 3px 10px rgba(0,0,0,0.78), -1px -1px 3px rgba(255,255,255,0.052), inset 0 1px 0 rgba(255,255,255,0.07)'
            : '2px 2px 6px rgba(0,0,0,0.7), -1px -1px 2px rgba(255,255,255,0.045), inset 0 1px 0 rgba(255,255,255,0.055)',
          transition: 'box-shadow 0.15s ease, color 0.15s ease',
        }}
      >
        Logout
      </button>
    </header>
  )
}
