import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'

for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.replace(/\r$/, '').match(/^([A-Z_]+)=(.*)$/)
  if (m) process.env[m[1]] = m[2].trim()
}

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

const rpcFilters = { p_project: 'Coastal Road', p_entity: null, p_side: null, p_month: null, p_ch_from: null, p_ch_to: null }

async function rpcWithRetry(name, params) {
  let result = await supabase.rpc(name, params)
  if (result.error) {
    result = await supabase.rpc(name, params)
  }
  return result
}

async function callAllConcurrentWithRetry() {
  const [summary, entities, monthly, curve, delay] = await Promise.all([
    rpcWithRetry('progress_summary_counts', rpcFilters),
    rpcWithRetry('progress_unique_entity_names', { p_project: 'Coastal Road' }),
    rpcWithRetry('progress_monthly_breakdown', rpcFilters),
    rpcWithRetry('progress_curve', rpcFilters),
    rpcWithRetry('progress_delay_rows', { ...rpcFilters, p_limit: 1000 }),
  ])
  return summary.data?.[0]?.total_filtered ?? 'ERR:' + JSON.stringify(summary.error)
}

console.log('--- CONCURRENT (5-way Promise.all) WITH retry-on-error, 30 runs ---')
let fails = 0
for (let i = 1; i <= 30; i++) {
  const v = await callAllConcurrentWithRetry()
  if (v !== 579703) { fails++; console.log(`run ${i}: FAIL total_filtered=${v}`) }
}
console.log(`FAILURES: ${fails}/30`)
