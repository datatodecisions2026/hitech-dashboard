import { NextRequest, NextResponse } from 'next/server'
import { getIronSession } from 'iron-session'
import { sessionOptions, AppSession } from '@/lib/session'
import { dashboardRpcArgs, rpcWithRetry, makeTtlCache } from '../_lib'

/**
 * Heavy half of the dashboard payload — mapPoints, mediaItems, activityCalendar,
 * recentReports. Fetched by the page AFTER first paint so the skeleton clears on
 * the core payload alone. One Postgres call (public.dashboard_extra). See the
 * 2026-09-08 changelog.
 */

const CACHE = makeTtlCache()
const HDRS = { 'Cache-Control': 'private, max-age=20, stale-while-revalidate=60' }

export async function GET(req: NextRequest) {
  const res = NextResponse.json({})
  const session = await getIronSession<AppSession>(req, res, sessionOptions)
  if (!session.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const key = searchParams.toString()

  const cached = CACHE.get(key)
  if (cached) return NextResponse.json(cached, { headers: { ...HDRS, 'x-cache': 'hit' } })

  const { data, error } = await rpcWithRetry('dashboard_extra', dashboardRpcArgs(searchParams))
  if (error || !data) {
    return NextResponse.json({ error: 'Failed to load map/media data, please retry.' }, { status: 503 })
  }

  CACHE.set(key, data)
  return NextResponse.json(data, { headers: { ...HDRS, 'x-cache': 'miss' } })
}
