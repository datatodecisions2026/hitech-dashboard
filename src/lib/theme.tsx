'use client'

import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { THEME_STORAGE_KEY, ThemeMode } from './theme-constants'

export type ThemeName = 'light' | 'dark'

/**
 * Single source of truth for every page's color/shadow tokens (dashboard,
 * progress, machines, personnel, login, DashHeader, SideNav, HitechMap).
 *
 * The palette is now deliberately achromatic — greys for every surface and
 * all body text — with ONE cold accent (sky) that only ever means
 * "wayfinding": active nav, links, focus rings, the one primary action.
 * Status colour (ok / warn — carried on `green` — and `red`) appears only
 * where it means something.
 *
 * Field names are kept from the previous skeuomorphic palette so the ~300
 * existing `${D.amber}20` hex-alpha-suffix call sites keep working without
 * a codebase-wide rewrite: `amber` is now the sky accent, `blue`/`purple`
 * collapse onto neutral/accent, the glow shadows are flattened to nothing.
 * Theme switching happens by re-rendering with a different literal object.
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

const LIGHT_COLORS: ColorTokens = {
  bg:     '#f5f7f9',   // --ground
  panel:  '#ffffff',   // --surface
  panel2: '#eef2f5',   // --surface-2
  border: '#e3e8ed',   // --line
  text:   '#0e151c',   // --ink
  muted:  '#667583',   // --muted
  sub:    '#9aa7b3',   // faintest text / disabled (between --muted and --line-2)
  amber:  '#0369a1',   // --accent  (sky-700 — the single wayfinding colour)
  amberL: '#0284c7',   // accent, bright / hover
  amberD: '#075985',   // accent, deep
  red:    '#c62a2f',   // --crit
  green:  '#15803d',   // --ok
  blue:   '#0369a1',   // collapsed onto the accent
  purple: '#667583',   // neutralised
  gold:   'linear-gradient(135deg, #0369a1 0%, #0284c7 100%)',
}

const DARK_COLORS: ColorTokens = {
  bg:     '#0a0e13',
  panel:  '#10161d',
  panel2: '#171f28',
  border: '#212a34',
  text:   '#e7edf3',
  muted:  '#7c8b99',
  sub:    '#566573',
  amber:  '#38bdf8',   // --accent (dark)
  amberL: '#7dd3fc',
  amberD: '#0ea5e9',
  red:    '#f2696d',
  green:  '#4ade80',
  blue:   '#38bdf8',
  purple: '#7c8b99',
  gold:   'linear-gradient(135deg, #38bdf8 0%, #7dd3fc 100%)',
}

const LIGHT_SHADOWS: ShadowTokens = {
  card:       '0 1px 2px rgba(14,21,28,.06)',
  cardLg:     '0 1px 2px rgba(14,21,28,.06), 0 14px 44px -12px rgba(14,21,28,.14)',
  panel:      '0 1px 2px rgba(14,21,28,.06)',
  panelLg:    '0 1px 2px rgba(14,21,28,.06), 0 14px 44px -12px rgba(14,21,28,.14)',
  well:       'inset 0 1px 2px rgba(14,21,28,.06)',
  raised:     '0 1px 2px rgba(14,21,28,.06)',
  raisedLg:   '0 1px 2px rgba(14,21,28,.06), 0 14px 44px -12px rgba(14,21,28,.14)',
  inset:      'inset 0 1px 2px rgba(14,21,28,.06)',
  glowAmber:  'none',
  glowGreen:  'none',
  glowRed:    'none',
  borderGlow: '1px solid rgba(3,105,161,.30)',
}

const DARK_SHADOWS: ShadowTokens = {
  card:       '0 1px 2px rgba(0,0,0,.5)',
  cardLg:     '0 1px 2px rgba(0,0,0,.5), 0 20px 50px -14px rgba(0,0,0,.6)',
  panel:      '0 1px 2px rgba(0,0,0,.5)',
  panelLg:    '0 1px 2px rgba(0,0,0,.5), 0 20px 50px -14px rgba(0,0,0,.6)',
  well:       'inset 0 1px 2px rgba(0,0,0,.4)',
  raised:     '0 1px 2px rgba(0,0,0,.5)',
  raisedLg:   '0 1px 2px rgba(0,0,0,.5), 0 20px 50px -14px rgba(0,0,0,.6)',
  inset:      'inset 0 1px 2px rgba(0,0,0,.4)',
  glowAmber:  'none',
  glowGreen:  'none',
  glowRed:    'none',
  borderGlow: '1px solid rgba(56,189,248,.30)',
}

interface ThemeContextValue {
  /** Resolved theme actually in effect — always 'light' | 'dark'. */
  theme: ThemeName
  /** The user's stored choice — 'light' | 'dark' | 'system'. */
  mode: ThemeMode
  setMode: (m: ThemeMode) => void
  /** light → dark → system → light */
  cycleMode: () => void
  /** Back-compat alias for cycleMode() (old ThemeToggle contract). */
  toggleTheme: () => void
  colors: ColorTokens
  shadows: ShadowTokens
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Server + first client (hydration) render both compute from these
  // defaults, so they agree. The real stored mode and the live OS
  // preference are read in the effect below, which only runs after
  // hydration — one extra re-render, never a server/client mismatch.
  const [mode, setModeState] = useState<ThemeMode>('system')
  const [systemDark, setSystemDark] = useState(false)

  useEffect(() => {
    let stored: ThemeMode = 'system'
    try {
      const t = localStorage.getItem(THEME_STORAGE_KEY)
      if (t === 'light' || t === 'dark' || t === 'system') stored = t
    } catch {}
    setModeState(stored)

    const mql = window.matchMedia('(prefers-color-scheme: dark)')
    setSystemDark(mql.matches)
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [])

  const theme: ThemeName = mode === 'system' ? (systemDark ? 'dark' : 'light') : mode

  useEffect(() => {
    // The no-FOUC script always resolves data-theme to 'light' | 'dark'
    // (never leaves it unset), so CSS only needs [data-theme] blocks.
    document.documentElement.dataset.theme = theme
    try { localStorage.setItem(THEME_STORAGE_KEY, mode) } catch {}
  }, [theme, mode])

  const setMode = useCallback((m: ThemeMode) => setModeState(m), [])
  const cycleMode = useCallback(() => {
    setModeState(m => (m === 'light' ? 'dark' : m === 'dark' ? 'system' : 'light'))
  }, [])

  const value: ThemeContextValue = {
    theme,
    mode,
    setMode,
    cycleMode,
    toggleTheme: cycleMode,
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
