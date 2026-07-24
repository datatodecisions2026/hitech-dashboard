import { NextRequest, NextResponse } from 'next/server'
import { getIronSession } from 'iron-session'
import { createClient } from '@supabase/supabase-js'
import { sessionOptions, AppSession } from '@/lib/session'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function fetchAll<T = Record<string, unknown>>(query: any): Promise<T[]> {
  const all: T[] = []
  const PAGE = 1000
  let from = 0
  while (true) {
    const { data, error } = await query.range(from, from + PAGE - 1)
    if (error || !data || data.length === 0) break
    all.push(...data)
    if (data.length < PAGE) break
    from += PAGE
  }
  return all
}

// Root cause (found via a standalone concurrency test, scripts/concurrency-test.mjs,
// that isolated this from the Next.js/dev-server layer entirely): under this
// app's real concurrent load (5+ simultaneous progress_* RPC calls per
// request via Promise.all, against a DB instance with a tiny parallel/CPU
// budget), an individual query occasionally runs long enough to exceed the
// `authenticator` role's `statement_timeout` (8s, a Supabase-wide default —
// deliberately NOT overridden here; that's a platform-level guardrail
// against runaway queries for every route, not something to loosen for one
// endpoint) and gets canceled by Postgres with error 57014. The bug that
// actually reached users wasn't the timeout itself — it's that this route
// never checked `.error` on any RPC result, so a canceled query's `data:
// null` silently became `(data?.[0] ?? {})` → every count reads back as an
// honest-looking 0 (a fully-built, HTTP 200 response) instead of a visible
// failure. Retrying once on error is a reasonable mitigation (the retry
// isn't competing with the same 8-way concurrent burst that caused the
// original contention, since 4 of that burst's siblings have often already
// resolved by the time one straggler needs a retry) — but if the retry
// ALSO fails, that's a real, sustained problem and must be surfaced, not
// silently zeroed again.
async function rpcWithRetry<T = any>(
  name: string,
  params: Record<string, unknown>
): Promise<{ data: T | null; error: any }> {
  let result = await supabase.rpc(name, params)
  if (result.error) {
    console.error(`[progress] ${name} failed, retrying once:`, result.error.message)
    result = await supabase.rpc(name, params)
    if (result.error) console.error(`[progress] ${name} failed again on retry:`, result.error.message)
  }
  return result
}

export async function GET(req: NextRequest) {
  const res = NextResponse.json({})
  const session = await getIronSession<AppSession>(req, res, sessionOptions)
  if (!session.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const project      = searchParams.get('project') || 'Coastal Road'
  const filterEntity = searchParams.get('entity')  || ''
  const filterSide   = searchParams.get('side')    || ''
  const filterMonth  = searchParams.get('month')   || ''
  const filterChFrom = searchParams.get('ch_from') || ''
  const filterChTo   = searchParams.get('ch_to')   || ''

  const chFromNum = Number(filterChFrom)
  const chToNum   = Number(filterChTo)
  const applyChFilter = !!(filterChFrom && filterChTo && !isNaN(chFromNum) && !isNaN(chToNum) && chToNum > chFromNum)

  // hitech_construction_entities has 500k+ rows — never fetchAll() it. All
  // entity-level aggregation below runs in Postgres via RPC (see migration
  // add_progress_aggregation_rpcs) instead of pulling the whole table into
  // Node and reducing it in JS, which is what was timing out.
  //
  // project_name is matched via ilike(project) with NO wildcards — a
  // case-insensitive EXACT match (needed because hitech_report_hitechreport
  // has inconsistent casing, e.g. "Coastal road" vs "Coastal Road"). This
  // used to be `ilike('%' + firstWord + '%')`, a substring wildcard that's
  // meaningfully more expensive per-row than an exact comparison — measured
  // ~30% slower in EXPLAIN ANALYZE — and was never actually needed for
  // partial/fuzzy matching in practice (there's no project whose name is a
  // superset of another's here, and the frontend always requests the
  // literal name "Coastal Road").
  const rpcFilters = {
    p_project: project,
    p_entity:  filterEntity || null,
    p_side:    filterSide   || null,
    p_month:   filterMonth  || null,
    p_ch_from: applyChFilter ? chFromNum : null,
    p_ch_to:   applyChFilter ? chToNum   : null,
  }

  function nextMonthStart(ym: string): string | null {
    const m = /^(\d{4})-(\d{2})$/.exec(ym)
    if (!m) return null
    let y = Number(m[1]), mo = Number(m[2]) + 1
    if (mo > 12) { mo = 1; y += 1 }
    return `${y}-${String(mo).padStart(2, '0')}-01`
  }

  // ── Blocks query with filters ─────────────────────────────
  let blocksQuery = supabase
    .from('hitech_construction_blocks')
    .select('entity_name, side, date_started, date_completed, total_segments, planned_start, block_start, block_end, completion_global_id, report_id')
    .ilike('project_name', project)
    .order('date_started', { ascending: true })

  if (filterEntity) blocksQuery = (blocksQuery as any).eq('entity_name', filterEntity)
  if (filterSide)   blocksQuery = (blocksQuery as any).eq('side', filterSide)
  if (applyChFilter) {
    blocksQuery = (blocksQuery as any).gte('block_start', chFromNum)
    blocksQuery = (blocksQuery as any).lte('block_end', chToNum)
  }

  // ── Fetch all data in parallel ────────────────────────────
  // BOQ filters by activity_type matching entity name (case-insensitive)
  const boqDetailQuery = (() => {
    let q = supabase
      .from('hitech_construction_boq')
      .select('description, activity_category, activity_type, qty, unit, rate, amount')
      .ilike('project_name', project)
      .order('activity_category', { ascending: true })
    if (filterEntity) q = (q as any).ilike('activity_type', `%${filterEntity}%`)
    return q
  })()

  const boqRawQuery = (() => {
    let q = supabase
      .from('hitech_construction_boq')
      .select('activity_category, activity_type, qty, amount')
      .ilike('project_name', project)
    if (filterEntity) q = (q as any).ilike('activity_type', `%${filterEntity}%`)
    return q
  })()

  const [
    blocks, boqItemsRes, boqRawRes, activityReports,
    summaryCountsRes, uniqueEntitiesRes, monthlyRes, curveRes, delayRowsRes,
  ] = await Promise.all([
    fetchAll(blocksQuery),
    boqDetailQuery,
    boqRawQuery,

    // Activity reports — filter by entity name mapped to activity_type
    (() => {
      let q = supabase
        .from('hitech_report_hitechreport')
        .select('id, activity_type, activity_category, activity_status, date_of_activity, reporter_name, project_name, section_name, start_chainage, start_chainage_val, globalid')
        .ilike('project_name', project)
        .order('date_of_activity', { ascending: false })
        .limit(2000)
      if (filterEntity) q = (q as any).ilike('activity_type', `%${filterEntity}%`)
      if (applyChFilter) {
        q = (q as any).gte('start_chainage_val', chFromNum)
        q = (q as any).lte('start_chainage_val', chToNum)
      }
      return q
    })(),

    rpcWithRetry('progress_summary_counts', rpcFilters),
    rpcWithRetry('progress_unique_entity_names', { p_project: project }),
    rpcWithRetry('progress_monthly_breakdown', rpcFilters),
    rpcWithRetry('progress_curve', rpcFilters),
    rpcWithRetry('progress_delay_rows', { ...rpcFilters, p_limit: 1000 }),
  ])

  // Surface a real failure instead of silently building a response full of
  // convincing-looking zeros — see the rpcWithRetry comment above for why
  // this matters here specifically (a canceled query used to look exactly
  // like "0% complete, 0 delayed" instead of an error).
  const rpcErrors = [
    ['progress_summary_counts', summaryCountsRes.error],
    ['progress_unique_entity_names', uniqueEntitiesRes.error],
    ['progress_monthly_breakdown', monthlyRes.error],
    ['progress_curve', curveRes.error],
    ['progress_delay_rows', delayRowsRes.error],
  ].filter(([, err]) => err) as [string, any][]
  if (rpcErrors.length) {
    console.error('[progress] giving up after retry:', rpcErrors.map(([name, err]) => `${name}: ${err.message}`).join('; '))
    return NextResponse.json({ error: 'Failed to load progress data, please retry.' }, { status: 503 })
  }

  const blocksArr   = blocks   as any[]
  const boqArr      = boqItemsRes.data ?? []
  const boqRawArr   = boqRawRes.data   ?? []
  const reportsArr  = activityReports.data ?? []

  const summaryCounts    = (summaryCountsRes.data?.[0] ?? {}) as any
  const totalFiltered    = Number(summaryCounts.total_filtered    ?? 0)
  const totalCompleted   = Number(summaryCounts.total_completed   ?? 0)
  const delayedCount     = Number(summaryCounts.delayed_count     ?? 0)
  const onScheduleCount  = Number(summaryCounts.onschedule_count  ?? 0)
  const linkedCount      = Number(summaryCounts.linked_count      ?? 0)

  // ── Unique entities for dropdown ──────────────────────────
  const uniqueEntities = ((uniqueEntitiesRes.data ?? []) as any[])
    .map(r => r.entity_name as string)
    .filter(Boolean)

  // Which of the reports actually being shown (≤2000, already fetched above)
  // are linked to an entity — deliberately NOT a fetch of all linked entities
  // (this table has ~580k rows, nearly all report_id-linked, so that would
  // reintroduce the same full-table pull this migration removes). Bounded by
  // report volume instead.
  const reportGlobalIds = [...new Set(reportsArr.map((r: any) => r.globalid).filter(Boolean))]
  let linkedGlobalIds = new Set<string>()
  if (reportGlobalIds.length) {
    let lq = supabase
      .from('hitech_construction_entities')
      .select('global_id')
      .ilike('project_name', project)
      .in('global_id', reportGlobalIds)
      .not('report_id', 'is', null)
    if (filterEntity) lq = (lq as any).eq('entity_name', filterEntity)
    if (filterSide)   lq = (lq as any).eq('side', filterSide)
    if (applyChFilter) {
      lq = (lq as any).gte('label', chFromNum)
      lq = (lq as any).lte('label', chToNum)
    }
    if (filterMonth) {
      const end = nextMonthStart(filterMonth)
      if (end) lq = (lq as any).gte('planned_date', `${filterMonth}-01`).lt('planned_date', end)
    }
    const { data: linkedRows } = await lq
    linkedGlobalIds = new Set((linkedRows ?? []).map((r: any) => r.global_id as string).filter(Boolean))
  }

  // ── Gantt ─────────────────────────────────────────────────
  const ganttMap: Record<string, { entity: string; start: string; end: string; segments: number }> = {}
  for (const b of blocksArr) {
    if (!b.entity_name || !b.date_started) continue
    if (!ganttMap[b.entity_name]) {
      ganttMap[b.entity_name] = { entity: b.entity_name, start: b.date_started, end: b.date_completed || b.date_started, segments: 0 }
    } else {
      if (b.date_started < ganttMap[b.entity_name].start) ganttMap[b.entity_name].start = b.date_started
      if (b.date_completed && b.date_completed > ganttMap[b.entity_name].end) ganttMap[b.entity_name].end = b.date_completed
    }
    ganttMap[b.entity_name].segments += b.total_segments || 0
  }
  const ganttData = Object.values(ganttMap).sort((a, b) => a.start.localeCompare(b.start))

  // ── Progress Curve (pre-grouped by Postgres — see progress_curve RPC) ────
  let cumulative = 0
  const progressCurve = ((curveRes.data ?? []) as any[])
    .map(r => ({ date: r.date_completed as string, count: Number(r.count) }))
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(({ date, count }) => {
      cumulative += count
      return { date, count: cumulative, pct: totalFiltered > 0 ? Math.round((cumulative / totalFiltered) * 10000) / 100 : 0 }
    })

  // ── Monthly Progress — split by entity + side (pre-grouped by Postgres —
  // see progress_monthly_breakdown RPC) ─────────────────────
  const monthlyMap: Record<string, Record<string, Record<string, { completed: number; total: number }>>> = {}
  const allMonthsSet = new Set<string>()
  for (const row of (monthlyRes.data ?? []) as any[]) {
    const entityName = row.entity_name || 'Unknown'
    const side        = row.side || 'Unknown'
    const monthKey    = row.month as string
    if (!monthKey) continue
    allMonthsSet.add(monthKey)
    if (!monthlyMap[entityName])       monthlyMap[entityName] = {}
    if (!monthlyMap[entityName][side]) monthlyMap[entityName][side] = {}
    monthlyMap[entityName][side][monthKey] = {
      total:     Number(row.total),
      completed: Number(row.completed),
    }
  }
  const allMonths = [...allMonthsSet].sort()

  const monthlyProgress = Object.entries(monthlyMap).flatMap(([entityName, sides]) =>
    Object.entries(sides).map(([side, months]) => {
      const grandTotal     = Object.values(months).reduce((s, m) => s + m.total,     0)
      const grandCompleted = Object.values(months).reduce((s, m) => s + m.completed, 0)
      let runningCompleted = 0
      const monthData = allMonths.map(m => {
        const d = months[m] || { completed: 0, total: 0 }
        runningCompleted += d.completed
        return {
          month:          m,
          completion_pct: d.total > 0 ? Math.round((d.completed / d.total) * 10000) / 100 : null,
          pending_pct:    d.total > 0 ? Math.round(((d.total - d.completed) / d.total) * 10000) / 100 : null,
          cumulative_pct: grandTotal > 0 ? Math.round((runningCompleted / grandTotal) * 10000) / 100 : null,
        }
      })
      return {
        entity:           entityName,
        side,
        months:           monthData,
        total_completion: grandTotal > 0 ? Math.round((grandCompleted / grandTotal) * 10000) / 100 : null,
      }
    })
  ).sort((a, b) => {
    if (a.entity !== b.entity) return a.entity.localeCompare(b.entity)
    const sideOrder: Record<string, number> = { LHS: 0, MEDIAN: 1, RHS: 2 }
    return (sideOrder[a.side] ?? 3) - (sideOrder[b.side] ?? 3)
  })

  // ── Delay Data (computed + limited to 1000 in Postgres — see progress_delay_rows RPC) ──
  const delayData = ((delayRowsRes.data ?? []) as any[]).map(r => ({
    entity_name:        r.entity_name,
    side:                r.side,
    label:               r.label,
    planned_date:        r.planned_date,
    date_started:        r.date_started,
    date_completed:      r.date_completed,
    delay_days:          Number(r.delay_days),
    performance_status:  r.performance_status,
    status:               r.status,
  }))

  // ── Days by Entity ────────────────────────────────────────
  const daysMap: Record<string, Record<string, number[]>> = {}
  for (const b of blocksArr) {
    if (!b.entity_name || !b.date_started || !b.date_completed || !b.side) continue
    const days = Math.max(1, Math.floor(
      (new Date(b.date_completed).getTime() - new Date(b.date_started).getTime()) / 86400000
    ) + 1)
    if (!daysMap[b.entity_name])         daysMap[b.entity_name] = {}
    if (!daysMap[b.entity_name][b.side]) daysMap[b.entity_name][b.side] = []
    daysMap[b.entity_name][b.side].push(days)
  }
  const daysByEntity = Object.entries(daysMap).map(([entity, sides]) => ({
    entity,
    lhs:    sides['LHS']    ? Math.round(sides['LHS'].reduce((a, b) => a + b, 0)    / sides['LHS'].length)    : null,
    rhs:    sides['RHS']    ? Math.round(sides['RHS'].reduce((a, b) => a + b, 0)    / sides['RHS'].length)    : null,
    median: sides['MEDIAN'] ? Math.round(sides['MEDIAN'].reduce((a, b) => a + b, 0) / sides['MEDIAN'].length) : null,
  }))

  // ── BOQ Summary ───────────────────────────────────────────
  const boqCatMap: Record<string, { qty: number; amount: number; items: number }> = {}
  for (const b of boqRawArr) {
    const cat = (b as any).activity_category || 'Unknown'
    if (!boqCatMap[cat]) boqCatMap[cat] = { qty: 0, amount: 0, items: 0 }
    boqCatMap[cat].qty    += (b as any).qty    || 0
    boqCatMap[cat].amount += (b as any).amount || 0
    boqCatMap[cat].items++
  }
  const boqByCategory = Object.entries(boqCatMap)
    .map(([category, v]) => ({ category, ...v }))
    .sort((a, b) => b.qty - a.qty)
  const totalBoqQty = boqRawArr.reduce((s: number, b: any) => s + (b.qty || 0), 0)

  // ── Activity Report connection (linkedGlobalIds computed above from linkedRows) ──
  const reportsByType: Record<string, { count: number; completed: number; inProgress: number; latest: string; linked: number }> = {}
  for (const r of reportsArr) {
    const type = (r as any).activity_type || 'Unknown'
    if (!reportsByType[type]) reportsByType[type] = { count: 0, completed: 0, inProgress: 0, latest: '', linked: 0 }
    reportsByType[type].count++
    const status = ((r as any).activity_status || '').toLowerCase()
    if (status.includes('complet')) reportsByType[type].completed++
    if (status.includes('progress') || status.includes('ongoing')) reportsByType[type].inProgress++
    const date = (r as any).date_of_activity || ''
    if (date > reportsByType[type].latest) reportsByType[type].latest = date
    if (linkedGlobalIds.has((r as any).globalid)) reportsByType[type].linked++
  }

  // ── BOQ ↔ Report activity_type links ─────────────────────
  const reportTypeCount: Record<string, number> = {}
  for (const r of reportsArr) {
    const t = ((r as any).activity_type || '').toLowerCase().trim()
    if (t) reportTypeCount[t] = (reportTypeCount[t] || 0) + 1
  }
  const boqWithReportCount = boqArr.map((b: any) => ({
    ...b,
    report_count: reportTypeCount[(b.activity_type || '').toLowerCase().trim()] || 0,
  }))

  const overallPct = totalFiltered > 0 ? Math.round((totalCompleted / totalFiltered) * 100) : 0

  return NextResponse.json({
    summary: {
      totalEntities:  uniqueEntities.length,
      totalCompleted,
      overallPct,
      delayed:        delayedCount,
      onSchedule:     onScheduleCount,
      totalBoqQty:    Math.round(totalBoqQty),
      totalReports:   reportsArr.length,
      linkedEntities: linkedCount,
    },
    ganttData,
    progressCurve,
    monthlyProgress,
    allMonths,
    delayData,
    daysByEntity,
    boqItems:        boqWithReportCount,
    boqByCategory,
    reportsByType:   Object.entries(reportsByType).map(([type, v]) => ({ type, ...v })).sort((a, b) => b.count - a.count),
    recentReports:   reportsArr.slice(0, 50),
    activeFilters:   { filterEntity, filterSide, filterMonth, filterChFrom, filterChTo },
    filterOptions: {
      entities: uniqueEntities,
      sides:    ['LHS', 'RHS', 'MEDIAN'],
      months:   allMonths,
    },
  })
}