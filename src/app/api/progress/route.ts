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
  const projectLike  = `%${project.split(' ')[0]}%`

  const chFromNum = Number(filterChFrom)
  const chToNum   = Number(filterChTo)
  const applyChFilter = !!(filterChFrom && filterChTo && !isNaN(chFromNum) && !isNaN(chToNum) && chToNum > chFromNum)

  // ── Entity query with all filters ────────────────────────
  let entitiesQuery = supabase
    .from('hitech_construction_entities')
    .select('entity_name, side, status, planned_date, date_started, date_completed, label, global_id, report_id')
    .ilike('project_name', projectLike)
    .order('planned_date', { ascending: true })

  if (filterEntity) entitiesQuery = (entitiesQuery as any).eq('entity_name', filterEntity)
  if (filterSide)   entitiesQuery = (entitiesQuery as any).eq('side', filterSide)
  if (filterMonth)  entitiesQuery = (entitiesQuery as any).like('planned_date', `${filterMonth}%`)
  if (applyChFilter) {
    entitiesQuery = (entitiesQuery as any).gte('label', chFromNum)
    entitiesQuery = (entitiesQuery as any).lte('label', chToNum)
  }

  // ── Blocks query with filters ─────────────────────────────
  let blocksQuery = supabase
    .from('hitech_construction_blocks')
    .select('entity_name, side, date_started, date_completed, total_segments, planned_start, block_start, block_end, completion_global_id, report_id')
    .ilike('project_name', projectLike)
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
      .ilike('project_name', projectLike)
      .order('activity_category', { ascending: true })
    if (filterEntity) q = (q as any).ilike('activity_type', `%${filterEntity}%`)
    return q
  })()

  const boqRawQuery = (() => {
    let q = supabase
      .from('hitech_construction_boq')
      .select('activity_category, activity_type, qty, amount')
      .ilike('project_name', projectLike)
    if (filterEntity) q = (q as any).ilike('activity_type', `%${filterEntity}%`)
    return q
  })()

  const [blocks, entities, boqItemsRes, boqRawRes, activityReports, allEntityRows] = await Promise.all([
    fetchAll(blocksQuery),
    fetchAll(entitiesQuery),
    boqDetailQuery,
    boqRawQuery,

    // Activity reports — filter by entity name mapped to activity_type
    (() => {
      let q = supabase
        .from('hitech_report_hitechreport')
        .select('id, activity_type, activity_category, activity_status, date_of_activity, reporter_name, project_name, section_name, start_chainage, start_chainage_val, globalid')
        .ilike('project_name', projectLike)
        .order('date_of_activity', { ascending: false })
        .limit(2000)
      if (filterEntity) q = (q as any).ilike('activity_type', `%${filterEntity}%`)
      if (applyChFilter) {
        q = (q as any).gte('start_chainage_val', chFromNum)
        q = (q as any).lte('start_chainage_val', chToNum)
      }
      return q
    })(),

    // Unique entity names — unfiltered, paginated for dropdown
    fetchAll(
      supabase
        .from('hitech_construction_entities')
        .select('entity_name')
        .ilike('project_name', projectLike)
    ),
  ])

  const blocksArr   = blocks   as any[]
  const entitiesArr = entities as any[]
  const boqArr      = boqItemsRes.data ?? []
  const boqRawArr   = boqRawRes.data   ?? []
  const reportsArr  = activityReports.data ?? []

  // ── Unique entities for dropdown ──────────────────────────
  const uniqueEntities = [...new Set(
    (allEntityRows as any[]).map(e => e.entity_name).filter(Boolean)
  )].sort() as string[]

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

  // ── Progress Curve ────────────────────────────────────────
  const completedEntities = entitiesArr.filter(e => e.status === 'Completed' && e.date_completed)
  const totalEntities     = entitiesArr.length
  const totalCompleted    = completedEntities.length

  const dateCountMap: Record<string, number> = {}
  for (const e of completedEntities) {
    const d = e.date_completed as string
    dateCountMap[d] = (dateCountMap[d] || 0) + 1
  }
  let cumulative = 0
  const progressCurve = Object.keys(dateCountMap).sort().map(date => {
    cumulative += dateCountMap[date]
    return { date, count: cumulative, pct: totalEntities > 0 ? Math.round((cumulative / totalEntities) * 10000) / 100 : 0 }
  })

  // ── Monthly Progress — split by entity + side ─────────────
  const monthlyMap: Record<string, Record<string, Record<string, { completed: number; total: number }>>> = {}
  for (const e of entitiesArr) {
    const entityName  = e.entity_name || 'Unknown'
    const side        = e.side        || 'Unknown'
    const plannedDate = e.planned_date as string
    if (!plannedDate) continue
    const monthKey = plannedDate.slice(0, 7)
    if (!monthlyMap[entityName])                   monthlyMap[entityName] = {}
    if (!monthlyMap[entityName][side])             monthlyMap[entityName][side] = {}
    if (!monthlyMap[entityName][side][monthKey])   monthlyMap[entityName][side][monthKey] = { completed: 0, total: 0 }
    monthlyMap[entityName][side][monthKey].total++
    if (e.status === 'Completed') monthlyMap[entityName][side][monthKey].completed++
  }

  const allMonths = [...new Set(
    entitiesArr.map((e: any) => e.planned_date?.slice(0, 7)).filter(Boolean)
  )].sort() as string[]

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

  // ── Delay Data ────────────────────────────────────────────
  const delayData = entitiesArr
    .filter(e => e.date_started && e.planned_date)
    .map(e => {
      const delayDays = Math.max(0, Math.floor(
        (new Date(e.date_started).getTime() - new Date(e.planned_date).getTime()) / 86400000
      ))
      return {
        entity_name:        e.entity_name,
        side:               e.side,
        label:              e.label,
        planned_date:       e.planned_date,
        date_started:       e.date_started,
        date_completed:     e.date_completed,
        delay_days:         delayDays,
        performance_status: delayDays > 0 ? 'Delayed' : 'On Schedule',
        status:             e.status,
      }
    })

  const onScheduleCount = delayData.filter(d => d.performance_status === 'On Schedule').length
  const delayedCount    = delayData.filter(d => d.performance_status === 'Delayed').length

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

  // ── Activity Report connection ────────────────────────────
  const linkedGlobalIds = new Set(
    entitiesArr
      .filter((e: any) => e.report_id && e.global_id)
      .map((e: any) => e.global_id as string)
  )

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

  const overallPct = totalEntities > 0 ? Math.round((totalCompleted / totalEntities) * 100) : 0

  return NextResponse.json({
    summary: {
      totalEntities:  uniqueEntities.length,
      totalCompleted,
      overallPct,
      delayed:        delayedCount,
      onSchedule:     onScheduleCount,
      totalBoqQty:    Math.round(totalBoqQty),
      totalReports:   reportsArr.length,
      linkedEntities: linkedGlobalIds.size,
    },
    ganttData,
    progressCurve,
    monthlyProgress,
    allMonths,
    delayData:       delayData.slice(0, 1000),
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