#!/usr/bin/env node
// proto: one live prototype app per Claude Code session, served on the tailnet.
//
//   proto up [--name "Session name"] [--stack react|vue]   create or restart, print the URL
//   proto add <slug> --title "…" --variants "A:Name,B:Name" [--ask "…"] [--kind phone] [--screen 402x874]
//             [--from <slug>/<letter>]   built from that variant: nested under it in the page
//   proto shoot [route…] [--theme dark] [--focus] [--click <css>]  screenshots, e.g. hero hero/A hero/A/open
//             [--ref <png>]   instead, the variant's screen beside that screenshot of the real one
//   proto snap <slug>[/<letter>]… [--width 672]   static HTML snapshots for a Claude Doc
//   proto pick <slug> <letter> [--off]   the user chose this variant: marked in the page
//   proto work <slug>/<letter> [--ask "…"] [--off]   the variant being worked on: pinned in the page
//   proto ask "…" [--to <slug>/<letter>]   a change the user asked for, kept with that variant
//   proto inbox [--wait] [--timeout <min>]   comments sent from the page; --wait blocks until some arrive
//   proto reply <batch>[/<n>] "…" [--done] [--as codex]   answer a comment (or a whole batch) in the page
//   proto archive <slug> [--off]    proto keep [--off]      proto url    proto stack
//   proto stop    proto rm    proto ls    proto gc
//
// Common flags: --project <dir> (default: git root of the cwd), --session <id>
// (default: $CLAUDE_CODE_SESSION_ID).

import { spawn, spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SKILL = dirname(dirname(fileURLToPath(import.meta.url)))
const APP = join(SKILL, 'app')
const INDEX = join(homedir(), '.prototypes', 'sessions.json')
const IDLE_HOURS = 6
const MAX_HEAP_MB = 1024
const DELETE_DAYS = 14
const LOCAL_PORTS = [5180, 5279]
const TAILNET_PORTS = [9500, 9599]
const BASE = { vite: '^8.3.0', tailwindcss: '^4.3.0', '@tailwindcss/vite': '^4.3.0' }
// The shell's own runtime, in every app whatever its stack: the phone's variant sheet is Base
// UI's Drawer, which is React, and so is the comment layer (which takes its screenshots with
// modern-screenshot).
const SHELL = { react: '^19.2.0', 'react-dom': '^19.2.0', '@base-ui/react': '^1.9.0', 'modern-screenshot': '^4.7.0' }
const STACKS = {
  react: { deps: {}, dev: { '@vitejs/plugin-react': '^6.1.0' }, ext: 'tsx', adapter: 'react.tsx', hints: 'hints.react.ts', stub: 'react.tsx' },
  vue: { deps: { vue: '^3.5.0' }, dev: { '@vitejs/plugin-vue': '^6.0.0' }, ext: 'vue', adapter: 'vue.ts', hints: 'hints.vue.ts', stub: 'vue.vue' },
}

// ---------- arguments ----------
const argv = process.argv.slice(2)
const cmd = argv[0]
const flags = {}
const args = []
for (let i = 1; i < argv.length; i++) {
  const a = argv[i]
  if (!a.startsWith('--')) { args.push(a); continue }
  const [k, v] = a.slice(2).split(/=(.*)/s)
  flags[k] = v !== undefined ? v : argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true
}

const die = msg => { console.error(`proto: ${msg}`); process.exit(1) }
const readJson = (f, fallback) => { try { return JSON.parse(readFileSync(f, 'utf8')) } catch { return fallback } }
const writeJson = (f, v) => { mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, JSON.stringify(v, null, 2) + '\n') }
const tilde = p => p.replace(homedir(), '~')
const WIN = process.platform === 'win32'
const run = (bin, a, opts = {}) => spawnSync(bin, a, { encoding: 'utf8', ...opts })
// npm and pnpm are .cmd scripts on Windows, which Node only starts through a shell.
const runCli = (bin, a, opts = {}) => WIN ? run([bin, ...a].join(' '), [], { ...opts, shell: true }) : run(bin, a, opts)
const has = bin => run(WIN ? 'where' : 'which', [bin]).status === 0
const sleep = ms => new Promise(r => setTimeout(r, ms))

// ---------- where things are ----------
function projectRoot() {
  if (flags.project) return resolve(flags.project)
  const git = run('git', ['rev-parse', '--show-toplevel'])
  return git.status === 0 ? git.stdout.trim() : process.cwd()
}
function sessionId() {
  const id = flags.session || process.env.CLAUDE_CODE_SESSION_ID
  if (!id) die('no session id. Pass --session <id> (outside Claude Code, any stable name works).')
  return String(id)
}
// Claude Code session ids are UUIDs, whose first 8 characters are plenty; any other name
// is kept whole so two different names never share a folder.
const short = id => (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(id) ? id.slice(0, 8) : id.replace(/[^a-zA-Z0-9-]/g, '').slice(0, 40)) || 'session'
const sessionDir = () => join(projectRoot(), '.prototypes', short(sessionId()))
const sessionFile = dir => join(dir, 'session.json')
const readSession = dir => readJson(sessionFile(dir), null)
// The page hot-reloads session.json, so a write that changes nothing is skipped.
function patchSession(dir, patch) {
  const was = readSession(dir), s = { ...was, ...patch }
  if (JSON.stringify(s) !== JSON.stringify(was)) writeJson(sessionFile(dir), s)
  return s
}
function need(dir) { if (!existsSync(sessionFile(dir))) die(`no prototype session here yet (${tilde(dir)}). Run: proto up`); return readSession(dir) }

const index = () => readJson(INDEX, []).filter(d => typeof d === 'string')
const remember = dir => { const all = new Set(index()); all.add(dir); writeJson(INDEX, [...all]) }
const forget = dir => writeJson(INDEX, index().filter(d => d !== dir))

// ---------- stack ----------
function detectStack(project) {
  const pkg = readJson(join(project, 'package.json'), {})
  const deps = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies }
  const hasAny = (...names) => names.some(n => n in deps)
  if (hasAny('vue', 'nuxt')) return { stack: 'vue', why: 'the project uses Vue' }
  if (hasAny('react', 'next', 'react-native', 'expo', '@remix-run/react')) return { stack: 'react', why: 'the project uses React' }
  if (hasAny('svelte', '@sveltejs/kit')) return { stack: 'react', why: 'Svelte has no adapter yet, so React' }
  if (hasAny('solid-js')) return { stack: 'react', why: 'Solid has no adapter yet, so React' }
  if (hasAny('@angular/core')) return { stack: 'react', why: 'Angular has no adapter, so React' }
  return { stack: 'react', why: 'no web framework found, so React' }
}

// ---------- processes, ports, tailnet ----------
const alive = pid => { if (!pid) return false; try { process.kill(pid, 0); return true } catch { return false } }
// The dev server and what it started (esbuild): its process group, or its tree on Windows.
// Waits until it has exited, so a `proto up` right after gets the same port back.
async function kill(pid) {
  if (WIN) { run('taskkill', ['/pid', String(pid), '/T', '/F']); return }
  const signal = sig => { try { process.kill(-pid, sig) } catch { try { process.kill(pid, sig) } catch { /* gone */ } } }
  signal('SIGTERM')
  for (let i = 0; i < 50 && alive(pid); i++) await sleep(100)
  if (alive(pid)) signal('SIGKILL')
}
async function answers(url, ms = 2500) {
  try { const r = await fetch(url, { signal: AbortSignal.timeout(ms) }); return r.ok } catch { return false }
}
const running = async s => !!s?.port && alive(s.pid) && answers(`http://127.0.0.1:${s.port}/__proto/status`)
const portFree = port => new Promise(ok => {
  const srv = createServer().once('error', () => ok(false)).once('listening', () => srv.close(() => ok(true)))
  srv.listen(port, '127.0.0.1')
})
function claimedPorts(key) {
  return new Set(index().map(d => readSession(d)?.[key]).filter(Boolean))
}
async function localPort(s) {
  if (s.port && await portFree(s.port)) return s.port
  const taken = claimedPorts('port')
  for (let p = LOCAL_PORTS[0]; p <= LOCAL_PORTS[1]; p++) if (!taken.has(p) && await portFree(p)) return p
  die('no free local port in 5180-5279')
}
function tailnet() {
  if (!has('tailscale')) return null
  const st = run('tailscale', ['status', '--json'])
  if (st.status !== 0) return null
  const host = JSON.parse(st.stdout).Self?.DNSName?.replace(/\.$/, '')
  if (!host) return null
  const serve = run('tailscale', ['serve', 'status', '--json'])
  const cfg = serve.status === 0 && serve.stdout.trim() ? JSON.parse(serve.stdout) : {}
  // Which local port each https serve port proxies to.
  const rules = {}
  for (const [hostPort, web] of Object.entries(cfg.Web || {})) {
    const port = hostPort.split(':').pop()
    const proxy = Object.values(web.Handlers || {})[0]?.Proxy || ''
    rules[port] = Number(proxy.split(':').pop()) || 0
  }
  return { host, rules, tcp: new Set(Object.keys(cfg.TCP || {})) }
}
function tailnetPort(s, net) {
  if (s.tailnetPort && (net.rules[s.tailnetPort] === s.port || !net.tcp.has(String(s.tailnetPort)))) return s.tailnetPort
  const taken = claimedPorts('tailnetPort')
  for (let p = TAILNET_PORTS[0]; p <= TAILNET_PORTS[1]; p++) if (!taken.has(p) && !net.tcp.has(String(p))) return p
  die('no free tailnet port in 9500-9599')
}

// ---------- create ----------
function scaffold(dir, project) {
  const { stack, why } = flags.stack ? { stack: flags.stack, why: 'asked for' } : detectStack(project)
  const kit = STACKS[stack] || die(`unknown stack "${stack}" (react or vue)`)
  mkdirSync(dirname(dir), { recursive: true })
  const outer = join(dirname(dir), '.gitignore')
  if (!existsSync(outer)) writeFileSync(outer, '# Prototype sessions, never committed.\n*\n')
  cpSync(APP, dir, { recursive: true, filter: src => !/[/\\](adapters|stubs|node_modules)([/\\]|$)/.test(src.slice(APP.length)) })
  renameSync(join(dir, 'gitignore'), join(dir, '.gitignore'))
  cpSync(join(APP, 'adapters', kit.adapter), join(dir, 'src', `mount.${kit.adapter.split('.').pop()}`))
  cpSync(join(APP, 'adapters', kit.hints), join(dir, 'src', 'hints.ts'))
  writeJson(join(dir, 'package.json'), {
    name: `prototype-${basename(dir)}`, private: true, type: 'module',
    dependencies: { ...SHELL, ...kit.deps }, devDependencies: { ...BASE, ...kit.dev },
  })
  const id = sessionId()
  writeJson(sessionFile(dir), {
    id, name: flags.name || basename(project), project, path: tilde(project), stack,
    createdAt: new Date().toISOString(), port: null, tailnetPort: null, pid: null,
    url: null, localUrl: null, keep: false, idleHours: IDLE_HOURS, deleteDays: DELETE_DAYS,
  })
  remember(dir)
  console.log(`created ${tilde(dir)} (${stack}: ${why})`)
}

function install(dir) {
  const t = Date.now()
  const pnpm = has('pnpm')
  const r = pnpm
    ? runCli('pnpm', ['install', '--ignore-workspace', '--prefer-offline', '--reporter=silent'], { cwd: dir, stdio: 'inherit' })
    : runCli('npm', ['install', '--no-audit', '--no-fund', '--loglevel=error'], { cwd: dir, stdio: 'inherit' })
  if (r.status !== 0) die('installing the prototype app failed (see above)')
  console.log(`installed in ${((Date.now() - t) / 1000).toFixed(1)}s`)
}

// ---------- commands ----------
async function up() {
  await gc(true)
  const project = projectRoot()
  const dir = sessionDir()
  if (!existsSync(sessionFile(dir))) scaffold(dir, project)
  let s = readSession(dir)
  if (flags.name && flags.name !== s.name) s = patchSession(dir, { name: flags.name })
  if (!existsSync(join(dir, 'node_modules', 'vite'))) install(dir)

  if (!await running(s)) {
    const port = await localPort(s)
    s = patchSession(dir, { port, stoppedAt: null, stopReason: null })
    mkdirSync(join(dir, '.proto'), { recursive: true })
    const log = openSync(join(dir, '.proto', 'dev.log'), 'a')
    // A ceiling on the server's JS heap: it idles near 200 MB, so this only stops a runaway,
    // which exits and is restarted by the next `proto up`.
    const child = spawn(process.execPath, [`--max-old-space-size=${MAX_HEAP_MB}`, join(dir, 'node_modules', 'vite', 'bin', 'vite.js')], { cwd: dir, detached: true, windowsHide: true, stdio: ['ignore', log, log] })
    child.unref()
    s = patchSession(dir, { pid: child.pid })
    for (let i = 0; i < 60 && !await answers(`http://127.0.0.1:${port}/__proto/status`, 1000); i++) await sleep(250)
    if (!await running(s)) die(`the dev server did not start; see ${tilde(join(dir, '.proto', 'dev.log'))}`)
  }

  const localUrl = `http://127.0.0.1:${s.port}/`
  let url = localUrl
  const net = tailnet()
  if (net) {
    const tport = tailnetPort(s, net)
    if (net.rules[tport] !== s.port) run('tailscale', ['serve', '--bg', `--https=${tport}`, `http://127.0.0.1:${s.port}`])
    url = `https://${net.host}:${tport}/`
    s = patchSession(dir, { tailnetPort: tport })
    if (!await answers(url, 10000)) die(`${url} did not answer. Local link: ${localUrl}`)
  }
  patchSession(dir, { url, localUrl })
  console.log(`url ${url}`)
  if (url !== localUrl) console.log(`local ${localUrl}`)
  console.log(`dir ${dir}`)
  console.log(`stack ${s.stack}`)
}

function add() {
  const dir = sessionDir()
  const s = need(dir)
  const slug = args[0]
  if (!slug || !/^[a-z0-9][a-z0-9-]*$/.test(slug)) die('give a slug like "hero-sections" (lowercase, digits, dashes)')
  const kit = STACKS[s.stack]
  const pdir = join(dir, 'src', 'protos', slug)
  const metaFile = join(pdir, 'meta.ts')
  let meta = { title: slug, ask: '', kind: 'web', created: new Date().toISOString(), variants: {} }
  if (existsSync(metaFile)) {
    try { meta = { ...meta, ...JSON.parse(readFileSync(metaFile, 'utf8').replace(/^[\s\S]*?export default\s*/, '').replace(/;?\s*$/, '')) } }
    catch { die(`${tilde(metaFile)} is not plain JSON any more; edit it by hand instead`) }
  }
  if (flags.title) meta.title = flags.title
  if (flags.ask) meta.ask = flags.ask
  if (flags.kind) meta.kind = flags.kind === 'phone' ? 'phone' : 'web'
  // The phone frame's screen in points, read off the reference (an iPhone 17 shot is 1206×2622 at 3x: 402x874).
  if (flags.screen) {
    const m = String(flags.screen).match(/^(\d+)x(\d+)$/)
    if (!m) die('--screen is the screen in points, like 402x874')
    meta.screen = [+m[1], +m[2]]
  }
  // Built from another prototype (or one of its variants): the page nests it under that one.
  if (flags.from) {
    const [parent, variant = ''] = String(flags.from).split('/')
    if (parent === slug) die('a prototype can\'t be built from itself')
    const parentMeta = join(dir, 'src', 'protos', parent, 'meta.ts')
    if (!existsSync(parentMeta)) die(`--from: no prototype "${parent}" in this session`)
    if (variant && !readFileSync(parentMeta, 'utf8').includes(`"${variant}":`)) die(`--from: "${parent}" has no variant ${variant}`)
    // Walk up from the parent; meeting this prototype again would make a loop.
    const seen = new Set()
    for (let up = parent; up && !seen.has(up);) {
      if (up === slug) die(`--from: "${parent}" is already built from "${slug}"`)
      seen.add(up)
      const m = join(dir, 'src', 'protos', up, 'meta.ts')
      up = existsSync(m) ? (readFileSync(m, 'utf8').match(/"from":\s*"([^"/]+)/) || [])[1] : undefined
    }
    meta.from = variant ? `${parent}/${variant}` : parent
  }
  // Keep the variant list last in meta.ts, where it is easiest to read.
  const { variants: names, ...head } = meta
  meta = { ...head, variants: names }
  const list = String(flags.variants || '').split(',').map(x => x.trim()).filter(Boolean)
  mkdirSync(pdir, { recursive: true })
  const stub = readFileSync(join(APP, 'stubs', kit.stub), 'utf8')
  for (const entry of list) {
    const [id, ...rest] = entry.split(':')
    if (!/^[A-Z]{1,2}$/.test(id)) die(`variant ids are capital letters (A, B … AA): "${id}"`)
    const name = rest.join(':').trim() || id
    meta.variants[id] = name
    const file = join(pdir, `${id}.${kit.ext}`)
    if (!existsSync(file)) writeFileSync(file, stub.replaceAll('__ID__', id).replaceAll('__NAME__', name))
  }
  // meta.ts goes last, so the page sees the prototype with all its variants at once.
  writeFileSync(metaFile, `// Prototype: ${meta.title}. Variant files are named by their letter; names live here.\nexport default ${JSON.stringify(meta, null, 2)}\n`)
  console.log(`${pdir}: ${Object.keys(meta.variants).map(id => `${id}.${kit.ext}`).join(' ') || 'no variants'}`)
  if (s.url) console.log(`${s.url}#/${slug}`)
}

// The user chose a variant ("go with A"): the page marks it and lists it first. The other
// variants stay, and so does everything built from this prototype.
function pick() {
  const dir = sessionDir()
  need(dir)
  const [slug, id] = args
  const metaFile = join(dir, 'src', 'protos', slug || '', 'meta.ts')
  if (!slug || !existsSync(metaFile)) die('which prototype? proto pick <slug> <letter>')
  const text = readFileSync(metaFile, 'utf8')
  const meta = JSON.parse(text.replace(/^[\s\S]*?export default\s*/, '').replace(/;?\s*$/, ''))
  if (flags.off) delete meta.picked
  else if (!id || !meta.variants?.[id]) die(`which variant of ${slug}? (${Object.keys(meta.variants || {}).join(', ')})`)
  else meta.picked = id
  writeFileSync(metaFile, text.replace(/export default[\s\S]*$/, `export default ${JSON.stringify(meta, null, 2)}\n`))
  // The pick is what gets worked on next; its history starts here.
  if (!flags.off) setWork(dir, { proto: slug, variant: id }, `Picked ${id}`)
  console.log(flags.off ? `${slug}: no pick` : `${slug}: picked ${id} · ${meta.variants[id]}`)
}

// ---------- the working variant ----------
// What the user is changing now: one variant per session, pinned at the top of the page's
// sidebar with what they asked for on it. It moves only when told to (a pick, `proto work`),
// never because some file changed. Kept in session.json, which the page reloads live.
const readMeta = (dir, slug) => {
  const f = join(dir, 'src', 'protos', slug || '', 'meta.ts')
  if (!slug || !existsSync(f)) return null
  return JSON.parse(readFileSync(f, 'utf8').replace(/^[\s\S]*?export default\s*/, '').replace(/;?\s*$/, ''))
}
const sameVariant = (a, b) => !!a && !!b && a.proto === b.proto && a.variant === b.variant
function target(dir, spec) {
  const [proto, variant] = String(spec || '').split('/')
  const meta = readMeta(dir, proto)
  if (!meta) die(`no prototype "${proto || ''}" here: give <slug>/<letter>`)
  if (!variant || !meta.variants?.[variant]) die(`which variant of ${proto}? (${Object.keys(meta.variants || {}).join(', ')})`)
  return { proto, variant, name: meta.variants[variant] }
}
/** Points the session at a variant; the one it leaves goes first in `before` (three kept). */
function setWork(dir, t, ask) {
  const s = readSession(dir)
  const at = new Date().toISOString()
  const patch = {}
  if (!sameVariant(s.work, t)) {
    patch.work = { proto: t.proto, variant: t.variant, at }
    patch.before = [s.work, ...(s.before || [])].filter(x => x && !sameVariant(x, t))
      .filter((x, i, all) => all.findIndex(y => sameVariant(x, y)) === i).slice(0, 3).map(x => ({ proto: x.proto, variant: x.variant }))
  }
  if (ask) {
    const key = `${t.proto}/${t.variant}`
    patch.asks = { ...s.asks, [key]: [...(s.asks?.[key] || []), { at, text: ask }] }
  }
  patchSession(dir, patch)
}

function work() {
  const dir = sessionDir()
  const s = need(dir)
  if (flags.off) { patchSession(dir, { work: null }); return console.log('no working variant') }
  if (!args[0]) return console.log(s.work ? `working on ${s.work.proto}/${s.work.variant}` : 'no working variant')
  const t = target(dir, args[0])
  setWork(dir, t, typeof flags.ask === 'string' ? flags.ask.trim() : '')
  console.log(`working on ${t.proto}/${t.variant} · ${t.name}`)
}

function ask() {
  const dir = sessionDir()
  const s = need(dir)
  const text = args.join(' ').trim()
  if (!text) die('what did the user ask for? proto ask "…"')
  const t = flags.to ? target(dir, flags.to) : s.work
  if (!t) die('no working variant yet: proto work <slug>/<letter> --ask "…"')
  const key = `${t.proto}/${t.variant}`
  patchSession(dir, { asks: { ...s.asks, [key]: [...(s.asks?.[key] || []), { at: new Date().toISOString(), text }] } })
  console.log(`${key}: ${(s.asks?.[key]?.length || 0) + 1} asks`)
}

function archive() {
  const dir = sessionDir()
  need(dir)
  const metaFile = join(dir, 'src', 'protos', args[0] || '', 'meta.ts')
  if (!args[0] || !existsSync(metaFile)) die('which prototype? proto archive <slug>')
  const text = readFileSync(metaFile, 'utf8')
  const meta = JSON.parse(text.replace(/^[\s\S]*?export default\s*/, '').replace(/;?\s*$/, ''))
  meta.archived = !flags.off
  writeFileSync(metaFile, text.replace(/export default[\s\S]*$/, `export default ${JSON.stringify(meta, null, 2)}\n`))
  if (meta.archived && readSession(dir).work?.proto === args[0]) patchSession(dir, { work: null })
  console.log(`${args[0]} ${meta.archived ? 'archived' : 'restored'}`)
}

async function stop(dir = sessionDir(), reason = 'stopped') {
  const s = readSession(dir)
  if (!s) return
  if (alive(s.pid)) await kill(s.pid)
  if (s.tailnetPort && has('tailscale')) {
    const net = tailnet()
    if (net?.rules[s.tailnetPort] === s.port) run('tailscale', ['serve', `--https=${s.tailnetPort}`, 'off'])
  }
  patchSession(dir, { pid: null, stoppedAt: s.stoppedAt || new Date().toISOString(), stopReason: s.stopReason || reason })
}

async function rm(dir = sessionDir()) {
  if (!existsSync(dir)) return die(`nothing at ${tilde(dir)}`)
  await stop(dir, 'deleted')
  rmSync(dir, { recursive: true, force: true })
  forget(dir)
  const parent = dirname(dir)
  if (existsSync(parent) && readdirSync(parent).every(f => f === '.gitignore')) rmSync(parent, { recursive: true, force: true })
  console.log(`deleted ${tilde(dir)}`)
}

function lastEdit(dir) {
  let newest = Date.parse(readSession(dir)?.createdAt) || 0
  const walk = d => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); e.isDirectory() ? walk(p) : (newest = Math.max(newest, statSync(p).mtimeMs)) } }
  try { walk(join(dir, 'src', 'protos')) } catch { /* none yet */ }
  return newest
}

// Deletes sessions untouched for DELETE_DAYS (unless kept) and drops tailnet rules that
// point at prototype ports nothing is serving any more. Idle servers stop themselves.
async function gc(quiet = false) {
  const now = Date.now()
  for (const dir of index()) {
    const s = readSession(dir)
    if (!s) { forget(dir); continue }
    const age = (now - lastEdit(dir)) / 864e5
    if (!s.keep && age > (s.deleteDays ?? DELETE_DAYS)) {
      await rm(dir)
      continue
    }
    if (s.pid && !alive(s.pid)) patchSession(dir, { pid: null, stoppedAt: s.stoppedAt || new Date().toISOString(), stopReason: s.stopReason || 'exited' })
  }
  const net = tailnet()
  if (net) {
    const live = new Set(index().map(readSession).filter(s => s && alive(s.pid)).map(s => s.port))
    for (const [tport, port] of Object.entries(net.rules)) {
      const ours = Number(tport) >= TAILNET_PORTS[0] && Number(tport) <= TAILNET_PORTS[1] && port >= LOCAL_PORTS[0] && port <= LOCAL_PORTS[1]
      if (ours && !live.has(port)) { run('tailscale', ['serve', `--https=${tport}`, 'off']); if (!quiet) console.log(`dropped leftover tailnet rule :${tport}`) }
    }
  }
  if (!quiet) console.log('gc done')
}

async function ls() {
  const rows = []
  for (const dir of index()) {
    const s = readSession(dir)
    if (!s) continue
    const days = ((Date.now() - lastEdit(dir)) / 864e5).toFixed(1)
    rows.push(`${await running(s) ? 'running' : 'stopped'}  ${s.name}  ${s.url || '-'}  last edit ${days}d ago${s.keep ? '  kept' : ''}\n  ${tilde(dir)}`)
  }
  console.log(rows.join('\n') || 'no prototype sessions')
}

async function shoot() {
  const dir = sessionDir()
  const s = need(dir)
  if (!await running(s)) die('the server is stopped. Run: proto up')
  const out = resolve(flags.out || join(dir, '.proto', 'shots'))
  const clicked = new Set(argv.filter((a, i) => argv[i - 1] === '--click'))
  const routes = args.filter(a => !clicked.has(a)).length ? args.filter(a => !clicked.has(a)) : ['']
  const extra = ['theme', 'focus'].filter(k => flags[k]).map(k => `--${k}=${flags[k] === true ? '1' : flags[k]}`)
  if (flags.ref === true) die('--ref takes a screenshot of the real screen: --ref <png>')
  if (flags.ref) {
    // Relative to where Claude stands, or to the app (where `.proto/ref/` lives).
    const ref = [resolve(flags.ref), resolve(dir, flags.ref)].find(f => existsSync(f))
    if (!ref) die(`--ref: no file ${flags.ref} here or in ${tilde(dir)}`)
    extra.push(`--ref=${ref}`)
  }
  // --click can repeat: each selector is clicked in order before the shot.
  argv.forEach((a, i) => { if (a === '--click' && argv[i + 1]) extra.push(`--click=${argv[i + 1]}`); else if (a.startsWith('--click=')) extra.push(a) })
  rtlCheck(dir, routes)
  const phones = new Set(routes.map(r => r.split('/')[0]).filter(slug => readMeta(dir, slug)?.kind === 'phone'))
  if (phones.size) extra.push(`--phone=${[...phones].join(',')}`)
  const r = run(process.execPath, [join(SKILL, 'scripts', 'shoot.mjs'), s.localUrl, out, ...routes.map(r => r || '/'), ...extra], { stdio: 'inherit' })
  process.exit(r.status ?? 1)
}

// A right-to-left prototype placed with left and right breaks the moment it mirrors (and a
// copy of it inherits the break), so `shoot` lists every physical side it finds. Two kinds are
// are fine and skipped: anything nested under a `dir="ltr"` element (a clock, a status bar) and
// centring (`left-1/2 -translate-x-1/2`). So is a side chosen per direction (`rtl:…`, `ltr:…`).
const PHYSICAL = new RegExp([
  String.raw`(?<![\w-])-?(?:m[lr]|p[lr]|left|right|scroll-m[lr]|scroll-p[lr])-[\w.\[\]/%-]+`,
  String.raw`(?<![\w-])(?:text|float|clear)-(?:left|right)\b`,
  String.raw`(?<![\w-])(?:border|rounded)-(?:[lr]|[tb][lr])(?:-[\w.\[\]/%-]+)?(?![\w-])`,
  String.raw`(?<![\w-])(?:bg-gradient|bg-linear)-to-(?:[lr]|[tb][lr])\b`,
  String.raw`\b(?:margin|padding|border)(?:Left|Right)\b\s*:`,
  String.raw`(?<![\w-])(?:left|right)\s*:\s*[-\d'"\`]`,
  String.raw`(?<![\w-])(?:margin|padding|border)-(?:left|right)\s*:`,
  String.raw`linear-gradient\(\s*to (?:left|right)`,
  String.raw`(?<![\w-])-?translate-x-[\w.\[\]/%-]+`,
  String.raw`translateX\(`,
  String.raw`(?<![\w-])(?:origin|bg|object)-(?:left|right|top-left|top-right|bottom-left|bottom-right)\b`,
  String.raw`(?:transformOrigin|backgroundPosition|objectPosition)\s*:\s*['"\`][^'"\`]*\b(?:left|right)\b`,
].join('|'), 'g')

function rtlCheck(dir, routes) {
  for (const slug of new Set(routes.map(r => r.split('/')[0]).filter(Boolean))) {
    const pdir = join(dir, 'src', 'protos', slug)
    if (!existsSync(pdir)) continue
    const files = readdirSync(pdir).filter(f => /\.(tsx|jsx|vue|ts|css)$/.test(f) && f !== 'meta.ts')
    const texts = files.map(f => readFileSync(join(pdir, f), 'utf8'))
    if (!texts.some(t => /dir=["'{]+rtl/.test(t))) continue
    const hits = []
    files.forEach((f, i) => {
      // Lines nested under an element marked dir="ltr" (deeper indent) are an island: skipped.
      let island = -1
      texts[i].split('\n').forEach((line, n) => {
      const indent = line.search(/\S/)
      if (island >= 0 && indent > island) return
      island = /dir=["'{]+ltr/.test(line) ? indent : -1
      if (island >= 0) return
      const bare = line.replace(/(?:rtl|ltr):[^\s"'`]+/g, '').replace(/left-1\/2(?=[^"'`]*-translate-x-1\/2)([^"'`]*)-translate-x-1\/2/g, '$1').replace(/(?<![\w-])translate-x-0(?![\w.])/g, '')
      const found = [...bare.matchAll(PHYSICAL)].map(m => m[0].trim())
      if (found.length) hits.push(`  ${f}:${n + 1}  ${found.join(' ')}`)
      })
    })
    if (hits.length) console.error(`rtl: ${slug} is right to left; physical sides to check (start/end unless inside a dir="ltr" island):\n${hits.slice(0, 15).join('\n')}${hits.length > 15 ? `\n  … ${hits.length - 15} more` : ''}`)
  }
}

// ---------- the inbox ----------
// Comments sent from the page land in the app's .proto/inbox/new/<batch>/ (the server writes
// them whole). Taking a batch moves it to taken/, so it is handed out once. `--wait` is meant to
// run in the background: it exits when a batch arrives, which wakes the agent.
const inboxDir = dir => join(dir, '.proto', 'inbox')
// Windows keeps a directory busy while a scanner or a watcher has a file in it, so a rename can
// fail with EPERM or EBUSY for a moment. Try again for a couple of seconds, and copy as the last resort.
const BUSY = new Set(['EPERM', 'EBUSY', 'EACCES'])
function moveDir(from, to) {
  for (let i = 0; ; i++) {
    try { return renameSync(from, to) } catch (e) {
      if (!BUSY.has(e.code)) throw e
      if (i >= 40) { cpSync(from, to, { recursive: true }); rmSync(from, { recursive: true, force: true }); return }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50)
    }
  }
}
const batchesIn = (dir, sub) => { try { return readdirSync(join(inboxDir(dir), sub)).filter(f => !f.startsWith('.')).sort() } catch { return [] } }
const waiterFile = dir => join(inboxDir(dir), 'waiter.json')

function take(dir) {
  const taken = []
  mkdirSync(join(inboxDir(dir), 'taken'), { recursive: true })
  for (const id of batchesIn(dir, 'new')) {
    const from = join(inboxDir(dir), 'new', id)
    try { moveDir(from, join(inboxDir(dir), 'taken', id)) } catch { continue /* another reader took it, or it is not whole yet */ }
    const b = readJson(join(inboxDir(dir), 'taken', id, 'batch.json'), null)
    if (b) taken.push(b)
  }
  return taken
}

// An element as the agent reads it: what it is, where it sits, and where it is written, the file
// from the app's folder with its line and the component (`src/protos/today/parts.tsx:30 (PriceCard)`).
const where = e => {
  if (!e) return ''
  const name = e.shoot ? `[data-shoot=${e.shoot}]` : e.selector || ''
  const r = e.rect ? ` at ${e.rect.x},${e.rect.y} ${e.rect.w}x${e.rect.h}` : ''
  const code = e.src ? `  src/protos/${e.src}${e.component ? ` (${e.component})` : ''}` : ''
  return [`<${e.tag || '?'}>`, e.text && `"${e.text.replace(/\s+/g, ' ').slice(0, 80)}"`, name].filter(Boolean).join(' ') + r + code
}
function printBatch(dir, b) {
  const vp = b.viewport ? ` · page ${b.viewport.w}x${b.viewport.h}${b.viewport.phone ? ' (phone)' : ''}` : ''
  console.log(`batch ${b.id} · ${b.comments.length} comment${b.comments.length === 1 ? '' : 's'}${vp} · ${b.theme}`)
  for (const c of b.comments) {
    console.log(`\n${c.n}. ${c.route}`)
    console.log(`   ${c.text.split('\n').join('\n   ')}`)
    // A comment pinned with a long press is on a spot; its element is only where that spot is.
    if (c.point) console.log(`   at: ${c.point.x},${c.point.y} (a spot, pinned with a long press)`)
    if (c.target) console.log(`   ${c.point ? 'in' : 'on'}: ${where(c.target)}`)
    for (const t of c.tags || []) console.log(`   with: ${where(t)}`)
    for (const img of c.images || []) console.log(`   image: ${join(inboxDir(dir), 'taken', b.id, img.file)}${img.name ? `  (${img.name})` : ''}`)
  }
  console.log(`\nReply: proto reply ${b.id}/<n> "…" --done   (or ${b.id} for the whole batch)\n`)
}

async function inbox() {
  const dir = sessionDir()
  const s = need(dir)
  if (!flags.wait) {
    const got = take(dir)
    got.forEach(b => printBatch(dir, b))
    if (!got.length) console.log('no new comments')
    const w = readJson(waiterFile(dir), null)
    console.log(w && alive(w.pid) ? `listening (pid ${w.pid})` : 'not listening: run `proto inbox --wait` in the background')
    return
  }
  const w = readJson(waiterFile(dir), null)
  if (w && alive(w.pid) && w.pid !== process.pid) return console.log(`already listening (pid ${w.pid}); nothing to do`)
  const minutes = Number(flags.timeout) || 115
  writeJson(waiterFile(dir), { pid: process.pid, at: new Date().toISOString(), until: new Date(Date.now() + minutes * 60e3).toISOString() })
  const done = () => { const now = readJson(waiterFile(dir), null); if (now?.pid === process.pid) rmSync(waiterFile(dir), { force: true }) }
  for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(sig, () => { done(); process.exit(0) })
  console.log(`listening for comments on ${s.url || s.localUrl || 'the page'}`)
  const end = Date.now() + minutes * 60e3
  while (Date.now() < end) {
    if (batchesIn(dir, 'new').length) {
      // A reviewer often sends twice in a row: a moment's grace takes both in one wake.
      await sleep(1500)
      const got = take(dir)
      if (got.length) { done(); got.forEach(b => printBatch(dir, b)); return }
    }
    if (!alive(readSession(dir)?.pid)) { done(); return console.log('the server stopped, so no comments can come. `proto up`, then listen again.') }
    await sleep(1000)
  }
  done()
  console.log(`no comments in ${minutes} min. Listen again: proto inbox --wait`)
}

function reply() {
  const dir = sessionDir()
  need(dir)
  const [ref, ...words] = args
  const text = words.join(' ').trim()
  if (!ref || (!text && !flags.done)) die('proto reply <batch>[/<n>] "…" [--done]')
  const [prefix, n] = ref.split('/')
  const ids = batchesIn(dir, 'taken').filter(id => id.startsWith(prefix))
  if (ids.length !== 1) die(ids.length ? `"${prefix}" matches ${ids.length} batches; give more of the id` : `no taken batch "${prefix}" (run proto inbox first)`)
  const file = join(inboxDir(dir), 'taken', ids[0], 'batch.json')
  const b = readJson(file, null)
  const at = new Date().toISOString()
  // Whose mark the page puts beside the reply.
  const by = flags.as === 'codex' ? 'codex' : 'claude'
  if (n) {
    const c = b.comments.find(x => x.n === Number(n)) || die(`batch ${ids[0]} has no comment ${n} (1-${b.comments.length})`)
    if (text) c.reply = { text, at, by }
    if (flags.done) c.done = true
  } else {
    if (text) b.reply = { text, at, by }
    if (flags.done) b.comments.forEach(c => { c.done = true })
  }
  b.done = b.comments.every(c => c.done)
  writeJson(file, b)
  console.log(`${ids[0]}${n ? `/${n}` : ''}: ${text ? 'replied' : ''}${text && flags.done ? ', ' : ''}${flags.done ? 'done' : ''}${b.done ? ' (batch done)' : ''}`)
}

async function snap() {
  const dir = sessionDir()
  const s = need(dir)
  if (!await running(s)) die('the server is stopped. Run: proto up')
  if (!args.length) die('usage: proto snap <slug>[/<letter>]…')
  const readMeta = slug => {
    const f = join(dir, 'src', 'protos', slug, 'meta.ts')
    if (!existsSync(f)) die(`no prototype "${slug}"`)
    return JSON.parse(readFileSync(f, 'utf8').replace(/^[\s\S]*?export default\s*/, '').replace(/;?\s*$/, ''))
  }
  const spec = args.flatMap(arg => {
    const [slug, only] = arg.split('/')
    const meta = readMeta(slug)
    const ids = Object.keys(meta.variants || {}).filter(id => !only || id === only)
    if (!ids.length) die(`no variant "${only}" in ${slug}`)
    return ids.map(id => ({ route: `${slug}/${id}`, proto: slug, id, name: meta.variants[id], title: meta.title || slug, kind: meta.kind || 'web', screen: meta.screen }))
  })
  const out = resolve(flags.out || join(dir, '.proto', 'snaps'))
  mkdirSync(out, { recursive: true })
  const specFile = join(out, 'spec.json')
  writeFileSync(specFile, JSON.stringify(spec))
  const r = run(process.execPath, [join(SKILL, 'scripts', 'snap.mjs'), s.localUrl, out, String(flags.width || 672), specFile], { stdio: 'inherit' })
  process.exit(r.status ?? 1)
}

const commands = {
  up, add, pick, work, ask, archive, shoot, snap, inbox, reply, gc: () => gc(false), ls,
  stop: async () => { await stop(); console.log('stopped (files kept; proto up restarts it on the same link)') },
  rm: () => rm(),
  keep: () => { const dir = sessionDir(); need(dir); patchSession(dir, { keep: !flags.off }); console.log(flags.off ? 'no longer kept' : 'kept until deleted by hand') },
  url: () => { const s = need(sessionDir()); console.log(s.url || s.localUrl || 'not started') },
  stack: () => { const d = detectStack(projectRoot()); console.log(`${d.stack} (${d.why})`) },
}
if (!commands[cmd]) {
  console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split(/\r?\n/).slice(1, 19).map(l => l.replace(/^\/\/ ?/, '')).join('\n'))
  process.exit(cmd ? 1 : 0)
}
await commands[cmd]()
