import { chromium } from 'playwright'
import { readFileSync } from 'fs'

const sealed = readFileSync(new URL('../cookie.tmp.txt', import.meta.url), 'utf8').trim()
const BASE = 'http://localhost:3931'
const errors = []

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1440, height: 1200 } })
await context.addCookies([{
  name: 'hitech-dashboard-session', value: sealed, domain: 'localhost', path: '/', httpOnly: true,
}])
const page = await context.newPage()
page.on('console', msg => { if (msg.type() === 'error') errors.push(`console: ${msg.text()}`) })
page.on('pageerror', err => errors.push(`pageerror: ${err.message}`))

async function waitForKpis(timeout = 20000) {
  // innerText reflects CSS text-transform:uppercase, so match case-insensitively
  await page.waitForFunction(() => document.body.innerText.toUpperCase().includes('TOTAL (COMBINED)'), { timeout })
  await page.waitForTimeout(4000) // let the refetch + count-up animation restart fully settle
}

// 1. No filter — combined nationwide view
await page.goto(`${BASE}/planning-implementation`, { waitUntil: 'load', timeout: 30000 })
await waitForKpis()
const bodyText1 = await page.evaluate(() => document.body.innerText)
console.log('--- unfiltered: has "Total (Combined)"?', bodyText1.includes('Total (Combined)'))
console.log('--- unfiltered: has "7,275,559" (combined total)?', bodyText1.includes('7,275,559'))
await page.screenshot({ path: 'shot-pi-1-unfiltered.png', fullPage: true })

// 2. Select project = Coastal Road (value = 'coastal-road')
await page.selectOption('select >> nth=0', 'coastal-road')
await waitForKpis()
const bodyText2 = await page.evaluate(() => document.body.innerText)
console.log('--- after project=Coastal Road: has "1,749,981"?', bodyText2.includes('1,749,981'))
await page.screenshot({ path: 'shot-pi-2-coastal.png', fullPage: true })

// 3. Select section = Section 3 - Calabar (value = exact section string)
await page.selectOption('select >> nth=1', 'Section 3 - Calabar')
await page.waitForTimeout(2500) // client-side filter, instant, but map refetches
const bodyText3 = await page.evaluate(() => document.body.innerText)
console.log('--- after section=Calabar: has "Calabar" in Road Assets by Section?', bodyText3.includes('Calabar'))
console.log('--- after section=Calabar: planning empty state shown?', bodyText3.includes('No planning activities recorded'))
await page.screenshot({ path: 'shot-pi-3-calabar.png', fullPage: true })

// 4. Clear filters
const clearBtn = page.locator('button', { hasText: '✕ Clear' })
if (await clearBtn.count()) { await clearBtn.click(); await waitForKpis() }

// 5. redirect check
await page.goto(`${BASE}/road-assets`, { waitUntil: 'load', timeout: 15000 })
console.log('--- /road-assets redirected to:', page.url())

await context.close()
await browser.close()

console.log('\n=== ERRORS (' + errors.length + ') ===')
errors.forEach(e => console.log(e))
