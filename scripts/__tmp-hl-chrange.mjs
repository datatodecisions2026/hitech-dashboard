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
const errors = []
page.on('pageerror', e => errors.push(String(e)))
await page.goto(`${BASE}/dashboard?chFrom=15000&chTo=20000`, { waitUntil: 'load', timeout: 30000 })
await page.waitForTimeout(9000)
const mapFrame = await page.$('.hitech-map-frame')
await mapFrame.scrollIntoViewIfNeeded()
await page.waitForTimeout(2500)
await page.screenshot({ path: 'scripts/hl-chrange.png', fullPage: false })
console.log('errors:', errors)
await browser.close()
