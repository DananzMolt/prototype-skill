// The dev-server side of a prototype session: status for the shell, the Keep and Stop
// buttons, and stopping by itself after hours with no edits and nobody looking.
import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { cpSync, mkdirSync, readFileSync, writeFileSync, readdirSync, renameSync, rmSync, statSync, watch } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = fileURLToPath(new URL('.', import.meta.url))
const file = join(dir, 'session.json')
// Compared with forward slashes: the watcher's paths and these differ on Windows.
const slash = p => p.replaceAll('\\', '/')
const stylesheet = slash(join(dir, 'shell', 'shell.css'))
const read = () => JSON.parse(readFileSync(file, 'utf8'))
const write = patch => writeFileSync(file, JSON.stringify({ ...read(), ...patch }, null, 2) + '\n')

// Newest change to any prototype file; the session's own start time if there are none.
export function lastEdit(root = dir) {
  let newest = Date.parse(JSON.parse(readFileSync(join(root, 'session.json'), 'utf8')).createdAt) || 0
  const walk = d => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name)
      if (e.isDirectory()) walk(p)
      else newest = Math.max(newest, statSync(p).mtimeMs)
    }
  }
  try { walk(join(root, 'src', 'protos')) } catch { /* no prototypes yet */ }
  return newest
}

const DECIDED_IDLE = 30 * 60e3
// True when the session has prototypes and each one is picked or archived.
export function decided() {
  const metas = []
  try {
    for (const slug of readdirSync(join(dir, 'src', 'protos'))) {
      try { metas.push(JSON.parse(readFileSync(join(dir, 'src', 'protos', slug, 'meta.ts'), 'utf8').replace(/^[\s\S]*?export default\s*/, '').replace(/;?\s*$/, ''))) } catch { /* not a prototype */ }
    }
  } catch { /* none yet */ }
  return metas.length > 0 && metas.every(m => m.archived || m.picked)
}

// The page moves the working variant two ways: back to one under Before (the one it leaves goes
// to Before, as with `proto work`), or Undo of a move it was just told about (nothing is kept).
const same = (a, b) => !!a && !!b && a.proto === b.proto && a.variant === b.variant
function work({ proto, variant, undo }) {
  const s = read(), t = { proto: String(proto), variant: String(variant) }
  if (same(s.work, t)) return
  const before = undo ? (s.before || []).filter(x => !same(x, t)) : [s.work, ...(s.before || [])].filter(x => x && !same(x, t))
  write({ work: { ...t, at: new Date().toISOString() }, before: before.filter((x, i, all) => all.findIndex(y => same(x, y)) === i).slice(0, 3).map(x => ({ proto: x.proto, variant: x.variant })) })
}

// ---------- the inbox: comments from the page, for the agent running the session ----------
// Each send is one batch folder under .proto/inbox/: batch.json, plus its screenshots as files.
// A new batch waits in new/ until `proto inbox` takes it, which moves it to taken/ (a rename,
// so two readers never both get it). Replies are written into the taken batch.
const inbox = join(dir, '.proto', 'inbox')
const MAX_BODY = 40 * 1024 * 1024
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
const alive = pid => { if (!pid) return false; try { process.kill(pid, 0); return true } catch { return false } }
const readJson = (f, fallback) => { try { return JSON.parse(readFileSync(f, 'utf8')) } catch { return fallback } }
const list = sub => { try { return readdirSync(join(inbox, sub)).filter(f => !f.startsWith('.')) } catch { return [] } }

/** Where the inbox stands, for the page: what waits, whether an agent is listening, the batches' states. */
export function inboxStatus() {
  const waiter = readJson(join(inbox, 'waiter.json'), null)
  const batches = [...list('new').map(id => [id, 'new']), ...list('taken').map(id => [id, 'taken'])].map(([id, where]) => {
    const b = readJson(join(inbox, where, id, 'batch.json'), null)
    return b && {
      id, at: b.at, state: b.done ? 'done' : where === 'new' ? 'sent' : 'seen', reply: b.reply ?? null,
      comments: b.comments.map(c => ({ n: c.n, route: c.route, done: !!c.done, reply: c.reply ?? null })),
    }
  }).filter(Boolean).sort((a, b) => a.at < b.at ? 1 : -1)
  return { new: list('new').length, listening: !!waiter && alive(waiter.pid), batches: batches.slice(0, 20) }
}

const box = r => r && typeof r === 'object' ? { x: Math.round(+r.x || 0), y: Math.round(+r.y || 0), w: Math.round(+r.w || 0), h: Math.round(+r.h || 0) } : undefined
const clip = (s, n) => typeof s === 'string' ? s.slice(0, n) : undefined
const element = t => t && typeof t === 'object' ? {
  selector: clip(t.selector, 500), shoot: clip(t.shoot, 100), src: clip(t.src, 300), component: clip(t.component, 100),
  tag: clip(t.tag, 40), text: clip(t.text, 300), rect: box(t.rect),
} : undefined

/** Writes one send from the page as a new batch. Images come as data URLs and are stored as files. */
function receive(data) {
  const comments = Array.isArray(data?.comments) ? data.comments : []
  if (!comments.length) throw Object.assign(new Error('no comments'), { status: 400 })
  const at = new Date().toISOString()
  const id = `${at.replace(/[-:]/g, '').replace(/\..*/, '')}-${randomBytes(2).toString('hex')}`
  const folder = join(inbox, '.incoming', id)
  mkdirSync(folder, { recursive: true })
  let n = 0
  const batch = {
    id, at,
    viewport: data.viewport && { w: +data.viewport.w || 0, h: +data.viewport.h || 0, phone: !!data.viewport.phone },
    theme: data.theme === 'dark' ? 'dark' : 'light',
    comments: comments.map((c, i) => {
      if (typeof c?.text !== 'string' || !c.text.trim()) throw Object.assign(new Error(`comment ${i + 1} has no text`), { status: 400 })
      if (typeof c.route !== 'string' || !/^[a-z0-9][a-z0-9-]*(\/[A-Z]{1,2}(\/[\w-]+)?)?$/.test(c.route)) throw Object.assign(new Error(`comment ${i + 1}: route is <slug>[/<letter>[/<state>]]`), { status: 400 })
      const images = (Array.isArray(c.images) ? c.images : []).map(img => {
        const m = String(img?.dataUrl ?? img).match(/^data:image\/(png|jpeg|webp);base64,(.+)$/)
        if (!m) return null
        const file = `${++n}.${m[1] === 'jpeg' ? 'jpg' : m[1]}`
        writeFileSync(join(folder, file), Buffer.from(m[2], 'base64'))
        return { file, name: clip(img?.name, 100) }
      }).filter(Boolean)
      return {
        n: i + 1, route: c.route, text: c.text.trim().slice(0, 4000),
        point: c.point && { x: Math.round(+c.point.x || 0), y: Math.round(+c.point.y || 0) },
        target: element(c.target),
        tags: (Array.isArray(c.tags) ? c.tags : []).map(element).filter(Boolean).slice(0, 20),
        images,
      }
    }),
  }
  writeFileSync(join(folder, 'batch.json'), JSON.stringify(batch, null, 2) + '\n')
  // Complete before anyone can see it: a waiter only ever finds a whole batch in new/.
  mkdirSync(join(inbox, 'new'), { recursive: true })
  moveDir(folder, join(inbox, 'new', id))
  return batch
}

export function prototypeServer(session) {
  let activity = Date.now()
  const status = () => {
    const s = read()
    return { lastEdit: lastEdit(), keep: !!s.keep, idleHours: s.idleHours ?? 6, deleteDays: s.deleteDays ?? 14, inbox: inboxStatus() }
  }
  const stop = reason => {
    write({ stoppedAt: new Date().toISOString(), stopReason: reason, pid: null })
    const exit = () => process.exit(0)
    setTimeout(exit, 3000)
    if (session.tailnetPort) execFile('tailscale', ['serve', `--https=${session.tailnetPort}`, 'off'], exit)
    else exit()
  }
  return {
    name: 'prototype-server',
    configureServer(server) {
      const src = slash(join(dir, 'src'))
      server.watcher.on('all', (_, path) => {
        if (!slash(path).startsWith(src)) return
        activity = Date.now()
        if (slash(path).startsWith(`${src}/protos/`)) server.ws.send({ type: 'custom', event: 'proto:edit', data: { path: slash(path).slice(slash(dir).length - 1) } })
      })
      server.middlewares.use('/__proto', (req, res) => {
        const chunks = []
        let size = 0
        const fail = (code, error) => { res.statusCode = code; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ error })) }
        req.on('data', c => {
          size += c.length
          if (size <= MAX_BODY) chunks.push(c)
        })
        req.on('end', () => {
          if (size > MAX_BODY) return fail(413, `over ${MAX_BODY / 1048576} MB; send fewer or smaller screenshots`)
          const route = req.url.split('?')[0]
          let data = {}
          try { if (size) data = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { return fail(400, 'not JSON') }
          if (route === '/ping') activity = Date.now()
          if (route === '/keep') write({ keep: !!data.keep })
          if (route === '/work' && data.proto && data.variant) work(data)
          let sent
          if (route === '/comments') {
            activity = Date.now()
            try { sent = receive(data).id } catch (e) { return fail(e.status || 500, e.message) }
          }
          res.setHeader('content-type', 'application/json')
          res.end(JSON.stringify(sent ? { ...status(), sent } : status()))
          if (route === '/stop') setTimeout(() => stop('stopped from the page'), 100)
        })
      })
      // .proto/ is outside Vite's watcher, so the inbox is watched here: a batch taken, a
      // reply written or a listener starting reaches every open page at once.
      mkdirSync(inbox, { recursive: true })
      let pending
      const changed = () => { clearTimeout(pending); pending = setTimeout(() => server.ws.send({ type: 'custom', event: 'proto:inbox', data: inboxStatus() }), 100) }
      // A watched folder that is removed (the session deleted) raises an error event on Windows; it must not stop the server.
      try { watch(inbox, { recursive: true }, changed).on('error', () => {}) } catch { /* no recursive watch here: the page's status ping still catches up */ }
      // A visible page pings every minute, so "idle" means no edits and nobody looking. Once
      // every prototype is picked or archived, nothing is left to decide: stop much sooner.
      const idle = (read().idleHours ?? 6) * 3600e3
      setInterval(() => { if (Date.now() - activity > (decided() ? Math.min(idle, DECIDED_IDLE) : idle)) stop(decided() ? 'idle, all decided' : 'idle') }, 60e3).unref()
    },
    // Tailwind rescans only when a file it has already read changes, and Vite gives it nothing
    // for a new one, so a new prototype folder's classes stayed missing until a restart. A new
    // file refreshes the stylesheet, which rescans. A copy that can't take a hot update is only
    // marked stale, since updating it would reload the page.
    hotUpdate({ type, modules }) {
      if (type !== 'create') return
      const graph = this.environment.moduleGraph
      const sheets = [...graph.getModulesByFile(stylesheet) ?? []]
      for (const m of sheets) if (!m.isSelfAccepting) graph.invalidateModule(m)
      const live = sheets.filter(m => m.isSelfAccepting)
      if (live.length) return [...modules, ...live]
    },
  }
}
