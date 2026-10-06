#!/usr/bin/env node
// proto: one live prototype app per Claude Code session, served on the tailnet.
//
//   proto up [--name "Session name"] [--stack react|vue]   create or restart, print the URL
//   proto add <slug> --title "…" --variants "A:Name,B:Name" [--ask "…"] [--kind phone]
//             [--from <slug>/<letter>]   built from that variant: nested under it in the page
//   proto shoot [route…] [--theme dark] [--focus] [--click <css>]  screenshots, e.g. hero/A hero
//   proto snap <slug>[/<letter>]… [--width 672]   static HTML snapshots for a Claude Doc
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
const DELETE_DAYS = 14
const LOCAL_PORTS = [5180, 5279]
const TAILNET_PORTS = [9500, 9599]
const BASE = { vite: '^8.3.0', tailwindcss: '^4.3.0', '@tailwindcss/vite': '^4.3.0' }
const STACKS = {
  react: { deps: { react: '^19.2.0', 'react-dom': '^19.2.0' }, dev: { '@vitejs/plugin-react': '^6.1.0' }, ext: 'tsx', adapter: 'react.tsx', stub: 'react.tsx' },
  vue: { deps: { vue: '^3.5.0' }, dev: { '@vitejs/plugin-vue': '^6.0.0' }, ext: 'vue', adapter: 'vue.ts', stub: 'vue.vue' },
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
function patchSession(dir, patch) { const s = { ...readSession(dir), ...patch }; writeJson(sessionFile(dir), s); return s }
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
function kill(pid) {
  if (WIN) return run('taskkill', ['/pid', String(pid), '/T', '/F'])
  try { process.kill(-pid, 'SIGTERM') } catch { try { process.kill(pid, 'SIGTERM') } catch { /* gone */ } }
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
  writeJson(join(dir, 'package.json'), {
    name: `prototype-${basename(dir)}`, private: true, type: 'module',
    dependencies: kit.deps, devDependencies: { ...BASE, ...kit.dev },
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
    const child = spawn(process.execPath, [join(dir, 'node_modules', 'vite', 'bin', 'vite.js')], { cwd: dir, detached: true, windowsHide: true, stdio: ['ignore', log, log] })
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

function archive() {
  const dir = sessionDir()
  need(dir)
  const metaFile = join(dir, 'src', 'protos', args[0] || '', 'meta.ts')
  if (!args[0] || !existsSync(metaFile)) die('which prototype? proto archive <slug>')
  const text = readFileSync(metaFile, 'utf8')
  const meta = JSON.parse(text.replace(/^[\s\S]*?export default\s*/, '').replace(/;?\s*$/, ''))
  meta.archived = !flags.off
  writeFileSync(metaFile, text.replace(/export default[\s\S]*$/, `export default ${JSON.stringify(meta, null, 2)}\n`))
  console.log(`${args[0]} ${meta.archived ? 'archived' : 'restored'}`)
}

async function stop(dir = sessionDir(), reason = 'stopped') {
  const s = readSession(dir)
  if (!s) return
  if (alive(s.pid)) kill(s.pid)
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
  // --click can repeat: each selector is clicked in order before the shot.
  argv.forEach((a, i) => { if (a === '--click' && argv[i + 1]) extra.push(`--click=${argv[i + 1]}`); else if (a.startsWith('--click=')) extra.push(a) })
  const r = run(process.execPath, [join(SKILL, 'scripts', 'shoot.mjs'), s.localUrl, out, ...routes.map(r => r || '/'), ...extra], { stdio: 'inherit' })
  process.exit(r.status ?? 1)
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
    return ids.map(id => ({ route: `${slug}/${id}`, proto: slug, id, name: meta.variants[id], title: meta.title || slug, kind: meta.kind || 'web' }))
  })
  const out = resolve(flags.out || join(dir, '.proto', 'snaps'))
  mkdirSync(out, { recursive: true })
  const specFile = join(out, 'spec.json')
  writeFileSync(specFile, JSON.stringify(spec))
  const r = run(process.execPath, [join(SKILL, 'scripts', 'snap.mjs'), s.localUrl, out, String(flags.width || 672), specFile], { stdio: 'inherit' })
  process.exit(r.status ?? 1)
}

const commands = {
  up, add, archive, shoot, snap, gc: () => gc(false), ls,
  stop: async () => { await stop(); console.log('stopped (files kept; proto up restarts it on the same link)') },
  rm: () => rm(),
  keep: () => { const dir = sessionDir(); need(dir); patchSession(dir, { keep: !flags.off }); console.log(flags.off ? 'no longer kept' : 'kept until deleted by hand') },
  url: () => { const s = need(sessionDir()); console.log(s.url || s.localUrl || 'not started') },
  stack: () => { const d = detectStack(projectRoot()); console.log(`${d.stack} (${d.why})`) },
}
if (!commands[cmd]) {
  console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split(/\r?\n/).slice(1, 14).map(l => l.replace(/^\/\/ ?/, '')).join('\n'))
  process.exit(cmd ? 1 : 0)
}
await commands[cmd]()
