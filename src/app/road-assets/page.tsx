import { redirect } from 'next/navigation'

// Road assets are now part of /planning-implementation (map, KPIs, and
// per-section breakdown all merged in) rather than a standalone page — see
// the 2026-08-05 CLAUDE.md changelog entry. Kept as a redirect, not a hard
// delete, so old bookmarks/links don't 404.
export default function RoadAssetsRedirect() {
  redirect('/planning-implementation')
}
