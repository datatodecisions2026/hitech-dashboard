import { createClient } from '@supabase/supabase-js'

export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// ── build the dashboard_core / dashboard_extra RPC arg list from the querystring ──
export function dashboardRpcArgs(sp: URLSearchParams) {
  const s = (k: string) => {
    const v = (sp.get(k) || '').trim()
    return v === '' ? null : v
  }
  const chFrom = Number(sp.get('ch_from'))
  const chTo   = Number(sp.get('ch_to'))
  const applyCh = !!(
    sp.get('ch_from') && sp.get('ch_to') &&
    !isNaN(chFrom) && !isNaN(chTo) && chFrom >= 0 && chTo >= 0 && chTo > chFrom
  )
  // strip chars that used to break the PostgREST .or() syntax; kept for parity
  const search = (sp.get('search') || '').replace(/[,()%*]/g, '').trim() || null
  return {
    p_category:         s('category'),
    p_project:          s('project'),
    p_section:          s('section'),
    p_weather:          s('weather'),
    p_status:           s('status'),
    p_date_from:        s('date_from'),
    p_date_to:          s('date_to'),
    p_ch_from:          applyCh ? chFrom : null,
    p_ch_to:            applyCh ? chTo   : null,
    p_search:           search,
    p_machine:          s('machine'),
    p_employee:         s('employee'),
    p_engineer:         s('engineer'),
    p_supervisor:       s('supervisor'),
    p_ownership:        s('ownership'),
    p_driver:           s('driver'),
    p_employee_role:    s('employee_role'),
    p_engineer_party:   s('engineer_party'),
    p_supervisor_party: s('supervisor_party'),
  }
}

// ── party-label normalization ────────────────────────────────────────────────
// The raw `party` column on hitech_report_hitechengineer / hitechsupervisor has
// dirty values that are really only two buckets: "Hitech Employees" (also stored
// as "HITECH Employees") and "Sub-contractor" (also misspelled "Sub-contactor").
// _titlecase() in SQL only fixes the first letter of each word, so those variants
// still render as 4 separate donut slices. Collapse them here, after the RPC, so
// "Engineers by Party" / "Supervisors by Party" show one slice per real party.
// The emitted label is the highest-count raw value in each bucket, so clicking a
// slice still filters by a value that matches the bulk of its rows.
type Series = Array<{ name: string; count: number }>

function partyBucket(name: string): string {
  const n = name.toLowerCase()
  if (n.includes('hitech')) return 'hitech'
  if (/sub[-\s]?cont/.test(n)) return 'sub'
  return n // leave any other value as its own bucket
}

export function normalizePartySeries(series: unknown): Series {
  if (!Array.isArray(series)) return [] as Series
  const groups = new Map<string, { total: number; top: { name: string; count: number } }>()
  for (const row of series as Series) {
    if (!row || typeof row.name !== 'string') continue
    const key = partyBucket(row.name)
    const g = groups.get(key)
    if (!g) {
      groups.set(key, { total: row.count, top: { name: row.name, count: row.count } })
    } else {
      g.total += row.count
      if (row.count > g.top.count) g.top = { name: row.name, count: row.count }
    }
  }
  return [...groups.values()]
    .map(g => ({ name: g.top.name, count: g.total }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
}

// ── ownership normalization ──────────────────────────────────────────────────
// The raw `ownership` column on hitech_report_hitechmachine has ~6 dirty values
// that reduce to two real groups (per the user): everything Hitech ("hitech",
// "HITECH") and everything not ("subcontactor" [sic], "Subcontractor", and
// rented/third-party equipment — "Renting", "Renting - Third party"). Unlike the
// party merge, the labels here are forced to canonical spellings ("Hitech" /
// "Subcontractor") because the dominant raw value in the non-Hitech bucket is
// the misspelling. Anything that matches neither pattern passes through
// unchanged. See the 2026-09-08 (5) changelog.
function ownershipBucket(name: string): { key: string; label: string } | null {
  const n = name.toLowerCase()
  if (n.includes('hitech')) return { key: 'hitech', label: 'Hitech' }
  if (/sub[-\s]?cont/.test(n) || n.includes('rent') || n.includes('third part'))
    return { key: 'sub', label: 'Subcontractor' }
  return null
}

export function normalizeOwnershipSeries(series: unknown): Series {
  if (!Array.isArray(series)) return [] as Series
  const groups = new Map<string, { label: string; total: number }>()
  const passthrough: Series = []
  for (const row of series as Series) {
    if (!row || typeof row.name !== 'string') continue
    const b = ownershipBucket(row.name)
    if (!b) { passthrough.push(row); continue }
    const g = groups.get(b.key)
    if (g) g.total += row.count
    else groups.set(b.key, { label: b.label, total: row.count })
  }
  return [...[...groups.values()].map(g => ({ name: g.label, count: g.total })), ...passthrough]
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
}

// ── "Unknown" handling ───────────────────────────────────────────────────────
// _dash_group() emits the literal label "Unknown" for any blank raw value. For
// the person / weather breakdowns a large blank bucket is real missing data
// (e.g. 4,499 of 6,689 engineer rows have no name recorded, 3,676 of 9,776
// reports have no weather). We don't fabricate that onto real people — instead
// the "Unknown" entry is pulled out of the ranked series so the chart ranks and
// percentages are over named entities only, and its count is surfaced separately
// as `unattributed` so the page can still disclose the gap. See the 2026-09-08
// changelog. Employee blanks are handled upstream in dashboard_core (name falls
// back to employee_missing_name), so this rarely fires for byEmployee.
const UNKNOWN_SPLIT_KEYS = [
  'byEngineer', 'bySupervisor', 'byEmployee', 'byMachine', 'byDriver', 'byOwnership',
  'byWeather', 'byEmployeeRole', 'byEngineerParty', 'bySupervisorParty',
] as const

function splitUnknown(series: unknown): { series: Series; unattributed: number } {
  if (!Array.isArray(series)) return { series: [] as Series, unattributed: 0 }
  let unattributed = 0
  const kept: Series = []
  for (const row of series as Series) {
    if (row && typeof row.name === 'string' && row.name.trim().toLowerCase() === 'unknown') {
      unattributed += row.count || 0
    } else if (row) {
      kept.push(row)
    }
  }
  return { series: kept, unattributed }
}

// Strip "Unknown" from every configured breakdown on the core payload, returning
// the cleaned fields plus an `unattributed` map (only non-zero entries).
export function applyUnknownHandling(core: Record<string, unknown>) {
  const out: Record<string, unknown> = {}
  const unattributed: Record<string, number> = {}
  for (const k of UNKNOWN_SPLIT_KEYS) {
    if (!(k in core)) continue
    const { series, unattributed: n } = splitUnknown(core[k])
    out[k] = series
    if (n > 0) unattributed[k] = n
  }
  return { ...out, unattributed }
}

export function activeFiltersFrom(sp: URLSearchParams) {
  const g = (k: string) => sp.get(k) || ''
  return {
    filterCategory: g('category'), filterProject: g('project'), filterSection: g('section'),
    filterStatus: g('status'),
    filterDateFrom: g('date_from'), filterDateTo: g('date_to'),
    filterChFrom: g('ch_from'), filterChTo: g('ch_to'), filterSearch: g('search'),
    filterWeather: g('weather'), filterMachine: g('machine'),
    filterEmployee: g('employee'), filterEngineer: g('engineer'), filterSupervisor: g('supervisor'),
    filterOwnership: g('ownership'), filterDriver: g('driver'),
    filterEmployeeRole: g('employee_role'), filterEngineerParty: g('engineer_party'),
    filterSupervisorParty: g('supervisor_party'),
  }
}

// PostgREST's "no function matches this name/argument-shape" error — returned
// while the SQL adding a new p_* param (e.g. p_status, 2026-09-25) hasn't been
// applied to this Supabase project yet. Checked by code first (PGRST202) with a
// message fallback, since the exact code isn't guaranteed stable across
// postgrest-js/PostgREST versions.
function isMissingFunctionError(error: unknown): boolean {
  const e = error as { code?: string; message?: string } | null
  return e?.code === 'PGRST202' || /could not find the function/i.test(e?.message || '')
}

// retry-once on a hard RPC error (a canceled/timed-out query sets .error) —
// mirrors /api/progress's rpcWithRetry. Additionally: if the failure looks like
// a missing-function error and the args carry a param this route added after
// the RPC itself was last deployed (currently just p_status — see the
// 2026-09-25 "Activity Status filter" changelog entry), drop that one param and
// retry once with the older signature, so the whole dashboard doesn't 503 for
// every user just because one SQL migration hasn't been applied yet — it only
// means that one new filter silently doesn't narrow anything until it is.
const OPTIONAL_ARGS = ['p_status'] as const

export async function rpcWithRetry(fn: string, args: Record<string, unknown>) {
  let lastErr: unknown = null
  let currentArgs = args
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data, error } = await supabase.rpc(fn, currentArgs)
    if (!error) return { data, error: null as null }
    lastErr = error
    if (attempt === 0 && isMissingFunctionError(error)) {
      // Strip whenever the key is present at all, not just when it carries a
      // real value — PostgREST resolves the function overload by which named
      // arguments were sent, so even p_status: null still fails to match a
      // signature that has no p_status parameter yet.
      const stripped = { ...currentArgs }
      let changed = false
      for (const k of OPTIONAL_ARGS) {
        if (k in stripped) { delete stripped[k]; changed = true }
      }
      if (changed) { currentArgs = stripped; continue }
    }
  }
  return { data: null, error: lastErr }
}

// tiny best-effort in-process response cache (per serverless instance). The
// dashboard payload is identical for every user for a given querystring, so a
// short TTL turns repeat loads / nav-backs into instant hits.
export function makeTtlCache(ttlMs = 30_000, max = 64) {
  const m = new Map<string, { t: number; body: unknown }>()
  return {
    get(key: string) {
      const hit = m.get(key)
      if (hit && Date.now() - hit.t < ttlMs) return hit.body
      return undefined
    },
    set(key: string, body: unknown) {
      m.set(key, { t: Date.now(), body })
      if (m.size > max) m.delete(m.keys().next().value as string)
    },
  }
}
