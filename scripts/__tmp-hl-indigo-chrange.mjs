import { chromium } from 'playwright'
import { sealData } from 'iron-session'
import { readFileSync } from 'fs'

for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.replace(/\r$/, '').match(/^([A-Z_]+)=(.*)$/)
  if (m) process.env[m[1]] = m[2].trim()
}
const sealed = await sealData(
  { user: { id: 1, first_name: 'QA', last_name: 'Tester', email: 'qa@hitech.test', is_staff: true, is_superuser: true, role: 'admin' } },
  { password: process.env.SESSION_SECRET }
)
const BASE = 'http://localhost:3579'
const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
await context.addCookies([{ name: 'hitech-dashboard-session', value: sealed, domain: 'localhost', path: '/', httpOnly: true }])
const page = await context.newPage()
await page.goto(`${BASE}/dashboard?ch_from=15000&ch_to=20000`, { waitUntil: 'load', timeout: 30000 })
await page.waitForTimeout(12000)
const mapFrame = await page.$('.hitech-map-frame')
await mapFrame.scrollIntoViewIfNeeded()
await page.waitForTimeout(3000)
await page.screenshot({ path: 'scripts/hl-chrange-indigo.png', fullPage: false })
await browser.close()
