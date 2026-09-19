'use client'

import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { THEME_STORAGE_KEY, ThemeMode } from './theme-constants'

export type ThemeName = 'light' | 'dark'

/**
 * Single source of truth for every page's color/shadow tokens (dashboard,
 * progress, machines, personnel, login, DashHeader, SideNav, HitechMap).
 *
 * 2026-09-19: swapped from the achromatic sky-blue palette to a navy + gold
 * theme (confirmed with the user via AskUserQuestion against a reference
 * Power BI real-estate dashboard) — deep navy for headers/text/dark-mode
 * surfaces, a warm gold as the one accent (active nav, KPI highlight
 * numbers, focus rings, the one primary action), white cards in light mode.
 * Status colour (ok / warn — carried on `green` — and `red`) still only
 * appears where it means something; unchanged from before.
 *
 * Field names are kept from the previous (sky-blue) and original
 * (skeuomorphic amber) palettes before that, so the ~300 existing
 * `${D.amber}20` hex-alpha-suffix call sites keep working without a
 * codebase-wide rewrite: `amber` is now the gold accent, `blue` is the navy
 * secondary tone, `purple`/`gold` stay neutralised/unused respectively.
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
  bg:     '#f6f6f4',   // --ground (warm off-white, matches the reference's page background)
  panel:  '#ffffff',   // --surface (white cards)
  panel2: '#eef1f4',   // --surface-2
  border: '#e1e5ea',   // --line
  text:   '#13253d',   // --ink (deep navy — headers, KPI numbers, body text)
  muted:  '#5b6b7d',   // --muted (navy-tinted gray)
  sub:    '#93a0ac',   // faintest text / disabled
  amber:  '#b8872e',   // --accent (warm gold — the single wayfinding colour)
  amberL: '#d1a24a',   // accent, bright / hover
  amberD: '#93691f',   // accent, deep
  red:    '#c62a2f',   // --crit
  green:  '#15803d',   // --ok
  blue:   '#1c3f66',   // navy secondary (headers/hero backgrounds, not the accent)
  purple: '#5b6b7d',   // neutralised
  gold:   'linear-gradient(135deg, #d4af37 0%, #f0d078 100%)',
}

const DARK_COLORS: ColorTokens = {
  bg:     '#070d16',
  panel:  '#0e1c2e',
  panel2: '#132842',
  border: '#1f3855',
  text:   '#edf2f7',
  muted:  '#93a4b8',
  sub:    '#5b7086',
  amber:  '#e0b64a',   // --accent (dark) — brighter gold for contrast on navy
  amberL: '#f2cd75',
  amberD: '#c99a2e',
  red:    '#f2696d',
  green:  '#4ade80',
  blue:   '#5b8fc9',   // navy secondary, lightened for legibility on dark bg
  purple: '#93a4b8',
  gold:   'linear-gradient(135deg, #e0b64a 0%, #f2cd75 100%)',
}

const LIGHT_SHADOWS: ShadowTokens = {
  card:       '0 1px 2px rgba(14,21,28,.05), 0 2px 6px -2px rgba(14,21,28,.07)',
  cardLg:     '0 2px 4px -1px rgba(14,21,28,.07), 0 14px 44px -12px rgba(14,21,28,.16)',
  panel:      '0 1px 2px rgba(14,21,28,.05), 0 2px 6px -2px rgba(14,21,28,.07)',
  panelLg:    '0 2px 4px -1px rgba(14,21,28,.07), 0 14px 44px -12px rgba(14,21,28,.16)',
  well:       'inset 0 1px 2px rgba(14,21,28,.06)',
  raised:     '0 1px 2px rgba(14,21,28,.05), 0 2px 6px -2px rgba(14,21,28,.07)',
  raisedLg:   '0 2px 4px -1px rgba(14,21,28,.07), 0 14px 44px -12px rgba(14,21,28,.16)',
  inset:      'inset 0 1px 2px rgba(14,21,28,.06)',
  glowAmber:  'none',
  glowGreen:  'none',
  glowRed:    'none',
  borderGlow: '1px solid rgba(184,135,46,.30)',
}

const DARK_SHADOWS: ShadowTokens = {
  card:       '0 1px 2px rgba(0,0,0,.5), 0 2px 8px -2px rgba(0,0,0,.4)',
  cardLg:     '0 2px 4px -1px rgba(0,0,0,.5), 0 20px 50px -14px rgba(0,0,0,.62)',
  panel:      '0 1px 2px rgba(0,0,0,.5), 0 2px 8px -2px rgba(0,0,0,.4)',
  panelLg:    '0 2px 4px -1px rgba(0,0,0,.5), 0 20px 50px -14px rgba(0,0,0,.62)',
  well:       'inset 0 1px 2px rgba(0,0,0,.4)',
  raised:     '0 1px 2px rgba(0,0,0,.5), 0 2px 8px -2px rgba(0,0,0,.4)',
  raisedLg:   '0 2px 4px -1px rgba(0,0,0,.5), 0 20px 50px -14px rgba(0,0,0,.62)',
  inset:      'inset 0 1px 2px rgba(0,0,0,.4)',
  glowAmber:  'none',
  glowGreen:  'none',
  glowRed:    'none',
  borderGlow: '1px solid rgba(224,182,74,.30)',
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
