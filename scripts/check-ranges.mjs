import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  'https://cwqfyhapaycabynqwczx.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN3cWZ5aGFwYXljYWJ5bnF3Y3p4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MjgwMzQzMywiZXhwIjoyMDc4Mzc5NDMzfQ.3h33CQjswz-z5Gx2VdvJelqVe2WPpUkKTI_j_MDHMws'
)

// Fetch all records with chainage data, paginated
const all = []
let from = 0
while (true) {
  const { data, error } = await supabase
    .from('hitech_report_hitechreport')
    .select('project_name, start_chainage, start_chainage_val')
    .not('start_chainage_val', 'is', null)
    .range(from, from + 999)
  if (error || !data || data.length === 0) break
  all.push(...data)
  if (data.length < 1000) break
  from += 1000
}

const projects = {}
for (const r of all) {
  const p = r.project_name
  const v = Number(r.start_chainage_val)
  if (isNaN(v)) continue
  if (!projects[p]) projects[p] = { min: Infinity, max: -Infinity, minCh: '', maxCh: '', count: 0 }
  if (v < projects[p].min) { projects[p].min = v; projects[p].minCh = r.start_chainage }
  if (v > projects[p].max) { projects[p].max = v; projects[p].maxCh = r.start_chainage }
  projects[p].count++
}

for (const [p, v] of Object.entries(projects)) {
  const span = v.max - v.min
  const q1 = Math.floor(v.min + span * 0.25)
  const q3 = Math.floor(v.min + span * 0.75)
  console.log(`\n${p}  (${v.count} reports)`)
  console.log(`  Full range:    ${v.minCh} → ${v.maxCh}`)
  console.log(`  ┌ Test A (lower quarter): ch_from=${v.min}  ch_to=${q1}`)
  console.log(`  ├ Test B (middle half):   ch_from=${q1}     ch_to=${q3}`)
  console.log(`  └ Test C (upper quarter): ch_from=${q3}     ch_to=${v.max}`)
}
