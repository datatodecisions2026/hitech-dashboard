import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

/** Fetch ALL rows paginated 1000 at a time */
async function fetchAll<T = Record<string, unknown>>(
  table: string,
  columns: string,
  filters: Record<string, string> = {}
): Promise<T[]> {
  const all: T[] = []
  const PAGE = 1000
  let from = 0
  while (true) {
    let q = supabase.from(table).select(columns).range(from, from + PAGE - 1)
    for (const [k, v] of Object.entries(filters)) {
      q = (q as any).eq(k, v)
    }
    const { data, error } = await q
    if (error || !data || data.length === 0) break
    all.push(...data)
    if (data.length < PAGE) break
    from += PAGE
  }
  return all
}

// Map project name → project_id in surveycollection_project
const PROJECT_ID_MAP: Record<string, number> = {
  'Coastal Road':               1,
  'Coastal road':               1,
  'coastal road':               1,
  'Refinery Road':              5,
  'Refinery road':              5,
  'SBS Sokoto Badagry highway': 7,
  'Benin road':                 3,
  'Benin Road':                 3,
  'Abuja road':                 4,
  'Abuja Road':                 4,
}

export async function GET(req: NextRequest) {

  const { searchParams } = new URL(req.url)
  const project   = searchParams.get('project') || 'Coastal Road'
  const projectId = PROJECT_ID_MAP[project] ?? 1

  // Fetch chainage stations for this project
  const stations = await fetchAll(
    'hitech_report_chainage',
    'label, chainage, latitude, longitude, project_id',
    { project_id: String(projectId) }
  )

  // Fetch activity reports for this project that have chainage values
  const { data: reports } = await supabase
    .from('hitech_report_hitechreport')
    .select(
      'id, start_chainage, end_chainage, start_chainage_val, end_chainage_val, ' +
      'activity_category, activity_type, activity_status, ' +
      'reporter_name, date_of_activity, project_name, section_name, ' +
      'start_chainage_lat, start_chainage_long, end_chainage_lat, end_chainage_long'
    )
    .ilike('project_name', `%${project.split(' ')[0]}%`)
    .limit(5000)

  return NextResponse.json({
    stations,
    reports:   reports ?? [],
    projectId,
    project,
  })
}
