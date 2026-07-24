'use client'

import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { THEME_STORAGE_KEY } from './theme-constants'

export type ThemeName = 'light' | 'dark'

/**
 * Single source of truth for every page's color/shadow tokens (dashboard,
 * progress, machines, personnel, login, DashHeader, SideNav, HitechMap).
 * Colors are plain hex/rgba strings (not CSS vars) because the whole
 * codebase relies on the `${D.amber}20` hex-alpha-suffix pattern for
 * tinted backgrounds/borders, which only works with literal hex — a CSS
 * var() reference can't be suffixed that way. Theme switching therefore
 * happens by re-rendering with a different literal object, via useTheme().
 */
export interface ColorTokens {
  bg: string; panel: string; panel2: string; border: string
  text: string; muted: string; sub: string
  amber: string; amberL: string; amberD: string
  red: string; green: string; blue: string; purple: string
  gold: string
}

export interface ShadowTokens {
  card: string; cardLg: string; panel: string; panelLg: string
  well: string; raised: string; raisedLg: string; inset: string
  glowAmber: string; glowGreen: string; glowRed: string; borderGlow: string
}

const DARK_COLORS: ColorTokens = {
  bg:     '#0e0e10',
  panel:  '#141416',
  panel2: '#1a1a1e',
  border: 'rgba(255,255,255,0.06)',
  text:   '#e8e2d8',
  muted:  '#8c867e',
  sub:    '#3d3b42',
  amber:  '#d4a040',
  amberL: '#f0c060',
  amberD: '#8a6018',
  red:    '#f87171',
  green:  '#34d399',
  blue:   '#60a5fa',
  purple: '#a78bfa',
  gold:   'linear-gradient(135deg, #d4a040 0%, #f0c060 50%, #b8860b 100%)',
}

const LIGHT_COLORS: ColorTokens = {
  bg:     '#eef1f5',
  panel:  '#ffffff',
  panel2: '#f6f8fa',
  border: 'rgba(15,23,42,0.08)',
  text:   '#1e293b',
  muted:  '#64748b',
  sub:    '#94a3b8',
  amber:  '#b8860b',
  amberL: '#d4a040',
  amberD: '#8a6018',
  red:    '#dc2626',
  green:  '#059669',
  blue:   '#2563eb',
  purple: '#7c3aed',
  gold:   'linear-gradient(135deg, #b8860b 0%, #d4a040 50%, #8a6018 100%)',
}

const DARK_SHADOWS: ShadowTokens = {
  card:       '0 4px 20px rgba(0,0,0,0.7), 0 1px 0 rgba(255,255,255,0.05)',
  cardLg:     '0 10px 36px rgba(0,0,0,0.82), 0 1px 0 rgba(255,255,255,0.06), 0 0 28px rgba(212,160,64,0.08)',
  panel:      '0 4px 24px rgba(0,0,0,0.6), 0 1px 0 rgba(255,255,255,0.04), inset 0 1px 0 rgba(255,255,255,0.03)',
  panelLg:    '0 10px 36px rgba(0,0,0,0.7), 0 1px 0 rgba(255,255,255,0.05), inset 0 1px 0 rgba(255,255,255,0.03), 0 0 32px rgba(212,160,64,0.05)',
  well:       'inset 4px 4px 14px rgba(0,0,0,0.88), inset -1px -1px 3px rgba(255,255,255,0.03)',
  raised:     '3px 3px 10px rgba(0,0,0,0.78), -1px -1px 4px rgba(255,255,255,0.052), inset 0 1px 0 rgba(255,255,255,0.07)',
  raisedLg:   '5px 5px 18px rgba(0,0,0,0.82), -2px -2px 6px rgba(255,255,255,0.062), inset 0 1px 0 rgba(255,255,255,0.09)',
  inset:      'inset 0 2px 8px rgba(0,0,0,0.6), inset 0 1px 0 rgba(0,0,0,0.3)',
  glowAmber:  '0 0 20px rgba(212,160,64,0.15), 0 0 60px rgba(212,160,64,0.05)',
  glowGreen:  '0 0 20px rgba(52,211,153,0.15)',
  glowRed:    '0 0 20px rgba(248,113,113,0.15)',
  borderGlow: '1px solid rgba(212,160,64,0.15)',
}

const LIGHT_SHADOWS: ShadowTokens = {
  card:       '0 2px 10px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)',
  cardLg:     '0 8px 28px rgba(15,23,42,0.10), 0 2px 6px rgba(15,23,42,0.06), 0 0 20px rgba(184,134,11,0.06)',
  panel:      '0 2px 12px rgba(15,23,42,0.05), 0 1px 2px rgba(15,23,42,0.04)',
  panelLg:    '0 8px 28px rgba(15,23,42,0.09), 0 2px 6px rgba(15,23,42,0.05), 0 0 22px rgba(184,134,11,0.05)',
  well:       'inset 2px 2px 6px rgba(15,23,42,0.09), inset -1px -1px 2px rgba(255,255,255,0.6)',
  raised:     '2px 2px 6px rgba(15,23,42,0.08), -1px -1px 3px rgba(255,255,255,0.7), inset 0 1px 0 rgba(255,255,255,0.5)',
  raisedLg:   '3px 3px 10px rgba(15,23,42,0.10), -1px -1px 4px rgba(255,255,255,0.75), inset 0 1px 0 rgba(255,255,255,0.6)',
  inset:      'inset 0 2px 6px rgba(15,23,42,0.08), inset 0 1px 0 rgba(255,255,255,0.5)',
  glowAmber:  '0 0 16px rgba(184,134,11,0.14), 0 0 40px rgba(184,134,11,0.05)',
  glowGreen:  '0 0 16px rgba(5,150,105,0.14)',
  glowRed:    '0 0 16px rgba(220,38,38,0.14)',
  borderGlow: '1px solid rgba(184,134,11,0.25)',
}

interface ThemeContextValue {
  theme: ThemeName
  toggleTheme: () => void
  colors: ColorTokens
  shadows: ShadowTokens
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Always starts at 'dark' — the same value the server renders, since
  // `document`/localStorage don't exist there. Reading the DOM here in the
  // initializer would make the client's hydration render (document already
  // has the blocking <head> script's data-theme attribute by then) disagree
  // with the server's render, which is a hydration mismatch, not a fix for
  // one. The real value is picked up in the effect below instead, which
  // only runs after hydration completes — one extra re-render, but no
  // server/client disagreement.
  const [theme, setTheme] = useState<ThemeName>('dark')

  useEffect(() => {
    const attr = document.documentElement.dataset.theme
    if (attr === 'light' && attr !== theme) setTheme('light')
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try { localStorage.setItem(THEME_STORAGE_KEY, theme) } catch {}
  }, [theme])

  const toggleTheme = useCallback(() => {
    setTheme(t => (t === 'dark' ? 'light' : 'dark'))
  }, [])

  const value: ThemeContextValue = {
    theme,
    toggleTheme,
    colors: theme === 'light' ? LIGHT_COLORS : DARK_COLORS,
    shadows: theme === 'light' ? LIGHT_SHADOWS : DARK_SHADOWS,
  }

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider')
  return ctx
}
