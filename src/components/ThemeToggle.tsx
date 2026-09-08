'use client'

import { useState } from 'react'
import { useTheme } from '@/lib/theme'

const IconSun = () => (
  <svg width={17} height={17} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
  </svg>
)
const IconMoon = () => (
  <svg width={17} height={17} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
  </svg>
)
const IconMonitor = () => (
  <svg width={17} height={17} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="3" width="20" height="14" rx="2" />
    <path d="M8 21h8M12 17v4" />
  </svg>
)

export default function ThemeToggle() {
  const { mode, cycleMode, colors: D } = useTheme()
  const [hov, setHov] = useState(false)
  const Icon = mode === 'light' ? IconSun : mode === 'dark' ? IconMoon : IconMonitor
  const next = mode === 'light' ? 'dark' : mode === 'dark' ? 'system' : 'light'

  return (
    <button
      onClick={cycleMode}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      aria-label={`Theme: ${mode} — switch to ${next}`}
      title={`Theme: ${mode} — click for ${next}`}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: 32, height: 32, flexShrink: 0, cursor: 'pointer',
        color: hov ? D.text : D.muted, background: hov ? D.panel2 : 'transparent',
        border: '1px solid transparent', borderRadius: 8,
        transition: 'background 0.15s ease, color 0.15s ease',
      }}
    >
      <Icon />
    </button>
  )
}
