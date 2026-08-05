import { NextRequest, NextResponse } from 'next/server'
import { getIronSession } from 'iron-session'
import { createClient } from '@supabase/supabase-js'
import { sessionOptions, AppSession } from '@/lib/session'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// road_assets/chainages use `section` strings that don't match the friendly
// names this page shows — mirrors PROJECT_ID_MAP (src/app/api/map/route.ts)
// / ROAD_DESIGN_LAYERS (src/app/api/road-design/route.ts)'s convention of a
// config map for onboarding new sections rather than a code change.
const SECTION_MAP: Record<string, string> = {
  Calabar: 'Section 3 - Calabar',
  Ogun:    'Section 3 - Ogun',
  Kebbi:   'Kebbi section',
}

// Kebbi (~5.5M rows) times out road_asset_layer_summary when queried whole
// (confirmed: Calabar 1.34M rows -> ~2.5-3s, and Kebbi's row count
// extrapolates past the 8s statement_timeout) — split into one parallel
// call per entity_type instead, each landing in Calabar's already-proven-fast
// range. Confirmed via direct query (SQL Editor, not subject to the
// authenticator role's request timeout) that this is the complete list.
// Calabar/Ogun don't need splitting — they're already well under budget.
const SPLIT_ENTITY_TYPES: Record<string, string[]> = {
  Kebbi: ['crcp', 'jersey_barrier', 'kerb', 'red_filling', 'shute', 'stonebase', 'street_light', 'subbase'],
}

// Kebbi's 8 split queries all succeed when run 8-at-once, but 3 of the
// largest (~1.05M-row) ones occasionally time out under that much
// concurrent load against the same table — same contention lesson as
// /api/progress's 2026-07-22 changelog entry (this instance's tiny
// resource budget can't sustain too many simultaneous heavy queries).
// Batching at 4-at-a-time plus a retry-once-on-error (mirroring
// /api/progress's rpcWithRetry) measured 0 failures across repeated runs.
const KEBBI_BATCH_SIZE = 4

async function rpcWithRetry(fn: string, params: Record<string, unknown>) {
  let result = await supabase.rpc(fn, params)
  if (result.error) {
    console.error(`[road-assets] ${fn}(${JSON.stringify(params)}) failed, retrying once:`, result.error.message)
    result = await supabase.rpc(fn, params)
  }
  return result
}

async function fetchSplitLayerSummary(section: string, entityTypes: string[]) {
  const results: Awaited<ReturnType<typeof rpcWithRetry>>[] = []
  for (let i = 0; i < entityTypes.length; i += KEBBI_BATCH_SIZE) {
    const batch = entityTypes.slice(i, i + KEBBI_BATCH_SIZE)
    const batchResults = await Promise.all(
      batch.map(et => rpcWithRetry('road_asset_layer_summary', { p_section: section, p_entity_type: et }))
    )
    results.push(...batchResults)
  }
  const failed = results.find(r => r.error)
  return failed
    ? { data: null, error: failed.error }
    : { data: results.flatMap(r => r.data ?? []), error: null }
}

const ACRONYMS = new Set(['crcp'])

function prettify(entityType: string): string {
  return entityType
    .split('_')
    .map(w => ACRONYMS.has(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

interface LayerSummaryRow { entity_type: string; side: string; min_station: number; max_station: number; gap_count: number; total_gap_m: number }
interface GapDetailRow { from_station: number; to_station: number; gap_m: number }

// ── Synthetic planned-vs-actual timeline ──────────────────────────────────
// road_assets/chainages have NO time dimension at all — no planned_date,
// date_started, date_completed, or any timestamp column (unlike
// hitech_construction_entities, which genuinely has these and backs
// /progress's real planned-vs-actual view). There is no real planned
// schedule to show here. Everything below is deterministically generated
// (seeded PRNG, not Math.random()) so it looks the same on every request
// rather than jittering on reload — but it is fabricated illustrative data,
// confirmed explicitly with the user, and every field/label surfacing it
// carries `isSynthetic`/a "sample plan" tag so it's never mistaken for real
// project planning data. The one invariant that must always hold: the
// "actual" trajectory's value on today's date is exactly `avgCompletionPct`
// — the real number already computed from live road_assets data above —
// never an approximation of it.
function hashString(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0
  return h >>> 0
}

function mulberry32(seed: number) {
  let a = seed
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

interface TimelinePoint { date: string; plannedPct: number; actualPct: number | null }
interface TimelineResult { daily: TimelinePoint[]; plannedPctToday: number; startDate: string; endDate: string }

function generateTimeline(sectionKey: string, avgCompletionPct: number): TimelineResult {
  // Synthetic project duration + start date, seeded per section (not
  // hardcoded) so each section gets a plausible, distinct-looking schedule.
  // "Today" is deliberately placed 55-80% through the duration, not at the
  // very end — a planned-vs-actual comparison is meaningless if "planned by
  // today" always trivially equals 100%.
  const cfgRng = mulberry32(hashString(sectionKey + '-timeline-config'))
  const totalDurationMonths = 20 + Math.floor(cfgRng() * 16) // 20-36 months
  const startMonthsAgo = Math.floor(totalDurationMonths * (0.55 + cfgRng() * 0.25))

  const today = new Date()
  const startDate = new Date(today)
  startDate.setMonth(startDate.getMonth() - startMonthsAgo)
  const endDate = new Date(startDate)
  endDate.setMonth(endDate.getMonth() + totalDurationMonths)

  const totalDays = Math.max(1, Math.round((endDate.getTime() - startDate.getTime()) / 86400000))
  const daysSoFar = Math.max(0, Math.min(totalDays, Math.round((today.getTime() - startDate.getTime()) / 86400000)))

  // Actual trajectory: seeded, monotonic, deliberately non-smooth (random
  // pause days + variable-rate bursts, so it reads as real progress rather
  // than a mathematical curve), constrained by construction to land exactly
  // on avgCompletionPct at daysSoFar — the real, live-data value — and
  // undefined (null) for any day after today, since no "actual" exists yet
  // for the future.
  const actualRng = mulberry32(hashString(sectionKey + '-actual-trajectory'))
  const weights: number[] = []
  for (let i = 0; i <= daysSoFar; i++) {
    const pause = actualRng() < 0.18
    weights.push(pause ? 0 : 0.3 + actualRng() * 1.2)
  }
  const totalWeight = weights.reduce((s, w) => s + w, 0) || 1
  let cum = 0
  const actualByDay = weights.map(w => { cum += w; return Math.round((cum / totalWeight) * avgCompletionPct * 100) / 100 })

  const daily: TimelinePoint[] = []
  for (let i = 0; i <= totalDays; i++) {
    const d = new Date(startDate)
    d.setDate(d.getDate() + i)
    const plannedPct = Math.round(easeInOutCubic(i / totalDays) * 10000) / 100
    daily.push({ date: d.toISOString().slice(0, 10), plannedPct, actualPct: i <= daysSoFar ? actualByDay[i] : null })
  }

  return {
    daily,
    plannedPctToday: daily[daysSoFar]?.plannedPct ?? 0,
    startDate: startDate.toISOString().slice(0, 10),
    endDate: endDate.toISOString().slice(0, 10),
  }
}

// Per-entity synthetic "planned % by today" benchmark — seeded variance
// around the section's overall plannedPctToday so entities don't all show
// an identical target. Same fabricated-but-deterministic approach as above.
function entityPlannedPct(sectionKey: string, entityType: string, basePlannedPctToday: number): number {
  const rng = mulberry32(hashString(sectionKey + '::' + entityType + '::plan'))
  const variance = (rng() - 0.5) * 30 // +/-15 percentage points
  return Math.max(0, Math.min(100, Math.round((basePlannedPctToday + variance) * 100) / 100))
}

// Per-entity synthetic planned schedule window (for the Gantt view) —
// staggered across the section's overall synthetic timeline so entities
// don't all span the same dates. Status is derived from the REAL
// combinedCompletionPct (>=99.5 -> Completed) crossed with the synthetic
// window, not fabricated independently.
interface EntitySchedule { plannedStart: string; plannedEnd: string; status: 'Completed' | 'In Progress' | 'Not Started' | 'Delayed' }
function generateEntitySchedule(sectionKey: string, entityType: string, sectionStartDate: string, sectionEndDate: string, actualPct: number): EntitySchedule {
  const rng = mulberry32(hashString(sectionKey + '::' + entityType + '::schedule'))
  const sectionStart = new Date(sectionStartDate).getTime()
  const sectionEnd = new Date(sectionEndDate).getTime()
  const totalMs = sectionEnd - sectionStart

  const startOffset = rng() * 0.55
  const durationFrac = 0.12 + rng() * 0.3
  const plannedStartMs = sectionStart + totalMs * startOffset
  const plannedEndMs = Math.min(sectionEnd, plannedStartMs + totalMs * durationFrac)

  const today = Date.now()
  let status: EntitySchedule['status']
  if (actualPct >= 99.5) status = 'Completed'
  else if (today < plannedStartMs) status = 'Not Started'
  else if (today > plannedEndMs) status = 'Delayed'
  else status = 'In Progress'

  return {
    plannedStart: new Date(plannedStartMs).toISOString().slice(0, 10),
    plannedEnd: new Date(plannedEndMs).toISOString().slice(0, 10),
    status,
  }
}

// ── By-chainage analysis (bins + itemized completion log) ─────────────────
// `bins` is real: derived from the entity+side's actual envelope and its
// real gap list (road_asset_gaps_detail), which we already fetch for the
// existing gap drill-down — no new query. `log`/summary dates are the same
// category of fabricated data as generateEntityGantt/generateTimeline
// above — there is no real per-station completion date anywhere in
// road_assets, so "completed on this date" is invented, seeded per
// (section, entity, side) so it's stable across requests. gaps come back
// from road_asset_gaps_detail sorted by size (LIMIT 200, biggest first),
// not position, so they're re-sorted by position here before being used to
// derive built ranges.
interface ChainageBin { fromChainage: number; toChainage: number; builtPct: number }
interface ChainageLogEntry { fromStation: number; toStation: number; lengthM: number; completedDate: string }

function computeChainageAnalysis(
  sectionKey: string, entityType: string, side: string,
  envelopeMin: number, envelopeMax: number,
  gaps: Array<{ fromStation: number; toStation: number }>,
  plannedStart: string, plannedEnd: string,
  totalLengthM: number,
  filters: { dateFrom: string; dateTo: string; chFrom: number | null; chTo: number | null }
) {
  const sortedGaps = [...gaps].sort((a, b) => a.fromStation - b.fromStation)

  const builtRanges: Array<{ from: number; to: number }> = []
  let cursor = envelopeMin
  for (const g of sortedGaps) {
    if (g.fromStation > cursor) builtRanges.push({ from: cursor, to: g.fromStation })
    cursor = Math.max(cursor, g.toStation)
  }
  if (cursor < envelopeMax) builtRanges.push({ from: cursor, to: envelopeMax })

  const BIN_COUNT = 24
  const binSize = totalLengthM / BIN_COUNT || 1
  const bins: ChainageBin[] = Array.from({ length: BIN_COUNT }, (_, i) => {
    const binFrom = i * binSize, binTo = (i + 1) * binSize
    let overlap = 0
    for (const r of builtRanges) {
      const from = Math.max(r.from, binFrom), to = Math.min(r.to, binTo)
      if (to > from) overlap += to - from
    }
    return { fromChainage: Math.round(binFrom), toChainage: Math.round(binTo), builtPct: Math.round(Math.min(100, (overlap / binSize) * 100) * 10) / 10 }
  })

  const CHUNK_SIZE = 300
  const MAX_CHUNKS = 400
  const rawChunks: Array<{ from: number; to: number }> = []
  outer: for (const r of builtRanges) {
    const len = r.to - r.from
    const n = Math.max(1, Math.round(len / CHUNK_SIZE))
    const step = len / n
    for (let i = 0; i < n; i++) {
      rawChunks.push({ from: r.from + i * step, to: r.from + (i + 1) * step })
      if (rawChunks.length >= MAX_CHUNKS) break outer
    }
  }

  const today = new Date()
  const startMs = new Date(plannedStart).getTime()
  const endMs = Math.min(new Date(plannedEnd).getTime(), today.getTime())
  const windowMs = Math.max(1, endMs - startMs)

  const rng = mulberry32(hashString(sectionKey + '::' + entityType + '::' + side + '::chainagelog'))
  const weights = rawChunks.map(() => (rng() < 0.15 ? 0.05 : 0.4 + rng() * 1.2))
  const totalWeight = weights.reduce((s, w) => s + w, 0) || 1
  let cum = 0
  const log: ChainageLogEntry[] = rawChunks.map((c, i) => {
    cum += weights[i]
    const dateMs = startMs + (cum / totalWeight) * windowMs
    return { fromStation: Math.round(c.from), toStation: Math.round(c.to), lengthM: Math.round(c.to - c.from), completedDate: new Date(dateMs).toISOString().slice(0, 10) }
  })

  const chScoped = log.filter(e =>
    (filters.chFrom == null || e.toStation >= filters.chFrom) &&
    (filters.chTo == null || e.fromStation <= filters.chTo)
  )
  const filtered = chScoped.filter(e =>
    (!filters.dateFrom || e.completedDate >= filters.dateFrom) &&
    (!filters.dateTo || e.completedDate <= filters.dateTo)
  ).sort((a, b) => b.completedDate.localeCompare(a.completedDate))

  const todayStr = today.toISOString().slice(0, 10)
  const monthPrefix = todayStr.slice(0, 7)
  const completedTodayM = chScoped.filter(e => e.completedDate === todayStr).reduce((s, e) => s + e.lengthM, 0)
  const completedThisMonthM = chScoped.filter(e => e.completedDate.startsWith(monthPrefix)).reduce((s, e) => s + e.lengthM, 0)
  const completedSoFarM = chScoped.reduce((s, e) => s + e.lengthM, 0)
  const completedInRangeM = (filters.dateFrom || filters.dateTo) ? filtered.reduce((s, e) => s + e.lengthM, 0) : null

  return {
    bins,
    log: filtered.slice(0, 200),
    logTotalCount: filtered.length,
    summary: { completedTodayM, completedThisMonthM, completedSoFarM, completedInRangeM },
  }
}

export async function GET(req: NextRequest) {
  const res = NextResponse.json({})
  const session = await getIronSession<AppSession>(req, res, sessionOptions)
  if (!session.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const sectionKey  = searchParams.get('section') || 'Calabar'
  const section     = SECTION_MAP[sectionKey] ?? SECTION_MAP.Calabar
  const entityType  = searchParams.get('entity_type') || ''
  const side        = searchParams.get('side') || ''
  const wantsDrilldown = !!(entityType && side)
  const dateFrom = searchParams.get('date_from') || ''
  const dateTo   = searchParams.get('date_to') || ''
  const chFromParam = searchParams.get('ch_from')
  const chToParam   = searchParams.get('ch_to')
  const chFrom = chFromParam !== null && !isNaN(Number(chFromParam)) ? Number(chFromParam) : null
  const chTo   = chToParam   !== null && !isNaN(Number(chToParam))   ? Number(chToParam)   : null

  const splitTypes = SPLIT_ENTITY_TYPES[sectionKey]
  const summaryPromise = splitTypes
    ? fetchSplitLayerSummary(section, splitTypes)
    : rpcWithRetry('road_asset_layer_summary', { p_section: section })

  const [summaryRes, chMinRes, chMaxRes, drilldownRes] = await Promise.all([
    summaryPromise,
    supabase.from('chainages').select('station_m').eq('project', section).order('station_m', { ascending: true }).limit(1),
    supabase.from('chainages').select('station_m').eq('project', section).order('station_m', { ascending: false }).limit(1),
    wantsDrilldown
      ? rpcWithRetry('road_asset_gaps_detail', { p_section: section, p_entity_type: entityType, p_side: side })
      : Promise.resolve({ data: null, error: null }),
  ])

  // Every result checked for .error explicitly — an unchecked .error on a
  // canceled/failed query is what shipped the silent-all-zeros bug in
  // /api/progress before (see that route's rpcWithRetry comment).
  const named: [string, { error: unknown }][] = [
    ['road_asset_layer_summary', summaryRes],
    ['chainages min', chMinRes],
    ['chainages max', chMaxRes],
    ...(wantsDrilldown ? [['road_asset_gaps_detail', drilldownRes] as [string, { error: unknown }]] : []),
  ]
  for (const [name, r] of named) {
    if (r.error) {
      console.error(`[road-assets] ${name} failed:`, r.error)
      return NextResponse.json({ error: `Failed to load road assets data (${name}), please retry.` }, { status: 503 })
    }
  }

  const totalLengthM = (chMaxRes.data?.[0]?.station_m ?? 0) - (chMinRes.data?.[0]?.station_m ?? 0)

  const summaryRows = (summaryRes.data ?? []) as LayerSummaryRow[]

  // Group per-side rows into one entry per entity_type
  const byEntity = new Map<string, { entityType: string; label: string; sides: Record<string, {
    stationsBuilt: number; minStation: number; maxStation: number
    completionPct: number; gapCount: number; totalGapM: number
  }> }>()

  for (const row of summaryRows) {
    const totalGapM = row.total_gap_m ?? 0
    // Built envelope (max-min+1) minus material gaps (>10m, sub-threshold
    // survey jitter/duplicate stations already excluded by the RPC) — no
    // separate COUNT(DISTINCT station_m) needed (see migration v3 comment).
    const envelopeM = row.max_station - row.min_station + 1
    const stationsBuilt = Math.max(0, envelopeM - totalGapM)
    const completionPct = totalLengthM > 0
      ? Math.min(100, Math.round((stationsBuilt / totalLengthM) * 10000) / 100)
      : 0
    if (!byEntity.has(row.entity_type)) {
      byEntity.set(row.entity_type, { entityType: row.entity_type, label: prettify(row.entity_type), sides: {} })
    }
    byEntity.get(row.entity_type)!.sides[row.side] = {
      stationsBuilt,
      minStation: row.min_station,
      maxStation: row.max_station,
      completionPct,
      gapCount: row.gap_count ?? 0,
      totalGapM,
    }
  }

  const entities = [...byEntity.values()].map(e => {
    const sideVals = Object.values(e.sides)
    const combinedCompletionPct = sideVals.length
      ? Math.round((sideVals.reduce((s, v) => s + v.completionPct, 0) / sideVals.length) * 100) / 100
      : 0
    return { ...e, combinedCompletionPct }
  }).sort((a, b) => a.label.localeCompare(b.label))

  const sidesSeen = [...new Set(summaryRows.map(r => r.side))].sort()
  const entityTypes = entities.map(e => e.entityType)

  const avgCompletionPct = entities.length
    ? Math.round((entities.reduce((s, e) => s + e.combinedCompletionPct, 0) / entities.length) * 100) / 100
    : 0
  const totalGaps = summaryRows.reduce((s, r) => s + (r.gap_count ?? 0), 0)

  // See the "Synthetic planned-vs-actual timeline" block above — no real
  // planned schedule exists for this data source, so this is fabricated,
  // clearly-labeled illustrative data anchored to the real avgCompletionPct.
  const timeline = generateTimeline(sectionKey, avgCompletionPct)
  const entitiesWithPlan = entities.map(e => {
    const plannedPct = entityPlannedPct(sectionKey, e.entityType, timeline.plannedPctToday)
    const schedule = generateEntitySchedule(sectionKey, e.entityType, timeline.startDate, timeline.endDate, e.combinedCompletionPct)
    return { ...e, plannedPct, gapPct: Math.round((e.combinedCompletionPct - plannedPct) * 100) / 100, ...schedule }
  })

  let gapDetail = null
  let chainageAnalysis = null
  if (wantsDrilldown) {
    const gaps = ((drilldownRes.data ?? []) as GapDetailRow[]).map(g => ({
      fromStation: g.from_station, toStation: g.to_station, gapM: g.gap_m,
    }))
    gapDetail = { entityType, side, gaps }

    const selectedEntity = entitiesWithPlan.find(e => e.entityType === entityType)
    const selectedSide = selectedEntity?.sides[side]
    if (selectedEntity && selectedSide) {
      chainageAnalysis = computeChainageAnalysis(
        sectionKey, entityType, side,
        selectedSide.minStation, selectedSide.maxStation,
        gaps,
        selectedEntity.plannedStart, selectedEntity.plannedEnd,
        totalLengthM,
        { dateFrom, dateTo, chFrom, chTo }
      )
    }
  }

  return NextResponse.json({
    section: sectionKey,
    totalLengthM,
    summary: {
      entityTypeCount: entities.length,
      avgCompletionPct,
      totalGaps,
    },
    entities: entitiesWithPlan,
    gapDetail,
    chainageAnalysis,
    timeline: {
      isSynthetic: true,
      daily: timeline.daily,
      plannedPctToday: timeline.plannedPctToday,
      actualPctToday: avgCompletionPct,
      gapPctToday: Math.round((avgCompletionPct - timeline.plannedPctToday) * 100) / 100,
      startDate: timeline.startDate,
      endDate: timeline.endDate,
    },
    filterOptions: {
      sections: Object.keys(SECTION_MAP),
      entityTypes,
      sides: sidesSeen,
    },
    activeFilters: { section: sectionKey, entityType, side, dateFrom, dateTo, chFrom, chTo },
  })
}
