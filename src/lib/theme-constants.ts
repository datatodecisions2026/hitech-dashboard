// Deliberately NOT 'use client' — this needs to be importable from
// layout.tsx (a server component) for the inline no-FOUC theme script.
// Importing any export, even a plain string, from a 'use client' module
// into a server component makes Next.js serialize it as a client-reference
// stub instead of the real value, which breaks at runtime.
export const THEME_STORAGE_KEY = 'hitech-theme'
export const SIDEBAR_STORAGE_KEY = 'hitech-sidebar'
// Shared map (UnifiedMap / MapViewProvider) — remembers which layers are on
// and the colour-by mode across route changes and reloads. The camera and
// any pending focus request are session-only, not persisted here.
export const MAP_VIEW_STORAGE_KEY = 'hitech-map-view'

// Rail geometry — imported by both SideNav (the fixed rail itself) and
// AppShell (the content column's matching left offset) so the two never
// drift apart. Keep these in sync with any width change in SideNav.
export const SIDEBAR_WIDTH = '16rem'
export const SIDEBAR_WIDTH_COLLAPSED = '3.25rem'

// Three-state theme: an explicit 'light' / 'dark' choice always beats the
// OS; 'system' follows prefers-color-scheme live. Stored value is the MODE
// (one of these three); the resolved theme is always 'light' | 'dark'.
export type ThemeMode = 'light' | 'dark' | 'system'
export const THEME_MODES: ThemeMode[] = ['light', 'dark', 'system']

// A vivid, multi-hue categorical palette for data-viz charts (donut/pie
// segments, ranked bars, per-series KPI numbers) — confirmed with the user
// via a reference marketing-dashboard screenshot ("brighter colours...
// sidebar looks bland"). First built locally in dashboard/page.tsx
// 2026-09-19; promoted here 2026-09-21 so every other page's charts share
// the same identity instead of each redefining its own ramp. Deliberately
// separate from the navy/gold ColorTokens (theme.tsx) — those are the
// site's brand/wayfinding accent (nav, hero, buttons), this is a chart-
// series palette, a different concept that happens to also need to look
// vivid. Keep `amber`/`green`/`red` semantic meanings (accent/ok/crit) out
// of this array's usage — VIVID is for categorical series with no inherent
// order or meaning, not for anything status-like.
export const VIVID = ['#8b5cf6', '#06b6d4', '#f43f5e', '#f97316', '#eab308', '#3b82f6', '#14b8a6', '#ec4899']
