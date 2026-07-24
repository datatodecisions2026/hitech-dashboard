'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useTheme } from '@/lib/theme'

export default function LoginPage() {
  const { theme, colors: D } = useTheme()
  const isLight = theme === 'light'
  const router = useRouter()
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword]     = useState('')
  const [showPw, setShowPw]         = useState(false)
  const [error, setError]           = useState('')
  const [loading, setLoading]       = useState(false)
  const [shake, setShake]           = useState(false)
  const [vis, setVis]               = useState(false)

  useEffect(() => { setTimeout(() => setVis(true), 60) }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(''); setLoading(true)
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier, password }),
    })
    const data = await res.json()
    if (!res.ok) {
      setLoading(false); setError(data.error || 'Login failed.')
      setShake(true); setTimeout(() => setShake(false), 600)
      return
    }
    router.replace('/dashboard')
  }

  const inputBase: React.CSSProperties = {
    width: '100%', padding: '12px 14px',
    background: D.panel2, border: `1px solid ${D.border}`,
    borderRadius: 11, color: D.text, fontSize: '0.92rem',
    outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box',
    transition: 'border-color 0.25s, box-shadow 0.3s',
  }

  const focus = (e: React.FocusEvent<HTMLInputElement>) => {
    e.target.style.borderColor = D.amber
    e.target.style.boxShadow = `0 0 0 3px ${D.amber}2e`
  }
  const blur = (e: React.FocusEvent<HTMLInputElement>) => {
    e.target.style.borderColor = D.border
    e.target.style.boxShadow = 'none'
  }

  return (
    <main style={{ minHeight: 'calc(100vh - 52px)', background: D.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', padding: '24px 16px' }}>
      {/* Ambient glow */}
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden',
      }}>
        <div style={{
          position: 'absolute', top: '-20%', left: '50%', transform: 'translateX(-50%)',
          width: '70vw', height: '70vw', borderRadius: '50%',
          background: `radial-gradient(circle, ${D.amber}12 0%, transparent 70%)`,
          filter: 'blur(40px)',
        }} />
      </div>

      <div style={{
        position: 'relative', zIndex: 10, width: '100%', maxWidth: 400,
        opacity: vis ? 1 : 0, transform: vis ? 'translateY(0)' : 'translateY(20px)',
        transition: 'opacity 0.6s ease, transform 0.6s ease',
        animation: shake ? 'shake 0.5s ease' : 'none',
      }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{ position: 'relative', display: 'inline-block' }}>
            <div style={{
              position: 'absolute', inset: -12, borderRadius: 28,
              background: `radial-gradient(circle, ${D.amber}2e 0%, transparent 80%)`,
              filter: 'blur(8px)', pointerEvents: 'none',
            }} />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.jpg" alt="Hitech" style={{
              position: 'relative', width: 88, height: 88, borderRadius: 18,
              boxShadow: `0 0 0 2px ${D.amber}38, 0 12px 40px rgba(0,0,0,${isLight ? 0.12 : 0.6})`,
              display: 'block', marginBottom: 14,
            }} />
          </div>
          <div style={{ fontFamily: 'var(--font-loader)', fontSize: '1.5rem', letterSpacing: '0.2em', color: D.amber }}>
            HITECH
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.58rem', letterSpacing: '0.2em', color: D.muted, textTransform: 'uppercase', marginTop: 2 }}>
            Analytics Dashboard
          </div>
        </div>

        {/* Card */}
        <div style={{
          background: `linear-gradient(160deg, ${D.panel} 0%, ${D.bg} 100%)`,
          border: `1px solid ${D.border}`,
          borderRadius: 20, padding: '28px 24px',
          boxShadow: `0 24px 80px rgba(0,0,0,${isLight ? 0.1 : 0.6})`,
        }}>
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <label style={{ display: 'block', fontFamily: 'var(--font-mono)', fontSize: '0.62rem', letterSpacing: '0.12em', textTransform: 'uppercase', color: D.muted, marginBottom: 7 }}>
                Email
              </label>
              <input
                type="email" style={inputBase} value={identifier}
                onChange={e => setIdentifier(e.target.value)}
                required autoComplete="email" placeholder="you@example.com"
                onFocus={focus} onBlur={blur}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontFamily: 'var(--font-mono)', fontSize: '0.62rem', letterSpacing: '0.12em', textTransform: 'uppercase', color: D.muted, marginBottom: 7 }}>
                Password
              </label>
              <div style={{ position: 'relative' }}>
                <input
                  type={showPw ? 'text' : 'password'} style={{ ...inputBase, paddingRight: 44 }}
                  value={password} onChange={e => setPassword(e.target.value)}
                  required autoComplete="current-password" placeholder="••••••••"
                  onFocus={focus} onBlur={blur}
                />
                <button type="button" onClick={() => setShowPw(v => !v)} tabIndex={-1}
                  style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: showPw ? D.amber : D.sub, fontSize: '1rem', lineHeight: 1 }}
                  aria-label={showPw ? 'Hide password' : 'Show password'}>
                  {showPw ? (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
                      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
                      <line x1="1" y1="1" x2="23" y2="23"/>
                    </svg>
                  ) : (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                      <circle cx="12" cy="12" r="3"/>
                    </svg>
                  )}
                </button>
              </div>
            </div>

            {error && (
              <div style={{
                background: `${D.red}14`, border: `1px solid ${D.red}40`,
                borderRadius: 10, padding: '10px 14px',
                fontFamily: 'var(--font-mono)', fontSize: '0.78rem', color: D.red,
              }}>
                ⚠ {error}
              </div>
            )}

            <button type="submit" disabled={loading} style={{
              width: '100%', padding: '14px',
              background: loading ? `${D.amber}80` : D.amber,
              color: '#1a1410', border: 'none', borderRadius: 11,
              fontFamily: 'var(--font-loader)', fontWeight: 400, fontSize: '1rem',
              cursor: loading ? 'not-allowed' : 'pointer',
              letterSpacing: '0.12em',
              boxShadow: loading ? 'none' : `0 4px 24px ${D.amber}48`,
              transition: 'background 0.2s, box-shadow 0.2s',
              marginTop: 4,
            }}>
              {loading ? 'SIGNING IN…' : 'SIGN IN'}
            </button>
          </form>
        </div>
      </div>

      <style>{`
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          18%       { transform: translateX(-7px); }
          36%       { transform: translateX(7px); }
          54%       { transform: translateX(-5px); }
          72%       { transform: translateX(5px); }
          88%       { transform: translateX(-2px); }
        }
      `}</style>
    </main>
  )
}
