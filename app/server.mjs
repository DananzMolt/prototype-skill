// The dev-server side of a prototype session: status for the shell, the Keep and Stop
// buttons, and stopping by itself after hours with no edits and nobody looking.
import { execFile } from 'node:child_process'
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
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

export function prototypeServer(session) {
  let activity = Date.now()
  const status = () => {
    const s = read()
    return { lastEdit: lastEdit(), keep: !!s.keep, idleHours: s.idleHours ?? 6, deleteDays: s.deleteDays ?? 14 }
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
        let body = ''
        req.on('data', c => { body += c })
        req.on('end', () => {
          const route = req.url.split('?')[0]
          const data = body ? JSON.parse(body) : {}
          if (route === '/ping') activity = Date.now()
          if (route === '/keep') write({ keep: !!data.keep })
          if (route === '/work' && data.proto && data.variant) work(data)
          res.setHeader('content-type', 'application/json')
          res.end(JSON.stringify(status()))
          if (route === '/stop') setTimeout(() => stop('stopped from the page'), 100)
        })
      })
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
