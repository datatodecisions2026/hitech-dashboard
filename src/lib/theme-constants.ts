// Deliberately NOT 'use client' — this needs to be importable from
// layout.tsx (a server component) for the inline no-FOUC theme script.
// Importing any export, even a plain string, from a 'use client' module
// into a server component makes Next.js serialize it as a client-reference
// stub instead of the real value, which breaks at runtime.
export const THEME_STORAGE_KEY = 'hitech-theme'
export const SIDEBAR_STORAGE_KEY = 'hitech-sidebar'
// Shared map (UnifiedMap / MapViewProvider) — remembers which layers are on,
// the colour-by mode, and the last manually-panned/zoomed camera across
// route changes and reloads (the app navigates with plain <a href>, not
// SPA, so this is the only thing that survives a full page load). A pending
// focus request is session-only, not persisted here.
export const MAP_VIEW_STORAGE_KEY = 'hitech-map-view'
// Bump this whenever the *meaning* of the persisted camera changes in a way
// that makes old stored values untrustworthy — see map-view.tsx's migration
// check. Currently at 2: before 2026-09-21, a filter/section/report-focus
// fit was indistinguishable from a manual pan/zoom and got persisted the
// same way, so a stale filtered close-up could silently resurface on a
// later unfiltered page load. Fixed going forward (see UnifiedMap.tsx's
// programmaticMoveRef), but existing users' already-saved cameras may still
// carry that bad value — this bump discards any camera saved under an
// older version once, keeping layers/colorBy untouched.
export const MAP_VIEW_SCHEMA_VERSION = 2

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

// The semantic type scale from the "Hitech Type" design-system spec
// (2026-09-29) — one shared source of truth for the 13 text roles every
// page's local Card/KPICard/HBarChart/DonutChart copies should converge on,
// same "promote once it needs to be shared" precedent as VIVID above. Each
// entry is a ready-to-spread inline-style fragment: `{...TYPE_SCALE.heroKpi,
// color: D.text}`. `fontFamily` is always one of the 3 CSS var roles
// (--font-display / --font-body / --font-mono) declared in globals.css —
// never a literal font name, so a theme-level font swap still only touches
// one file. See the spec's own README §3 for the full rationale per role.
export const TYPE_SCALE = {
  // Display & Headings — var(--font-display), Bricolage Grotesque
  heroKpi:        { fontFamily: 'var(--font-display)', fontSize: 34,   lineHeight: 1.05, fontWeight: 700, letterSpacing: '-0.03em' },
  pageTitle:      { fontFamily: 'var(--font-display)', fontSize: 26,   lineHeight: 1.15, fontWeight: 700, letterSpacing: '-0.02em' },
  sectionHeader:  { fontFamily: 'var(--font-display)', fontSize: 15.5, lineHeight: 1.3,  fontWeight: 700, letterSpacing: '-0.02em' },
  statNumber:     { fontFamily: 'var(--font-display)', fontSize: 22,   lineHeight: 1.1,  fontWeight: 700, letterSpacing: '-0.02em' },
  // The KPI micro-label ("TOTAL REPORTS", above heroKpi) reclassified from
  // mono to display 2026-09-29 — direct user follow-up on the Bricolage
  // Grotesque swap ("even the title of each KPI"): a KPI's own label reads
  // as part of the same display moment as its number, not as tabular data
  // to be scanned/compared (that's what `tableHeader`/`dataCode` are for,
  // both still mono below). Uppercase + tracking kept for the small-caps
  // convention; weight trimmed 700→600 since Bricolage Grotesque's more
  // idiosyncratic letterforms read heavier than Mono did at the same weight.
  microLabel:     { fontFamily: 'var(--font-display)', fontSize: 10, lineHeight: 1.3, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' as const },
  // Body & UI — var(--font-body), Fira Sans
  body:           { fontFamily: 'var(--font-body)', fontSize: 14, lineHeight: 1.6,  fontWeight: 400 },
  bodyDense:      { fontFamily: 'var(--font-body)', fontSize: 13, lineHeight: 1.45, fontWeight: 400 },
  bodyEmphasis:   { fontFamily: 'var(--font-body)', fontSize: 13, lineHeight: 1.45, fontWeight: 600 },
  caption:        { fontFamily: 'var(--font-body)', fontSize: 12, lineHeight: 1.4,  fontWeight: 400 },
  // Data & Microcopy — var(--font-mono), JetBrains Mono
  tableHeader:    { fontFamily: 'var(--font-mono)', fontSize: 10.5, lineHeight: 1.3, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' as const },
  dataCode:       { fontFamily: 'var(--font-mono)', fontSize: 12.5, lineHeight: 1.4, fontWeight: 500 },
  tooltip:        { fontFamily: 'var(--font-mono)', fontSize: 11,   lineHeight: 1.4, fontWeight: 500 },
  // Chart axis ticks — the system's stated 9px floor; never go smaller.
  axisLabel:      { fontFamily: 'var(--font-mono)', fontSize: 9, lineHeight: 1.2, fontWeight: 500, letterSpacing: '0.02em' },
} as const
