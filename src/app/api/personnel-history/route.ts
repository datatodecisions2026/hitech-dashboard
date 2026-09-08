import { NextRequest, NextResponse } from 'next/server'
import { getIronSession } from 'iron-session'
import { createClient } from '@supabase/supabase-js'
import { sessionOptions, AppSession } from '@/lib/session'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

/*
 * GET /api/personnel-history
 *
 * The HR staff roster (surveycollection_employee — the same records the main
 * portal's /api/employees manages) plus its full audit trail, merged from the
 * two history tables:
 *   - surveycollection_employee_history        → per-field edits (role, phone,
 *     project_name, section_name, status typed as a generic field change)
 *   - surveycollection_employee_status_history → status transitions, kept as a
 *     separate table by the portal with its own previous_status/new_status cols
 *
 * Both key off surveycollection_employee.id (employee_id). This is a DIFFERENT
 * population from the /personnel page's "Activities Reported by Employees" chart
 * (that comes from hitech_report_hitechemployee — field crew named on activity
 * reports, hundreds of them, almost no overlap with this 12-row roster). So this
 * route is roster-driven, not report-driven, and is intentionally NOT narrowed
 * by the dashboard's category/project/chainage filters — those describe activity
 * reports, and neither history table links to a report.
 *
 * The three tables are tiny (~12 + 25 + 7 rows), so everything is returned in
 * one payload and the client groups by employee_id locally — clicking an
 * employee is instant, no per-employee round trip. No RPC / pagination needed.
 */

type HistoryEvent = {
  employeeId: number
  kind: 'field' | 'status'
  field: string          // 'role' | 'phone_number' | 'status' | …
  oldValue: string | null
  newValue: string | null
  changedBy: string
  changedAt: string      // ISO timestamptz
}

const clean = (v: unknown) => {
  const s = typeof v === 'string' ? v.trim() : v == null ? '' : String(v)
  return s === '' ? null : s
}

export async function GET(req: NextRequest) {
  const res = NextResponse.json({})
  const session = await getIronSession<AppSession>(req, res, sessionOptions)
  if (!session.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [empRes, histRes, statusRes] = await Promise.all([
    supabase
      .from('surveycollection_employee')
      .select('id, name, role, status, project_name, section_name, date_added')
      .order('id', { ascending: true }),
    supabase
      .from('surveycollection_employee_history')
      .select('employee_id, employee_name, field_name, old_value, new_value, changed_by, changed_at'),
    supabase
      .from('surveycollection_employee_status_history')
      .select('employee_id, employee_name, previous_status, new_status, changed_by, changed_at'),
  ])

  // Surface a real failure rather than an empty-looking 200 — the /progress
  // "silent zeros" lesson (see src/app/api/progress/route.ts).
  const firstErr = empRes.error || histRes.error || statusRes.error
  if (firstErr) {
    console.error('[personnel-history] query failed:', firstErr.message)
    return NextResponse.json({ error: 'Failed to load personnel history.' }, { status: 503 })
  }

  const employees = (empRes.data ?? []).map(e => ({
    id: e.id as number,
    name: (typeof e.name === 'string' ? e.name.trim() : String(e.name ?? '')) || `Employee #${e.id}`,
    role: clean(e.role) ?? '—',
    status: clean(e.status) ?? '—',
    projectName: clean(e.project_name),
    sectionName: clean(e.section_name),
    dateAdded: e.date_added as string | null,
    removed: false,
  }))

  const fieldEvents: HistoryEvent[] = (histRes.data ?? []).map(h => ({
    employeeId: h.employee_id as number,
    kind: 'field',
    field: (h.field_name as string) || 'field',
    oldValue: clean(h.old_value),
    newValue: clean(h.new_value),
    changedBy: clean(h.changed_by) ?? 'system',
    changedAt: h.changed_at as string,
  }))

  const statusEvents: HistoryEvent[] = (statusRes.data ?? []).map(s => ({
    employeeId: s.employee_id as number,
    kind: 'status',
    field: 'status',
    oldValue: clean(s.previous_status),
    newValue: clean(s.new_status),
    changedBy: clean(s.changed_by) ?? 'system',
    changedAt: s.changed_at as string,
  }))

  // A status transition is written to BOTH tables by the portal — once into
  // surveycollection_employee_status_history and once into
  // surveycollection_employee_history as a generic field_name='status' row,
  // ~a fraction of a second apart. Drop the generic copy when the dedicated
  // status-history row already covers it (same employee, same old→new value,
  // within a 2s window), so the timeline shows each real change once.
  const bucket = (t: string) => Math.round(new Date(t).getTime() / 1000)
  const statusKeys = new Set<string>()
  for (const s of statusEvents)
    for (const d of [-2, -1, 0, 1, 2])
      statusKeys.add(`${s.employeeId}|${s.oldValue ?? ''}|${s.newValue ?? ''}|${bucket(s.changedAt) + d}`)

  const dedupedFieldEvents = fieldEvents.filter(f => {
    if (f.field !== 'status') return true
    return !statusKeys.has(`${f.employeeId}|${f.oldValue ?? ''}|${f.newValue ?? ''}|${bucket(f.changedAt)}`)
  })

  const history = [...dedupedFieldEvents, ...statusEvents].sort(
    (a, b) => new Date(b.changedAt).getTime() - new Date(a.changedAt).getTime()
  )

  // Employees deleted from the roster still have their audit trail here — an
  // audit log that disappears with the record isn't much of an audit log. Add
  // them back as read-only "removed" roster entries, named from the denormalized
  // employee_name the history rows carry.
  const rosterIds = new Set(employees.map(e => e.id))
  const orphanIds = [...new Set(history.map(h => h.employeeId))].filter(id => !rosterIds.has(id))
  const nameFor = (id: number) => {
    const src = [...(histRes.data ?? []), ...(statusRes.data ?? [])].find(r => r.employee_id === id)
    const n = src && typeof src.employee_name === 'string' ? src.employee_name.trim() : ''
    return n || `Employee #${id}`
  }
  for (const id of orphanIds) {
    employees.push({
      id, name: nameFor(id), role: '—', status: 'Removed',
      projectName: null, sectionName: null, dateAdded: null, removed: true,
    })
  }

  return NextResponse.json(
    { employees, history },
    { headers: { 'Cache-Control': 'private, max-age=20, stale-while-revalidate=60' } }
  )
}
