import { chromium } from 'playwright'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'

const sealed = readFileSync(fileURLToPath(new URL('../.tmp-session-cookie.txt', import.meta.url)), 'utf8').trim()
const BASE = 'http://localhost:3000'
const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
await context.addCookies([{ name: 'hitech-dashboard-session', value: sealed, domain: 'localhost', path: '/', httpOnly: true }])
const page = await context.newPage()

async function waitForIdle() {
  await page.waitForFunction(() => {
    const el = [...document.querySelectorAll('*')].find(e => e.children.length === 0 && e.textContent.trim() === 'LOADING')
    return !el
  }, { timeout: 20000 })
}

async function waitForUrlChange(prevUrl) {
  await page.waitForFunction((p) => location.href !== p, prevUrl, { timeout: 30000 })
}

async function clickFirstBar(panelTitle) {
  return page.evaluate((title) => {
    const titleSpan = [...document.querySelectorAll('span')].find(s => s.textContent.trim() === title)
    if (!titleSpan) return { ok: false, reason: 'panel title not found' }
    const panelDiv = titleSpan.parentElement.parentElement.parentElement
    const chartRoot = panelDiv.children[1]
    if (!chartRoot || !chartRoot.children.length) return { ok: false, reason: 'no bar rows' }
    const row = chartRoot.children[0]
    const nameSpan = row.querySelector('span')
    const name = nameSpan ? nameSpan.textContent.trim() : row.textContent.trim()
    row.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    return { ok: true, name }
  }, panelTitle)
}

await page.goto(`${BASE}/dashboard`, { waitUntil: 'load' })
await page.waitForFunction(() => document.body.innerText.includes('TOTAL ACTIVITY REPORTS'), { timeout: 30000 })
await waitForIdle()

for (const [panel, param] of [
  ['Machines Used', 'machine'],
  ['Top Employees', 'employee'],
  ['Engineers Activity', 'engineer'],
  ['Supervisors Activity', 'supervisor'],
  ['Weather Conditions', 'weather'],
]) {
  console.log(`\n=== ${panel} ===`)
  const prevUrl = page.url()
  const r = await clickFirstBar(panel)
  console.log('click result:', r)
  if (!r.ok) continue
  await waitForUrlChange(prevUrl)
  await waitForIdle()
  console.log('url:', page.url())
  console.log(`url has ${param}= param:`, page.url().includes(`${param}=`))
  const summary = await page.evaluate(() => {
    const el = [...document.querySelectorAll('div')].find(d => d.textContent.startsWith('Filtered:'))
    return el ? el.textContent : null
  })
  console.log('filtered summary chip:', summary)

  // clear via Clear button before next iteration
  const beforeClear = page.url()
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find(b => b.textContent.includes('Clear'))
    if (btn) btn.click()
  })
  await waitForUrlChange(beforeClear)
  await waitForIdle()
  console.log('url after clear:', page.url())
}

await browser.close()
