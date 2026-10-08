// Stress test for the skill (macOS and Linux): a session with many heavy prototypes, edit
// storms, navigation through every variant, and idle checks in each view, measuring the dev
// server (memory, CPU) and the page (JS heap, DOM nodes, CPU). Takes a few minutes.
//   node .github/stress.mjs            PROTOS=40 VARIANTS=20 EDITS=600 node .github/stress.mjs
import { execSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { startChrome, stopChrome } from '../scripts/chrome.mjs'

const SKILL = process.env.SKILL || dirname(dirname(fileURLToPath(import.meta.url)))
const PROJECT = process.env.PROJECT || join(tmpdir(), 'proto-stress')
const PROTOS = Number(process.env.PROTOS || 20), VARIANTS = Number(process.env.VARIANTS || 12)
const sleep = ms => new Promise(r => setTimeout(r, ms))
const results = []
const note = (k, v) => { results.push([k, v]); console.log(`${k}: ${v}`) }
const proto = (...a) => { const r = spawnSync(process.execPath, [join(SKILL, 'scripts/proto.mjs'), ...a, '--project', PROJECT, '--session', 'perf'], { encoding: 'utf8' }); if (r.status) { console.error(r.stdout, r.stderr); process.exit(1) } return r.stdout }

// ---------- a heavy variant: ~300 nodes, state, and a 1 s clock ----------
const variant = (id, n) => `import { useEffect, useState } from 'react'
export default function V${id}() {
  const [t, setT] = useState(0)
  const [q, setQ] = useState('')
  useEffect(() => { const i = setInterval(() => setT(x => x + 1), 1000); return () => clearInterval(i) }, [])
  const rows = Array.from({ length: 60 }, (_, i) => ({ i, name: 'Station ' + i + ' rev ${n}', price: (7 + i / 100).toFixed(2) }))
  return (
    <div className="min-h-full bg-white p-6 text-zinc-900">
      <header className="mb-4 flex items-center gap-3"><h1 className="text-2xl font-semibold">Variant ${id} · ${n}</h1><span className="ml-auto rounded-full bg-emerald-100 px-3 py-1 text-sm text-emerald-800">{t}s</span></header>
      <input value={q} onChange={e => setQ(e.target.value)} placeholder="Filter" className="mb-4 h-10 w-full rounded-lg border px-3" />
      <ul className="grid grid-cols-3 gap-2">{rows.filter(r => r.name.includes(q)).map(r => <li key={r.i} className="flex justify-between rounded-lg bg-zinc-50 p-3 shadow-sm"><span className="font-medium">{r.name}</span><b>₪{r.price}</b><span className="text-xs text-zinc-400">#{r.i}</span></li>)}</ul>
    </div>
  )
}
`

// ---------- process stats: RSS and cumulative CPU of the server and its children ----------
function tree(pid) {
  const rows = execSync('ps -axo pid=,ppid=,rss=,time=').toString().trim().split('\n').map(l => l.trim().split(/\s+/))
  const ids = new Set([String(pid)]); let grew = true
  while (grew) { grew = false; for (const [p, pp] of rows) if (ids.has(pp) && !ids.has(p)) { ids.add(p); grew = true } }
  const cpu = s => { const [m, sec] = s.split(':'); return Number(m) * 60 + Number(sec) }
  let rss = 0, t = 0
  for (const [p, , r, time] of rows) if (ids.has(p)) { rss += Number(r); t += cpu(time) }
  return { rssMB: rss / 1024, cpuS: t, procs: ids.size }
}
async function serverOver(pid, ms) { const a = tree(pid); const t0 = Date.now(); await sleep(ms); const b = tree(pid); return { rssMB: b.rssMB, cpuPct: 100 * (b.cpuS - a.cpuS) / ((Date.now() - t0) / 1000), procs: b.procs } }

// ---------- Chrome over CDP ----------
const chrome = startChrome([`--user-data-dir=${mkdtempSync(join(tmpdir(), 'perf-'))}`])
const ws = new WebSocket(await new Promise(ok => { let b = ''; chrome.stderr.on('data', d => { b += d; const m = b.match(/ws:\/\/\S+/); if (m) ok(m[0]) }) }))
await new Promise(ok => { ws.onopen = ok })
let nid = 0; const pend = new Map()
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.no(new Error(m.error.message)) : p.ok(m.result) } }
const send = (method, params = {}, sessionId) => new Promise((ok, no) => { const i = ++nid; pend.set(i, { ok, no }); ws.send(JSON.stringify({ id: i, method, params, sessionId })) })
async function page(width = 1440, height = 900) {
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
  const { sessionId: s } = await send('Target.attachToTarget', { targetId, flatten: true })
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }, s)
  await send('Performance.enable', {}, s)
  const ev = async x => (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }, s)).result.value
  const metrics = async () => Object.fromEntries((await send('Performance.getMetrics', {}, s)).metrics.map(m => [m.name, m.value]))
  const gc = () => send('HeapProfiler.collectGarbage', {}, s)
  const go = async url => { const t0 = Date.now(); await send('Page.navigate', { url }, s); for (let i = 0; i < 300 && !(await ev('document.documentElement.dataset.ready === "1"').catch(() => false)); i++) await sleep(50); return Date.now() - t0 }
  const idle = async ms => { const a = await metrics(); await sleep(ms); const b = await metrics(); return { cpuPct: 100 * (b.TaskDuration - a.TaskDuration) / (ms / 1000), script: 100 * (b.ScriptDuration - a.ScriptDuration) / (ms / 1000), layouts: b.LayoutCount - a.LayoutCount, styles: b.RecalcStyleCount - a.RecalcStyleCount } }
  const mem = async () => { await gc(); const m = await metrics(); return { heapMB: m.JSHeapUsedSize / 1048576, nodes: m.Nodes, listeners: m.JSEventListeners } }
  return { s, ev, metrics, gc, go, idle, mem, close: () => send('Target.closeTarget', { targetId }) }
}
const f1 = x => x.toFixed(1)

// ---------- 1. a big session ----------
rmSync(PROJECT, { recursive: true, force: true }); mkdirSync(PROJECT, { recursive: true })
writeFileSync(join(PROJECT, 'package.json'), JSON.stringify({ name: 'perf', private: true, dependencies: { react: '^19.2.0' } }))
let t0 = Date.now()
const up = proto('up', '--name', 'Stress')
note('proto up, cold (scaffold + install + start)', `${((Date.now() - t0) / 1000).toFixed(1)} s`)
const local = up.match(/^local (\S+)/m)?.[1] || up.match(/^url (\S+)/m)[1]
const app = join(PROJECT, '.prototypes', 'perf')
const pid = JSON.parse(readFileSync(join(app, 'session.json'), 'utf8')).pid
let s0 = await serverOver(pid, 5000)
note('server idle, empty session', `${f1(s0.rssMB)} MB, ${f1(s0.cpuPct)}% CPU, ${s0.procs} processes`)

const letters = Array.from({ length: VARIANTS }, (_, i) => String.fromCharCode(65 + i))
t0 = Date.now()
for (let p = 0; p < PROTOS; p++) {
  const from = p > 0 && p % 4 === 0 ? ['--from', `p${p - 1}/B`] : []
  proto('add', `p${p}`, '--title', `Prototype ${p}`, '--ask', 'stress', '--variants', letters.map(l => `${l}:Take ${l}`).join(','), ...from)
  for (const l of letters) writeFileSync(join(app, 'src/protos', `p${p}`, `${l}.tsx`), variant(l, 0))
}
note(`added ${PROTOS} prototypes × ${VARIANTS} variants`, `${((Date.now() - t0) / 1000).toFixed(1)} s`)
await sleep(3000)

// ---------- 2. page: first load and idle in each view ----------
const pg = await page()
const base = local.replace(/\/$/, '') + '/?theme=light'
note('page load, session overview (20 live thumbnails)', `${await pg.go(base + '#/')} ms`)
const mods = () => pg.ev(`new Set(performance.getEntriesByType('resource').map(r => r.name.split('?')[0]).filter(n => /\\/src\\/protos\\/[^/]+\\/[A-Z]{1,2}\\.tsx$/.test(n))).size`)
const liveHosts = () => pg.ev(`[...document.querySelectorAll('[data-layers] [data-mount]')].filter(h => h.childElementCount).length + ' of ' + document.querySelectorAll('[data-layers] [data-mount]').length`)
note('  variant modules loaded', String(await mods()))
let m = await pg.mem(); note('  memory', `${f1(m.heapMB)} MB JS heap, ${m.nodes} DOM nodes`)
let i = await pg.idle(10000); note('  idle (10 s)', `${f1(i.cpuPct)}% CPU, ${i.layouts} layouts`)
note(`prototype overview, grid (${VARIANTS} live thumbnails)`, `${await pg.go(base + '#/p3')} ms`)
await sleep(800); note('  previews running', await liveHosts())
m = await pg.mem(); note('  memory', `${f1(m.heapMB)} MB JS heap, ${m.nodes} DOM nodes`)
i = await pg.idle(10000); note('  idle (10 s)', `${f1(i.cpuPct)}% CPU, ${i.layouts} layouts`)
await pg.ev(`localStorage.setItem('proto-lobby','stack')`)
note(`prototype overview, full size (${VARIANTS} live designs)`, `${await pg.go(base + '#/p5')} ms`)
await sleep(800); note('  designs running', await liveHosts())
m = await pg.mem(); note('  memory', `${f1(m.heapMB)} MB JS heap, ${m.nodes} DOM nodes`)
i = await pg.idle(10000); note('  idle (10 s)', `${f1(i.cpuPct)}% CPU, ${i.layouts} layouts`)
await pg.ev(`localStorage.setItem('proto-lobby','grid')`)
note('one variant', `${await pg.go(base + '#/p3/C')} ms`)
m = await pg.mem(); note('  memory', `${f1(m.heapMB)} MB JS heap, ${m.nodes} DOM nodes`)
i = await pg.idle(10000); note('  idle (10 s)', `${f1(i.cpuPct)}% CPU, ${i.layouts} layouts`)
await pg.go(base + '&focus=1#/p3/C'); await sleep(500)
i = await pg.idle(10000); note('  idle in focus mode (10 s)', `${f1(i.cpuPct)}% CPU, ${i.layouts} layouts, ${i.styles} style recalcs`)
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 720, y: 880 }, pg.s); await sleep(1500)
i = await pg.idle(10000); note('  idle in focus mode, pointer resting on the dock (10 s)', `${f1(i.cpuPct)}% CPU, ${i.layouts} layouts, ${i.styles} style recalcs`)
await pg.go(base + '#/p3/C')

// ---------- 3. navigation churn: every variant, by hash ----------
const before = await pg.mem()
t0 = Date.now()
for (let p = 0; p < PROTOS; p++) for (const l of letters) { await pg.ev(`location.hash = '#/p${p}/${l}'`); await sleep(40) }
for (let p = 0; p < PROTOS; p++) { await pg.ev(`location.hash = '#/p${p}'`); await sleep(120) }
await pg.ev(`location.hash = '#/p3/C'`); await sleep(1500)
const after = await pg.mem()
note('  variant modules loaded after churn', String(await mods()))
note(`navigation churn: ${PROTOS * VARIANTS} variants + ${PROTOS} overviews`, `${((Date.now() - t0) / 1000).toFixed(1)} s`)
note('  memory before → after (same place, after GC)', `${f1(before.heapMB)} → ${f1(after.heapMB)} MB heap, ${before.nodes} → ${after.nodes} nodes, ${before.listeners} → ${after.listeners} listeners`)

// ---------- 4. edit storm with the page open on a lobby ----------
await pg.go(base + '#/p7')
const sBefore = tree(pid), pBefore = await pg.mem(), pm0 = await pg.metrics()
t0 = Date.now()
const EDITS = Number(process.env.EDITS || 300)
for (let n = 1; n <= EDITS; n++) { const p = n % PROTOS, l = letters[n % VARIANTS]; writeFileSync(join(app, 'src/protos', `p${p}`, `${l}.tsx`), variant(l, n)); await sleep(50) }
const stormS = (Date.now() - t0) / 1000
const sDuring = tree(pid), pm1 = await pg.metrics()
note(`edit storm: ${EDITS} saves in ${f1(stormS)} s (${f1(EDITS / stormS)}/s)`, `server ${f1(100 * (sDuring.cpuS - sBefore.cpuS) / stormS)}% CPU, page ${f1(100 * (pm1.TaskDuration - pm0.TaskDuration) / stormS)}% CPU`)
await sleep(5000)
const sAfter = await serverOver(pid, 10000), pAfter = await pg.mem()
note('  server memory before → 15 s after', `${f1(sBefore.rssMB)} → ${f1(sAfter.rssMB)} MB, then ${f1(sAfter.cpuPct)}% CPU idle`)
note('  page memory before → after (GC)', `${f1(pBefore.heapMB)} → ${f1(pAfter.heapMB)} MB heap, ${pBefore.nodes} → ${pAfter.nodes} nodes`)
const alive = await pg.ev(`document.querySelectorAll('[data-thumb]').length`)
note('  page still showing the lobby', `${alive} thumbnails`)

// ---------- 5. a second storm: is memory growth bounded? ----------
for (let n = 1; n <= EDITS; n++) { const p = n % PROTOS, l = letters[n % VARIANTS]; writeFileSync(join(app, 'src/protos', `p${p}`, `${l}.tsx`), variant(l, EDITS + n)); await sleep(50) }
await sleep(5000)
const s2 = await serverOver(pid, 10000), p2 = await pg.mem()
note(`  after a second storm of ${EDITS}`, `server ${f1(s2.rssMB)} MB, page ${f1(p2.heapMB)} MB heap, ${p2.nodes} nodes`)

await pg.close()

proto('rm')
rmSync(PROJECT, { recursive: true, force: true })
stopChrome(chrome)
process.exit(0)
