'use client'

import { useTheme } from '@/lib/theme'

const IconSun = () => (
  <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
  </svg>
)

const IconMoon = () => (
  <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
  </svg>
)

export default function ThemeToggle() {
  const { theme, toggleTheme, colors: D } = useTheme()
  const isLight = theme === 'light'

  return (
    <button
      onClick={toggleTheme}
      aria-label={isLight ? 'Switch to dark mode' : 'Switch to light mode'}
      title={isLight ? 'Switch to dark mode' : 'Switch to light mode'}
      style={{
        position: 'relative', flexShrink: 0, cursor: 'pointer',
        width: 44, height: 24, borderRadius: 999, padding: 2,
        display: 'flex', alignItems: 'center',
        justifyContent: isLight ? 'flex-start' : 'flex-end',
        background: isLight ? '#dde3ea' : '#0e0e10',
        border: `1px solid ${D.border}`,
        boxShadow: isLight
          ? 'inset 2px 2px 6px rgba(15,23,42,0.09), inset -1px -1px 2px rgba(255,255,255,0.6)'
          : 'inset 4px 4px 14px rgba(0,0,0,0.88), inset -1px -1px 3px rgba(255,255,255,0.03)',
        transition: 'background 0.25s ease, justify-content 0.25s ease',
      }}
    >
      <span style={{
        width: 18, height: 18, borderRadius: '50%',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: D.amber, color: isLight ? '#fff8ea' : '#1a1206',
        boxShadow: `0 1px 3px rgba(0,0,0,0.4), 0 0 8px ${D.amber}55`,
        transition: 'transform 0.25s ease',
      }}>
        {isLight ? <IconSun /> : <IconMoon />}
      </span>
    </button>
  )
}
