#!/usr/bin/env node
// Screenshot places in a prototype session at desktop and phone size.
// Usage: shoot.mjs <app-url> <out-dir> <route...> [--theme=dark] [--focus=1] [--click=<css>]...
// Routes are the page's hash routes: "/" (session lobby), "hero" (a prototype's lobby),
// "hero/A" (one variant). Files are named hero-A-desktop.png, hero-A-mobile-dark.png …
// Normally run through `proto shoot`, which fills in the URL and folder.
//
// Drives Chrome over the DevTools protocol so the phone shot is a real 390px mobile
// viewport, and waits for the page to say it is ready instead of sleeping.
import { spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const args = process.argv.slice(2)
const flags = Object.fromEntries(args.filter(a => a.startsWith('--') && !a.startsWith('--click=')).map(a => a.slice(2).split('=')))
const clicks = args.filter(a => a.startsWith('--click=')).map(a => a.slice(8))
const [rawUrl, outDir, ...routes] = args.filter(a => !a.startsWith('--'))
if (!rawUrl || !outDir || routes.length === 0) {
  console.error('usage: shoot.mjs <app-url> <out-dir> <route...> [--theme=dark] [--focus=1]')
  process.exit(1)
}

const CHROME = process.env.CHROME || (process.platform === 'win32'
  ? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
  : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
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
  ws.close()
} catch (err) {
  console.error('shoot:', err.message)
  process.exitCode = 1
} finally {
  clearTimeout(timer)
  cleanup()
}
