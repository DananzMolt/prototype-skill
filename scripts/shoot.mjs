#!/usr/bin/env node
// Screenshot places in a prototype session at desktop and phone size.
// Usage: shoot.mjs <app-url> <out-dir> <route...> [--theme=dark] [--focus=1] [--click=<css>]... [--ref=<png>]
// Routes are the page's hash routes: "/" (session lobby), "hero" (a prototype's lobby),
// "hero/A" (one variant), "hero/A/open" (a state from its meta). Files are named
// hero-A-desktop.png, hero-A-mobile-dark.png …
// Normally run through `proto shoot`, which fills in the URL and folder.
//
// --ref=<png> (a screenshot of the real screen) adds, per route, the variant's screen alone
// (hero-A-screen.png: a phone at 3x without its bezel, a web stage at 2x) and a contact sheet
// (hero-A-vs-ref.png): the variant, the reference, and the two laid over each other.
//
// Drives Chrome over the DevTools protocol so the phone shot is a real 390px mobile
// viewport, and waits for the page to say it is ready instead of sleeping.
import { spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { findChrome } from './chrome.mjs'

const args = process.argv.slice(2)
const flags = Object.fromEntries(args.filter(a => a.startsWith('--') && !a.startsWith('--click=')).map(a => a.slice(2).split('=')))
const clicks = args.filter(a => a.startsWith('--click=')).map(a => a.slice(8))
const [rawUrl, outDir, ...routes] = args.filter(a => !a.startsWith('--'))
if (!rawUrl || !outDir || routes.length === 0) {
  console.error('usage: shoot.mjs <app-url> <out-dir> <route...> [--theme=dark] [--focus=1]')
  process.exit(1)
}

const CHROME = findChrome()
const SIZES = [
  { name: 'desktop', width: 1440, height: 900, deviceScaleFactor: 2, mobile: false },
  { name: 'mobile', width: 390, height: 844, deviceScaleFactor: 3, mobile: true },
]
const base = new URL(rawUrl)
base.hash = ''
base.searchParams.set('theme', flags.theme === 'dark' ? 'dark' : 'light') // headless Chrome may report a dark system theme
if (flags.focus) base.searchParams.set('focus', '1')
const suffix = [flags.focus && 'focus', flags.theme === 'dark' && 'dark', clicks.length && 'clicked'].filter(Boolean).map(s => `-${s}`).join('')
const fileOf = route => route.replace(/^\/+|\/+$/g, '').replace(/\//g, '-') || 'session'

mkdirSync(outDir, { recursive: true })
const profile = mkdtempSync(join(tmpdir(), 'proto-shoot-'))
const chrome = spawn(CHROME, [
  '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] })
const cleanup = () => {
  chrome.kill('SIGKILL')
  // Chrome can still be writing its profile for a moment after the kill.
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }) } catch { /* temp dir, the OS clears it */ }
}
const timer = setTimeout(() => { console.error('shoot: timed out'); cleanup(); process.exit(1) }, 180_000)

try {
  const wsUrl = await new Promise((ok, fail) => {
    let buf = ''
    chrome.stderr.on('data', d => { buf += d; const m = buf.match(/DevTools listening on (ws:\/\/\S+)/); if (m) ok(m[1]) })
    chrome.on('exit', () => fail(new Error('Chrome exited before DevTools was ready')))
  })
  const ws = new WebSocket(wsUrl)
  await new Promise((ok, fail) => { ws.onopen = ok; ws.onerror = fail })
  let nextId = 0
  const pending = new Map()
  ws.onmessage = e => {
    const msg = JSON.parse(e.data)
    if (msg.id && pending.has(msg.id)) {
      const { ok, fail } = pending.get(msg.id)
      pending.delete(msg.id)
      msg.error ? fail(new Error(msg.error.message)) : ok(msg.result)
    }
  }
  const send = (method, params = {}, sessionId) => new Promise((ok, fail) => {
    const id = ++nextId
    pending.set(id, { ok, fail })
    ws.send(JSON.stringify({ id, method, params, sessionId }))
  })
  const sleep = ms => new Promise(r => setTimeout(r, ms))

  for (const size of SIZES) {
    for (const route of routes) {
      // A fresh tab per shot: the page reads its route and theme only at load.
      const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
      const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
      await send('Emulation.setDeviceMetricsOverride', {
        width: size.width, height: size.height, deviceScaleFactor: size.deviceScaleFactor, mobile: size.mobile,
      }, sessionId)
      if (size.mobile) await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }, sessionId)
      const url = new URL(base)
      url.hash = '/' + route.replace(/^\/+/, '')
      await send('Page.navigate', { url: url.href }, sessionId)
      for (let i = 0; i < 100; i++) {
        const { result } = await send('Runtime.evaluate', { expression: 'document.documentElement.dataset.ready === "1"', returnByValue: true }, sessionId)
        if (result.value) break
        await sleep(100)
      }
      await sleep(400) // let images and the first crossfade settle
      // A state route whose clicks found nothing still shoots, but says so.
      const { result: miss } = await send('Runtime.evaluate', { expression: `[...document.querySelectorAll('[data-missed]')].map(e => e.textContent).join('; ')`, returnByValue: true }, sessionId)
      if (miss.value) console.error(`shoot: ${miss.value} on ${route}`)
      // Interaction states: click each selector inside the design, in order.
      for (const sel of clicks) {
        const { result } = await send('Runtime.evaluate', { expression: `(() => { const el = document.querySelector('[data-layers]').querySelector(${JSON.stringify(sel)}); el?.click(); return !!el })()`, returnByValue: true }, sessionId)
        if (!result.value) console.error(`shoot: nothing matches ${sel} on ${route}`)
        await sleep(400)
      }
      const { data } = await send('Page.captureScreenshot', { format: 'png' }, sessionId)
      const file = resolve(outDir, `${fileOf(route)}-${size.name}${suffix}.png`)
      writeFileSync(file, Buffer.from(data, 'base64'))
      console.log(file)
      await send('Target.closeTarget', { targetId })
    }
  }
  if (flags.ref) {
    for (const route of routes) {
      const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
      const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
      // Tall enough that the shell shows the phone at 100%; 3x is an iPhone screenshot's scale.
      await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1400, deviceScaleFactor: 3, mobile: false }, sessionId)
      const url = new URL(base)
      url.hash = '/' + route.replace(/^\/+/, '')
      await send('Page.navigate', { url: url.href }, sessionId)
      for (let i = 0; i < 100; i++) {
        const { result } = await send('Runtime.evaluate', { expression: 'document.documentElement.dataset.ready === "1"', returnByValue: true }, sessionId)
        if (result.value) break
        await sleep(100)
      }
      await sleep(400)
      for (const sel of clicks) {
        await send('Runtime.evaluate', { expression: `document.querySelector('[data-layers]').querySelector(${JSON.stringify(sel)})?.click()` }, sessionId)
        await sleep(400)
      }
      // The screen alone: the phone's rounded corners would hide what the reference shows there.
      const { result: box } = await send('Runtime.evaluate', { returnByValue: true, expression: `(() => {
        const layers = document.querySelector('[data-layers]'), phone = layers.querySelector('[data-phone]')
        if (phone) { phone.style.zoom = '1'; phone.style.borderRadius = '0' }
        const r = (phone || layers).querySelector('[data-mount]').getBoundingClientRect()
        return { x: r.x, y: r.y, width: r.width, height: r.height, phone: !!phone }
      })()` }, sessionId)
      const { x, y, width, height, phone } = box.value
      const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x, y, width, height, scale: phone ? 1 : 2 / 3 } }, sessionId)
      const screen = resolve(outDir, `${fileOf(route)}-screen.png`)
      writeFileSync(screen, Buffer.from(data, 'base64'))
      console.log(screen)
      await send('Target.closeTarget', { targetId })

      // Three panels at one height: the variant, the reference, and the variant at half opacity
      // over the reference, where any shift in size or position shows as a double edge.
      const H = 1100
      const img = (src, extra = '') => `<img src="${pathToFileURL(src).href}" style="height:${H}px;display:block;${extra}">`
      const panel = (label, body) => `<figure style="margin:0"><figcaption style="margin:0 0 12px">${label}</figcaption><div style="position:relative;height:${H}px;width:max-content">${body}</div></figure>`
      const html = `<!doctype html><body style="margin:0;padding:24px;display:flex;gap:24px;width:max-content;background:#18181b;color:#fff;font:600 22px system-ui">${
        panel('Variant', img(screen))}${panel('Reference', img(flags.ref))}${panel('Overlay', img(flags.ref) + img(screen, 'position:absolute;inset:0 auto auto 0;opacity:.5'))}</body>`
      const page = resolve(outDir, `.${fileOf(route)}-vs-ref.html`)
      writeFileSync(page, html)
      const t = await send('Target.createTarget', { url: 'about:blank' })
      const { sessionId: sid } = await send('Target.attachToTarget', { targetId: t.targetId, flatten: true })
      await send('Emulation.setDeviceMetricsOverride', { width: 2400, height: H + 120, deviceScaleFactor: 1, mobile: false }, sid)
      await send('Page.navigate', { url: pathToFileURL(page).href }, sid)
      const { result: size } = await send('Runtime.evaluate', { awaitPromise: true, returnByValue: true, expression: `(async () => {
        while (document.readyState !== 'complete') await new Promise(r => setTimeout(r, 50))
        await Promise.all([...document.images].map(i => i.decode()))
        return [document.body.scrollWidth, document.body.scrollHeight]
      })()` }, sid)
      const [w, h] = size.value
      const sheet = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: w, height: h, scale: 1 }, captureBeyondViewport: true }, sid)
      const file = resolve(outDir, `${fileOf(route)}-vs-ref.png`)
      writeFileSync(file, Buffer.from(sheet.data, 'base64'))
      rmSync(page)
      console.log(file)
      await send('Target.closeTarget', { targetId: t.targetId })
    }
  }
  ws.close()
} catch (err) {
  console.error('shoot:', err.message)
  process.exitCode = 1
} finally {
  clearTimeout(timer)
  cleanup()
}
