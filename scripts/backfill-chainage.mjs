import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  'https://cwqfyhapaycabynqwczx.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN3cWZ5aGFwYXljYWJ5bnF3Y3p4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MjgwMzQzMywiZXhwIjoyMDc4Mzc5NDMzfQ.3h33CQjswz-z5Gx2VdvJelqVe2WPpUkKTI_j_MDHMws'
)

// project_name (case-insensitive prefix) → project_id in hitech_report_chainage
const PROJECT_ID_MAP = {
  'coastal':  1,
  'refinery': 5,
  'sbs':      7,
  'benin':    3,
  'abuja':    4,
}

function projectIdForName(name) {
  if (!name) return null
  const lower = name.toLowerCase()
  for (const [prefix, id] of Object.entries(PROJECT_ID_MAP)) {
    if (lower.includes(prefix)) return id
  }
  return null
}

function parseChainage(ch) {
  if (!ch) return null
  const m = ch.trim().match(/^(\d+)\+(\d+)$/)
  if (!m) return null
  return parseInt(m[1], 10) * 1000 + parseInt(m[2], 10)
}

// Euclidean distance² on lat/lng (good enough for nearest-station search)
function dist2(lat1, lng1, lat2, lng2) {
  const dlat = lat1 - lat2
  const dlng = lng1 - lng2
  return dlat * dlat + dlng * dlng
}

// ── 1. Load all chainage stations ──────────────────────────────────────────
console.log('Loading chainage stations...')
const stationsByProject = {}
const PAGE = 1000
let from = 0
let totalStations = 0

while (true) {
  const { data, error } = await supabase
    .from('hitech_report_chainage')
    .select('label, chainage, latitude, longitude, project_id')
    .range(from, from + PAGE - 1)

  if (error) { console.error('Station fetch error:', error); process.exit(1) }
  if (!data || data.length === 0) break

  for (const s of data) {
    const pid = s.project_id
    if (!stationsByProject[pid]) stationsByProject[pid] = []
    stationsByProject[pid].push({
      lat:      s.latitude,
      lng:      s.longitude,
      chainage: s.chainage,
      val:      parseInt(s.label, 10),  // label is the metre integer
    })
  }

  totalStations += data.length
  if (data.length < PAGE) break
  from += PAGE

  if (totalStations % 50000 === 0) process.stdout.write(`  ${totalStations} stations loaded...\r`)
}
console.log(`Loaded ${totalStations} stations across ${Object.keys(stationsByProject).length} projects.`)

// ── 2. Load legacy reports with GPS but no chainage_val ────────────────────
console.log('\nLoading reports with GPS but no chainage_val...')
const reports = []
from = 0

while (true) {
  const { data, error } = await supabase
    .from('hitech_report_hitechreport')
    .select('id, project_name, start_chainage_lat, start_chainage_long, end_chainage_lat, end_chainage_long')
    .is('start_chainage_val', null)
    .not('start_chainage_lat', 'is', null)
    .range(from, from + PAGE - 1)

  if (error) { console.error('Report fetch error:', error); process.exit(1) }
  if (!data || data.length === 0) break

  reports.push(...data)
  if (data.length < PAGE) break
  from += PAGE
}
console.log(`Found ${reports.length} reports to backfill.`)

// ── 3. Match each report to nearest station ────────────────────────────────
console.log('\nMatching reports to nearest chainage stations...')

function nearestStation(stations, lat, lng) {
  if (!stations || stations.length === 0) return null
  let best = null
  let bestD = Infinity
  for (const s of stations) {
    const d = dist2(lat, lng, s.lat, s.lng)
    if (d < bestD) { bestD = d; best = s }
  }
  return best
}

let updated = 0
let skipped = 0
let noProject = 0
const BATCH = 50  // parallel updates

for (let i = 0; i < reports.length; i += BATCH) {
  const chunk = reports.slice(i, i + BATCH)

  await Promise.all(chunk.map(async (r) => {
    const pid = projectIdForName(r.project_name)
    if (!pid || !stationsByProject[pid]) {
      noProject++
      return
    }

    const startLat = parseFloat(r.start_chainage_lat)
    const startLng = parseFloat(r.start_chainage_long)
    if (isNaN(startLat) || isNaN(startLng)) { skipped++; return }

    const startStation = nearestStation(stationsByProject[pid], startLat, startLng)
    if (!startStation) { skipped++; return }

    const patch = {
      start_chainage:     startStation.chainage,
      start_chainage_val: startStation.val,
    }

    // end GPS → end chainage
    if (r.end_chainage_lat && r.end_chainage_long) {
      const endLat = parseFloat(r.end_chainage_lat)
      const endLng = parseFloat(r.end_chainage_long)
      if (!isNaN(endLat) && !isNaN(endLng)) {
        const endStation = nearestStation(stationsByProject[pid], endLat, endLng)
        if (endStation) {
          patch.end_chainage     = endStation.chainage
          patch.end_chainage_val = endStation.val
        }
      }
    }

    const { error } = await supabase
      .from('hitech_report_hitechreport')
      .update(patch)
      .eq('id', r.id)

    if (error) { console.error(`  id=${r.id} update failed:`, error.message); skipped++ }
    else updated++
  }))

  process.stdout.write(`  Progress: ${Math.min(i + BATCH, reports.length)}/${reports.length}\r`)
}

console.log(`\n\nDone.`)
console.log(`  Updated:             ${updated}`)
console.log(`  Skipped (no GPS):    ${skipped}`)
console.log(`  Skipped (no project map): ${noProject}`)
