import { chromium } from 'playwright'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'

const sealed = readFileSync(fileURLToPath(new URL('../.tmp-session-cookie.txt', import.meta.url)), 'utf8').trim()
const BASE = 'http://localhost:3000'

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
await context.addCookies([{
  name: 'hitech-dashboard-session', value: sealed, domain: 'localhost', path: '/', httpOnly: true,
}])
const page = await context.newPage()

async function waitForIdle() {
  await page.waitForFunction(() => {
    const el = [...document.querySelectorAll('*')].find(e => e.children.length === 0 && e.textContent.trim() === 'LOADING')
    return !el
  }, { timeout: 20000 })
}

async function clickFirstLegendItem(panelTitle) {
  return page.evaluate((title) => {
    const titleSpan = [...document.querySelectorAll('span')].find(s => s.textContent.trim() === title)
    if (!titleSpan) return { ok: false, reason: 'panel title not found' }
    const panelDiv = titleSpan.parentElement.parentElement.parentElement
    const chartRoot = panelDiv.children[1]
    if (!chartRoot) return { ok: false, reason: 'no chart root' }
    const legendCol = chartRoot.children[1]
    if (!legendCol || !legendCol.children.length) return { ok: false, reason: 'no legend column/items' }
    const item = legendCol.children[0]
    const name = item.children[1] ? item.children[1].textContent.trim() : item.textContent.trim()
    item.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    return { ok: true, name }
  }, panelTitle)
}

async function clickFirstBar(panelTitle) {
  return page.evaluate((title) => {
    const titleSpan = [...document.querySelectorAll('span')].find(s => s.textContent.trim() === title)
    if (!titleSpan) return { ok: false, reason: 'panel title not found' }
    const panelDiv = titleSpan.parentElement.parentElement.parentElement
    const chartRoot = panelDiv.children[1]
    if (!chartRoot || !chartRoot.children.length) return { ok: false, reason: 'no bar rows' }
    const row = chartRoot.children[0]
    const nameSpan = row.children[1]
    const name = nameSpan ? nameSpan.textContent.trim() : row.textContent.trim()
    row.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    return { ok: true, name }
  }, panelTitle)
}

await page.goto(`${BASE}/dashboard`, { waitUntil: 'load' })
await page.waitForFunction(() => document.body.innerText.includes('TOTAL ACTIVITY REPORTS'), { timeout: 30000 })
await waitForIdle()

console.log('=== CATEGORY DONUT: click to set filter ===')
console.log('url before:', page.url())
const r1 = await clickFirstLegendItem('Activity by Category')
console.log('click result:', r1)
await waitForIdle()
console.log('url after:', page.url())
let body = await page.evaluate(() => document.body.innerText)
console.log('has "Clear" chip:', body.includes('Clear'))
console.log('body contains clicked name:', r1.ok ? body.includes(r1.name) : 'n/a')

console.log('\n=== CATEGORY DONUT: click same slice again to clear ===')
const r1b = await clickFirstLegendItem('Activity by Category')
console.log('click result:', r1b)
await waitForIdle()
console.log('url after toggle-off:', page.url())
console.log('EXPECT: no ?category param ->', !page.url().includes('category='))

console.log('\n=== TOP PROJECTS BAR: click to set filter ===')
const r2 = await clickFirstBar('Top Projects by Reports')
console.log('click result:', r2)
await waitForIdle()
console.log('url after:', page.url())
body = await page.evaluate(() => document.body.innerText)
console.log('body contains clicked project name:', r2.ok ? body.includes(r2.name) : 'n/a')

console.log('\n=== Clear button resets everything ===')
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find(b => b.textContent.includes('Clear'))
  if (btn) btn.click()
})
await waitForIdle()
console.log('url after Clear:', page.url())
console.log('EXPECT: clean /dashboard ->', page.url() === `${BASE}/dashboard`)

await browser.close()
