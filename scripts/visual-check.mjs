import { chromium } from 'playwright'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'

const sealed = readFileSync(fileURLToPath(new URL('../.tmp-session-cookie.txt', import.meta.url)), 'utf8').trim()
const BASE = 'http://localhost:3000'

const viewports = {
  desktop: { width: 1440, height: 900 },
  mobile:  { width: 390,  height: 844 },
}

const browser = await chromium.launch()
const errors = []

for (const [vpName, vp] of Object.entries(viewports)) {
  const context = await browser.newContext({ viewport: vp })
  await context.addCookies([{
    name: 'hitech-dashboard-session',
    value: sealed,
    domain: 'localhost',
    path: '/',
    httpOnly: true,
  }])
  const page = await context.newPage()
  let currentRoute = 'init'
  page.on('console', msg => { if (msg.type() === 'error') { const loc = msg.location(); errors.push(`[${vpName}/${currentRoute}] (${loc.url}:${loc.lineNumber}) ${msg.text()}`) } })
  page.on('pageerror', err => errors.push(`[${vpName}/${currentRoute}] pageerror: ${err.message}`))

  for (const route of ['dashboard', 'progress', 'login']) {
    currentRoute = route
    const readySignal = { dashboard: 'TOTAL ACTIVITY REPORTS', progress: 'OVERALL COMPLETION', login: 'SIGN IN' }[route]
    await page.goto(`${BASE}/${route}`, { waitUntil: 'load', timeout: 30000 }).catch(e => errors.push(`[${vpName}/${route}] nav failed: ${e.message}`))
    await page.waitForFunction((sig) => document.body.innerText.toLowerCase().includes(sig.toLowerCase()), readySignal, { timeout: 30000 }).catch(e => errors.push(`[${vpName}/${route}] ready signal never appeared: ${e.message}`))
    await page.waitForTimeout(500)
    // Scroll through the whole page in steps so IntersectionObserver-based reveal animations fire
    const height = await page.evaluate(() => document.body.scrollHeight)
    for (let y = 0; y < height; y += 400) {
      await page.evaluate(yy => window.scrollTo(0, yy), y)
      await page.waitForTimeout(120)
    }
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.waitForTimeout(300)
    await page.screenshot({ path: fileURLToPath(new URL(`../.tmp-shot-${vpName}-${route}.png`, import.meta.url)), fullPage: true })
    console.log(`captured ${vpName}/${route}`)

    if (route === 'dashboard' && vpName === 'desktop') {
      const badge = page.locator('[data-nextjs-dev-tools-button]').first()
      if (await badge.count()) {
        await badge.click().catch(() => {})
        await page.waitForTimeout(500)
        await page.screenshot({ path: fileURLToPath(new URL(`../.tmp-shot-devoverlay.png`, import.meta.url)) })
        const overlayText = await page.evaluate(() => document.body.innerText)
        console.log('--- overlay text (truncated) ---')
        console.log(overlayText.slice(0, 3000))
      }
    }
  }
  await context.close()
}

await browser.close()
console.log('--- console/page errors ---')
console.log(errors.length ? errors.join('\n') : '(none)')
