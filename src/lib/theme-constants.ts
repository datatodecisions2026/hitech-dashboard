// Deliberately NOT 'use client' — this needs to be importable from
// layout.tsx (a server component) for the inline no-FOUC theme script.
// Importing any export, even a plain string, from a 'use client' module
// into a server component makes Next.js serialize it as a client-reference
// stub instead of the real value, which breaks at runtime.
export const THEME_STORAGE_KEY = 'hitech-theme'
export const SIDEBAR_STORAGE_KEY = 'hitech-sidebar'

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
