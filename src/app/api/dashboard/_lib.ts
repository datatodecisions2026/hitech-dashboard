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

export function activeFiltersFrom(sp: URLSearchParams) {
  const g = (k: string) => sp.get(k) || ''
  return {
    filterCategory: g('category'), filterProject: g('project'), filterSection: g('section'),
    filterDateFrom: g('date_from'), filterDateTo: g('date_to'),
    filterChFrom: g('ch_from'), filterChTo: g('ch_to'), filterSearch: g('search'),
    filterWeather: g('weather'), filterMachine: g('machine'),
    filterEmployee: g('employee'), filterEngineer: g('engineer'), filterSupervisor: g('supervisor'),
    filterOwnership: g('ownership'), filterDriver: g('driver'),
    filterEmployeeRole: g('employee_role'), filterEngineerParty: g('engineer_party'),
    filterSupervisorParty: g('supervisor_party'),
  }
}

// retry-once on a hard RPC error (a canceled/timed-out query sets .error) —
// mirrors /api/progress's rpcWithRetry.
export async function rpcWithRetry(fn: string, args: Record<string, unknown>) {
  let lastErr: unknown = null
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data, error } = await supabase.rpc(fn, args)
    if (!error) return { data, error: null as null }
    lastErr = error
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
