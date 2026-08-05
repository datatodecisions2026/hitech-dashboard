import { NextRequest, NextResponse } from 'next/server'
import { getIronSession } from 'iron-session'
import { createClient } from '@supabase/supabase-js'
import { sessionOptions, AppSession } from '@/lib/session'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Same retry-once-on-error pattern as /api/progress (see that route's
// rpcWithRetry comment) — a canceled/timed-out RPC must surface as a real
// error, not silently become a convincing-looking zero.
async function rpcWithRetry<T = any>(
  name: string,
  params: Record<string, unknown>
): Promise<{ data: T | null; error: any }> {
  let result = await supabase.rpc(name, params)
  if (result.error) {
    console.error(`[planning-implementation] ${name} failed, retrying once:`, result.error.message)
    result = await supabase.rpc(name, params)
    if (result.error) console.error(`[planning-implementation] ${name} failed again on retry:`, result.error.message)
  }
  return result
}

interface SectionRow {
  section: string
  total_count: number
  planned_count: number
  implemented_count: number
}

// road_assets uses a completely different section-naming scheme than the
// field-report tables ("Section 3 - Calabar" vs "Calabar section") and, for
// Kebbi, even a different *project* name than its own reports are filed
// under ("Kebbi - Sokoto project" in road_assets vs "SBS Sokoto Badagry
// highway" in hitech_report_hitechreport) — confirmed live before building
// this, not assumed. So "does this road-asset section have a field-
// confirmed report" is matched by a keyword against report section_name,
// not an exact project+section join (a strict join would silently lose
// Kebbi's real 21 linked reports). Add a line here when a new road-asset
// section is onboarded — same config-edit convention as
// PROJECT_ID_MAP/ROAD_DESIGN_LAYERS elsewhere in this codebase.
const ROAD_ASSET_SECTION_KEYWORDS: Record<string, string> = {
  'Section 3 - Calabar': 'calabar',
  'Section 3 - Ogun': 'ogun',
  'Kebbi section': 'kebbi',
}

export async function GET(req: NextRequest) {
  const res = NextResponse.json({})
  const session = await getIronSession<AppSession>(req, res, sessionOptions)
  if (!session.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  // rawProjectParam distinguishes "no filter selected" (null — show road
  // assets across every project) from "explicitly filtered" (narrow road
  // assets too). The planning RPC still defaults to 'Coastal Road' either
  // way since that's the only project with planning data at all — but that
  // default must NOT also silently hide Kebbi's road assets on first load.
  const rawProjectParam = searchParams.get('project')
  const project = rawProjectParam || 'Coastal Road'

  const [planningRes, roadSummaryRes, roadProjectsRes, roadSectionsRes, roadEntityTypesRes] = await Promise.all([
    rpcWithRetry<SectionRow[]>('progress_section_breakdown', { p_project: project }),
    supabase.from('road_assets_summary_cache').select('*').eq('id', 1).maybeSingle(),
    supabase.from('road_assets_project_stats').select('project, point_count, geolocated_point_count').order('point_count', { ascending: false }),
    supabase.from('road_assets_section_stats').select('project, section, point_count, geolocated_point_count').order('point_count', { ascending: false }),
    supabase.from('road_assets_entity_type_stats').select('entity_type, point_count').order('point_count', { ascending: false }),
  ])

  if (planningRes.error) {
    console.error('[planning-implementation] giving up after retry:', planningRes.error.message)
    return NextResponse.json({ error: 'Failed to load planning/implementation data, please retry.' }, { status: 503 })
  }
  for (const [name, r] of [
    ['road_assets_summary', roadSummaryRes], ['road_assets_projects', roadProjectsRes],
    ['road_assets_sections', roadSectionsRes], ['road_assets_entity_types', roadEntityTypesRes],
  ] as const) {
    if (r.error) {
      console.error(`[planning-implementation] ${name} failed:`, r.error.message)
      return NextResponse.json({ error: `Failed to load road assets data (${name}).` }, { status: 500 })
    }
  }

  // Keyword count checks against hitech_report_hitechreport (~9.7k rows —
  // trivial cost, never touches the 7.27M-row road_assets table; exact
  // count via head:true, no rows fetched). Run after the main batch so a
  // failure here can't take down the primary response; a query error is
  // simply treated as "0 matches" rather than a hard failure, since this
  // only affects one derived stat.
  //
  // This is deliberately a REPORT COUNT, not an "implemented asset count" —
  // an earlier version multiplied a single matching report across a
  // section's entire point_count (e.g. 1 Calabar report → 1,344,386 assets
  // marked "implemented"), which is not a real signal at that scale and was
  // flagged live by the user after seeing it on the page. A report's
  // existence tells you a section got *some* field attention; it says
  // nothing about which or how many specific assets were verified, so
  // road_assets no longer contributes to summary.implemented/combined at
  // all — see the 2026-08-05 CLAUDE.md changelog for the full reasoning.
  const keywordEntries = Object.entries(ROAD_ASSET_SECTION_KEYWORDS)
  const keywordChecks = await Promise.all(
    keywordEntries.map(([, keyword]) =>
      supabase.from('hitech_report_hitechreport').select('*', { count: 'exact', head: true }).ilike('section_name', `%${keyword}%`)
    )
  )
  const reportCountBySection = new Map<string, number>()
  keywordEntries.forEach(([section], i) => {
    const r = keywordChecks[i]
    reportCountBySection.set(section, !r.error ? (r.count ?? 0) : 0)
  })

  const sections = (planningRes.data ?? [])
    .map(r => ({
      section: r.section,
      total: Number(r.total_count),
      planned: Number(r.planned_count),
      implemented: Number(r.implemented_count),
    }))
    .sort((a, b) => b.total - a.total)

  const summary = sections.reduce(
    (acc, r) => ({
      total: acc.total + r.total,
      planned: acc.planned + r.planned,
      implemented: acc.implemented + r.implemented,
    }),
    { total: 0, planned: 0, implemented: 0 }
  )

  // Road assets: only narrowed by project when the caller explicitly asked
  // for one (rawProjectParam) — the RPC's own 'Coastal Road' fallback above
  // must not also quietly filter this out, or the unfiltered page would
  // show Coastal-only road-asset totals instead of the true nationwide
  // figure the combined KPI is meant to represent.
  const projectFilter = rawProjectParam?.toLowerCase() ?? null
  const roadAssetsProjectsAll = roadProjectsRes.data ?? []
  const roadAssetsProjects = projectFilter
    ? roadAssetsProjectsAll.filter(p => p.project.toLowerCase() === projectFilter)
    : roadAssetsProjectsAll

  const roadAssetsSectionsAll = (roadSectionsRes.data ?? []).map(r => {
    const reportCount = reportCountBySection.get(r.section) ?? 0
    const matchedKeyword = reportCount > 0 ? ROAD_ASSET_SECTION_KEYWORDS[r.section] ?? null : null
    return {
      project: r.project,
      section: r.section,
      total: Number(r.point_count),
      geolocated: Number(r.geolocated_point_count ?? 0),
      reportCount,
      matchedKeyword,
    }
  })
  const roadAssetsSections = projectFilter
    ? roadAssetsSectionsAll.filter(r => r.project.toLowerCase() === projectFilter)
    : roadAssetsSectionsAll

  const roadAssetsTotal = roadAssetsSections.reduce((s, r) => s + r.total, 0)
  const roadAssetsGeolocated = roadAssetsSections.reduce((s, r) => s + r.geolocated, 0)

  const combinedTotal = summary.total + roadAssetsTotal

  return NextResponse.json({
    project,
    sections,
    summary: {
      ...summary,
      sectionCount: sections.filter(r => r.section !== 'Unlinked / No Section').length,
      plannedPct: summary.total > 0 ? Math.round((summary.planned / summary.total) * 100) : 0,
      implementedPct: summary.total > 0 ? Math.round((summary.implemented / summary.total) * 100) : 0,
    },
    roadAssets: {
      // Nationwide cache row — not project-filtered (geolocated_estimate's
      // gap is a source-data fact about Ogun specifically, not something
      // that reads meaningfully "per selection").
      summary: roadSummaryRes.data,
      projects: roadAssetsProjects,
      sections: roadAssetsSections,
      entityTypes: roadEntityTypesRes.data ?? [], // no project/section breakdown exists at this cache grain — always nationwide
      total: roadAssetsTotal,
      geolocated: roadAssetsGeolocated,
    },
    // "Implemented" is intentionally activities-only (summary.implemented,
    // per-entity global_id-linked) — road_assets never contributes here,
    // see the comment above reportCountBySection for why. combined only
    // sums the two tables' Total and (activities-only) Planned figures.
    combined: {
      total: combinedTotal,
      planned: summary.planned, // road assets have no planned_date concept — activities-only
      totalBreakdown: { activities: summary.total, roadAssets: roadAssetsTotal },
    },
  })
}
