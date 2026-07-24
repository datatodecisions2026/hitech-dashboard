// Deliberately NOT 'use client' — this needs to be importable from
// layout.tsx (a server component) for the inline no-FOUC theme script.
// Importing any export, even a plain string, from a 'use client' module
// into a server component makes Next.js serialize it as a client-reference
// stub instead of the real value, which breaks at runtime.
export const THEME_STORAGE_KEY = 'hitech-theme'
