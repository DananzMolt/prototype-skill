#!/usr/bin/env node
// Screenshot each version of a prototype at desktop and phone size.
// Usage: shoot.mjs <url> <out-dir> <version ids...>   e.g. shoot.mjs http://... shots A B C
// Optional: --theme=dark, --scale=75 (passed to the page as query params).
// The page must show one version when its id is the URL hash (#A, #B ...).
//
// Drives Chrome over the DevTools protocol so the phone shot is a real
// 390px mobile viewport; plain `--headless --window-size` cannot go below
// about 500px on macOS.
import { spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const args = process.argv.slice(2)
const flags = Object.fromEntries(args.filter(a => a.startsWith('--')).map(a => a.slice(2).split('=')))
const [rawUrl, outDir, ...ids] = args.filter(a => !a.startsWith('--'))
if (!rawUrl || !outDir || ids.length === 0) {
  console.error('usage: shoot.mjs <url> <out-dir> <version ids...> [--theme=dark] [--scale=75]')
  process.exit(1)
}

const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const SIZES = [
  { name: 'desktop', width: 1440, height: 900, deviceScaleFactor: 2, mobile: false },
  { name: 'mobile', width: 390, height: 844, deviceScaleFactor: 3, mobile: true },
]

const base = new URL(rawUrl)
base.hash = ''
if (flags.theme) base.searchParams.set('theme', flags.theme)
if (flags.scale) base.searchParams.set('scale', flags.scale)
const suffix = [flags.theme, flags.scale && `${flags.scale}pct`].filter(Boolean).map(s => `-${s}`).join('')

mkdirSync(outDir, { recursive: true })
const profile = mkdtempSync(join(tmpdir(), 'proto-shoot-'))
const chrome = spawn(CHROME, [
  '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] })

const cleanup = () => { chrome.kill('SIGKILL'); rmSync(profile, { recursive: true, force: true }) }
const timer = setTimeout(() => { console.error('shoot: timed out'); cleanup(); process.exit(1) }, 120_000)

try {
  const wsUrl = await new Promise((ok, fail) => {
    let buf = ''
    chrome.stderr.on('data', d => {
      buf += d
      const m = buf.match(/DevTools listening on (ws:\/\/\S+)/)
      if (m) ok(m[1])
    })
    chrome.on('exit', () => fail(new Error('Chrome exited before DevTools was ready')))
  })

  const ws = new WebSocket(wsUrl)
  await new Promise((ok, fail) => { ws.onopen = ok; ws.onerror = fail })
  let nextId = 0
  const pending = new Map()
  const waiters = []
  ws.onmessage = e => {
    const msg = JSON.parse(e.data)
    if (msg.id && pending.has(msg.id)) {
      const { ok, fail } = pending.get(msg.id)
      pending.delete(msg.id)
      msg.error ? fail(new Error(msg.error.message)) : ok(msg.result)
    } else if (msg.method) {
      for (const w of [...waiters]) if (w.method === msg.method && w.sessionId === msg.sessionId) {
        waiters.splice(waiters.indexOf(w), 1)
        w.ok(msg.params)
      }
    }
  }
  const send = (method, params = {}, sessionId) => new Promise((ok, fail) => {
    const id = ++nextId
    pending.set(id, { ok, fail })
    ws.send(JSON.stringify({ id, method, params, sessionId }))
  })
  const once = (method, sessionId) => new Promise(ok => waiters.push({ method, sessionId, ok }))
  const sleep = ms => new Promise(r => setTimeout(r, ms))

  for (const size of SIZES) {
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
    await send('Page.enable', {}, sessionId)
    await send('Emulation.setDeviceMetricsOverride', {
      width: size.width, height: size.height,
      deviceScaleFactor: size.deviceScaleFactor, mobile: size.mobile,
    }, sessionId)
    if (size.mobile) await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }, sessionId)

    for (const id of ids) {
      const url = new URL(base)
      url.searchParams.set('shot', `${size.name}-${id}`) // a full load each time; a hash-only change fires no load event
      url.hash = id
      const loaded = once('Page.loadEventFired', sessionId)
      await send('Page.navigate', { url: url.href }, sessionId)
      await Promise.race([loaded, sleep(15_000)])
      await sleep(1200) // Tailwind Play CDN styles the page after load
      const { data } = await send('Page.captureScreenshot', { format: 'png' }, sessionId)
      const file = resolve(outDir, `${id}-${size.name}${suffix}.png`)
      writeFileSync(file, Buffer.from(data, 'base64'))
      console.log(file)
    }
    await send('Target.closeTarget', { targetId })
  }
  ws.close()
} catch (err) {
  console.error('shoot:', err.message)
  process.exitCode = 1
} finally {
  clearTimeout(timer)
  cleanup()
}
