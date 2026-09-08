import { NextRequest, NextResponse } from 'next/server'
import { getIronSession } from 'iron-session'
import { sessionOptions, AppSession } from '@/lib/session'
import { dashboardRpcArgs, activeFiltersFrom, rpcWithRetry, makeTtlCache, normalizePartySeries, applyUnknownHandling } from './_lib'

/**
 * Core dashboard payload: KPIs, every chart series, the HR breakdowns, and
 * filterOptions. The heavy fields (mapPoints / mediaItems / activityCalendar /
 * recentReports) moved to GET /api/dashboard/extra so the skeleton can clear as
 * soon as this lands — see the 2026-09-08 changelog.
 *
 * All aggregation is one Postgres call (public.dashboard_core), replacing the
 * old ~6 fetchAll() pagination waterfalls + in-JS reduce. The `section` filter
 * (2026-09-07 changelog) is threaded through as `p_section` — see _lib.ts and
 * scripts/sql/add_dashboard_rpcs.sql.
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

  const { data, error } = await rpcWithRetry('dashboard_core', dashboardRpcArgs(searchParams))
  if (error || !data) {
    return NextResponse.json({ error: 'Failed to load dashboard data, please retry.' }, { status: 503 })
  }

  // 1) collapse dirty party-label variants, 2) pull "Unknown" out of the ranked
  // person/weather breakdowns into `unattributed` — see _lib.ts.
  const core = {
    ...(data as Record<string, unknown>),
    byEngineerParty:   normalizePartySeries((data as Record<string, unknown>).byEngineerParty),
    bySupervisorParty: normalizePartySeries((data as Record<string, unknown>).bySupervisorParty),
  }
  const body = {
    ...core,
    ...applyUnknownHandling(core),
    activeFilters: activeFiltersFrom(searchParams),
  }
  CACHE.set(key, body)
  return NextResponse.json(body, { headers: { ...HDRS, 'x-cache': 'miss' } })
}
