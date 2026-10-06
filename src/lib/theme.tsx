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

/**
 * 2026-10-05: dark "liquid glass" only (confirmed with the user — reference:
 * a smart-home glass dashboard video). Surfaces are translucent and blurred
 * over a fixed full-bleed background photo (see AppShell). `panel`/`panel2`/
 * `border` are rgba on purpose — never hex-alpha-suffix them (`${D.panel}66`
 * would be invalid CSS). Every other token stays plain hex so the existing
 * `${D.amber}20`-style call sites keep working.
 */
const GLASS_COLORS: ColorTokens = {
  bg:     '#0b0b0d',                    // fallback behind the photo
  panel:  'rgba(30,30,34,0.52)',        // glass card (regular variant)
  panel2: 'rgba(255,255,255,0.07)',     // inner wells, inputs, chips
  border: 'rgba(255,255,255,0.13)',     // hairline light edge
  text:   '#f5f5f7',
  muted:  '#b4b4bb',                    // ≥4.5:1 on the dimmed glass
  sub:    '#7c7c84',
  amber:  '#f0a23b',                    // warm orange accent, as in the reference
  amberL: '#ffb95c',
  amberD: '#c97f1f',
  red:    '#ff6b6b',
  green:  '#4ade80',
  blue:   '#7aa7e0',
  purple: '#b4b4bb',
  gold:   'linear-gradient(135deg, #f0a23b 0%, #ffcf80 100%)',
}

const GLASS_SHADOWS: ShadowTokens = {
  card:       'inset 0 1px 0 rgba(255,255,255,.10), 0 8px 32px -8px rgba(0,0,0,.45)',
  cardLg:     'inset 0 1px 0 rgba(255,255,255,.14), 0 18px 48px -12px rgba(0,0,0,.6)',
  panel:      'inset 0 1px 0 rgba(255,255,255,.10), 0 8px 32px -8px rgba(0,0,0,.45)',
  panelLg:    'inset 0 1px 0 rgba(255,255,255,.14), 0 18px 48px -12px rgba(0,0,0,.6)',
  well:       'inset 0 1px 2px rgba(0,0,0,.35)',
  raised:     'inset 0 1px 0 rgba(255,255,255,.10), 0 4px 16px -6px rgba(0,0,0,.45)',
  raisedLg:   'inset 0 1px 0 rgba(255,255,255,.14), 0 18px 48px -12px rgba(0,0,0,.6)',
  inset:      'inset 0 1px 2px rgba(0,0,0,.35)',
  glowAmber:  'none',
  glowGreen:  'none',
  glowRed:    'none',
  borderGlow: '1px solid rgba(240,162,59,.35)',
}


const LIGHT_COLORS: ColorTokens = {
  bg:     '#eceff4',
  panel:  'rgba(255,255,255,0.58)',
  panel2: 'rgba(20,24,40,0.06)',
  border: 'rgba(20,24,40,0.12)',
  text:   '#14161c',
  muted:  '#4b5060',
  sub:    '#7b8190',
  amber:  '#c9760a',
  amberL: '#e08a14',
  amberD: '#a55f06',
  red:    '#d92d3f',
  green:  '#15803d',
  blue:   '#2f5fa8',
  purple: '#4b5060',
  gold:   'linear-gradient(135deg, #c9760a 0%, #f0a23b 100%)',
}

const LIGHT_SHADOWS: ShadowTokens = {
  card:       'inset 0 1px 0 rgba(255,255,255,.8), 0 8px 32px -10px rgba(30,40,70,.18)',
  cardLg:     'inset 0 1px 0 rgba(255,255,255,.9), 0 18px 48px -14px rgba(30,40,70,.28)',
  panel:      'inset 0 1px 0 rgba(255,255,255,.8), 0 8px 32px -10px rgba(30,40,70,.18)',
  panelLg:    'inset 0 1px 0 rgba(255,255,255,.9), 0 18px 48px -14px rgba(30,40,70,.28)',
  well:       'inset 0 1px 2px rgba(30,40,70,.15)',
  raised:     'inset 0 1px 0 rgba(255,255,255,.8), 0 4px 16px -6px rgba(30,40,70,.2)',
  raisedLg:   'inset 0 1px 0 rgba(255,255,255,.9), 0 18px 48px -14px rgba(30,40,70,.28)',
  inset:      'inset 0 1px 2px rgba(30,40,70,.15)',
  glowAmber:  'none',
  glowGreen:  'none',
  glowRed:    'none',
  borderGlow: '1px solid rgba(201,118,10,.4)',
}

/** backdrop-filter for every glass surface (HIG regular variant: 20–40px blur, 1.2–1.5x saturation). */
export const GLASS = 'blur(28px) saturate(150%)'

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
  const [mode, setModeState] = useState<ThemeMode>('dark')
  const [systemDark, setSystemDark] = useState(false)

  useEffect(() => {
    let stored: ThemeMode = 'dark'
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
    colors: theme === 'dark' ? GLASS_COLORS : LIGHT_COLORS,
    shadows: theme === 'dark' ? GLASS_SHADOWS : LIGHT_SHADOWS,
  }

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider')
  return ctx
}
