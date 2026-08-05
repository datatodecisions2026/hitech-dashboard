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

export async function GET(req: NextRequest) {
  const res = NextResponse.json({})
  const session = await getIronSession<AppSession>(req, res, sessionOptions)
  if (!session.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const project = searchParams.get('project') || 'Coastal Road'

  const { data, error } = await rpcWithRetry<SectionRow[]>('progress_section_breakdown', { p_project: project })

  if (error) {
    console.error('[planning-implementation] giving up after retry:', error.message)
    return NextResponse.json({ error: 'Failed to load planning/implementation data, please retry.' }, { status: 503 })
  }

  const sections = (data ?? [])
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

  return NextResponse.json({
    project,
    sections,
    summary: {
      ...summary,
      sectionCount: sections.filter(r => r.section !== 'Unlinked / No Section').length,
      plannedPct: summary.total > 0 ? Math.round((summary.planned / summary.total) * 100) : 0,
      implementedPct: summary.total > 0 ? Math.round((summary.implemented / summary.total) * 100) : 0,
    },
  })
}
