'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { useTheme } from '@/lib/theme'
import { useSidebar } from '@/lib/sidebar'
import ThemeToggle from './ThemeToggle'

interface SessionUser {
  first_name: string
  last_name: string
  email: string
  role?: string
}

const IconPanelLeft = () => <svg width={17} height={17} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M9 3v18" /></svg>
const IconSearch = () => <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
const IconChevron = () => <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
const IconSignOut = () => <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="m16 17 5-5-5-5" /><path d="M21 12H9" /></svg>

function initials(u: SessionUser): string {
  const src = `${u.first_name || ''} ${u.last_name || ''}`.trim() || u.email.split('@')[0]
  const parts = src.split(/[\s@._-]+/).filter(Boolean).slice(0, 2)
  return parts.map(p => p[0]?.toUpperCase() || '').join('') || '·'
}

export default function DashHeader() {
  const router = useRouter()
  const pathname = usePathname()
  const { colors: D, shadows: SH } = useTheme()
  const { toggle } = useSidebar()
  const [user, setUser] = useState<SessionUser | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [hovToggle, setHovToggle] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetch('/api/auth/me')
      .then(r => { if (r.status === 401) { router.replace('/login'); return null } return r.json() })
      .then(d => { if (d?.user) setUser(d.user) })
      .catch(() => router.replace('/login'))
  }, [router])

  useEffect(() => {
    if (!menuOpen) return
    const onDown = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [menuOpen])

  if (pathname === '/login') return null

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' })
    router.replace('/login')
  }

  const iconBtn: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    width: 32, height: 32, flexShrink: 0, color: D.muted, background: 'transparent',
    border: '1px solid transparent', borderRadius: 8, cursor: 'pointer',
    transition: 'background 0.15s ease, color 0.15s ease',
  }

  return (
    <header style={{
      position: 'sticky', top: 0, zIndex: 90,
      height: '3.5rem', flexShrink: 0,
      display: 'flex', alignItems: 'center', gap: 8, padding: '0 16px',
      background: `${D.panel}f2`, backdropFilter: 'saturate(180%) blur(8px)',
      borderBottom: `1px solid ${D.border}`, boxShadow: SH.card,
    }}>
      <button aria-label="Toggle sidebar" title="Toggle sidebar (⌘/Ctrl + B)" onClick={toggle}
        onMouseEnter={() => setHovToggle(true)} onMouseLeave={() => setHovToggle(false)}
        style={{ ...iconBtn, background: hovToggle ? D.panel2 : 'transparent', color: hovToggle ? D.text : D.muted }}>
        <IconPanelLeft />
      </button>

      <span style={{ width: 1, height: 20, background: D.border, margin: '0 4px', flexShrink: 0 }} />

      <div className="dh-search" style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
        <span style={{ position: 'absolute', left: 9, display: 'flex', color: D.sub, pointerEvents: 'none' }}><IconSearch /></span>
        <input type="search" placeholder="Search…" aria-label="Global search" style={{
          font: 'inherit', height: 32, width: '15rem', padding: '0 10px 0 28px',
          color: D.text, background: D.panel2, border: `1px solid ${D.border}`, borderRadius: 8, outline: 'none',
        }} />
      </div>

      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4 }}>
        <ThemeToggle />

        <div ref={menuRef} style={{ position: 'relative' }}>
          <button aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen(o => !o)}
            style={{
              display: 'flex', alignItems: 'center', gap: 8, height: 36, padding: '4px 6px 4px 4px',
              background: menuOpen ? D.panel2 : 'transparent', border: '1px solid transparent',
              borderRadius: 8, cursor: 'pointer', color: D.text,
              transition: 'background 0.15s ease',
            }}>
            <span style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: 28, height: 28, flexShrink: 0, fontFamily: 'var(--font-mono)', fontSize: 10.5, fontWeight: 600,
              color: D.text, background: D.panel2, border: `1px solid ${D.border}`, borderRadius: 999,
            }}>{user ? initials(user) : '·'}</span>
            {user && <span className="dh-username" style={{ fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap' }}>{user.first_name} {user.last_name}</span>}
            <span style={{ display: 'flex', color: D.sub }}><IconChevron /></span>
          </button>

          {menuOpen && user && (
            <div role="menu" style={{
              position: 'absolute', right: 0, top: 'calc(100% + 6px)', zIndex: 100, width: 244, padding: 6,
              background: D.panel, border: `1px solid ${D.border}`, borderRadius: 10, boxShadow: SH.cardLg,
            }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '8px 8px 10px' }}>
                <span style={{ fontSize: 12.5, color: D.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.email}</span>
                {user.role && (
                  <span style={{
                    alignSelf: 'flex-start', fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 600,
                    letterSpacing: '0.05em', textTransform: 'uppercase', color: D.muted,
                    background: D.panel2, border: `1px solid ${D.border}`, borderRadius: 5, padding: '3px 6px',
                  }}>{user.role}</span>
                )}
              </div>
              <div style={{ height: 1, background: D.border, margin: '2px 0' }} />
              <button role="menuitem" onClick={handleLogout} className="dh-menu-item" style={{
                display: 'flex', alignItems: 'center', gap: 9, width: '100%', padding: 8, borderRadius: 7,
                fontSize: 13, fontWeight: 500, color: D.text, background: 'transparent', border: 0, cursor: 'pointer', textAlign: 'left',
              }}>
                <span style={{ display: 'flex', color: D.muted }}><IconSignOut /></span>
                Sign out
              </button>
            </div>
          )}
        </div>
      </div>

      <style>{`
        .dh-menu-item:hover { background: ${D.panel2}; }
        @media (max-width: 640px) {
          .dh-search { display: none !important; }
          .dh-username { display: none !important; }
        }
      `}</style>
    </header>
  )
}
