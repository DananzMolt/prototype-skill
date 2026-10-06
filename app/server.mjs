// The dev-server side of a prototype session: status for the shell, the Keep and Stop
// buttons, and stopping by itself after hours with no edits and nobody looking.
import { execFile } from 'node:child_process'
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = fileURLToPath(new URL('.', import.meta.url))
const file = join(dir, 'session.json')
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
      // Compared with forward slashes: the watcher's paths and this one differ on Windows.
      const slash = p => p.replaceAll('\\', '/')
      const src = slash(join(dir, 'src'))
      server.watcher.on('all', (_, path) => { if (slash(path).startsWith(src)) activity = Date.now() })
      server.middlewares.use('/__proto', (req, res) => {
        let body = ''
        req.on('data', c => { body += c })
        req.on('end', () => {
          const route = req.url.split('?')[0]
          const data = body ? JSON.parse(body) : {}
          if (route === '/ping') activity = Date.now()
          if (route === '/keep') write({ keep: !!data.keep })
          res.setHeader('content-type', 'application/json')
          res.end(JSON.stringify(status()))
          if (route === '/stop') setTimeout(() => stop('stopped from the page'), 100)
        })
      })
      // A visible page pings every minute, so "idle" means no edits and nobody looking.
      const idle = (read().idleHours ?? 6) * 3600e3
      setInterval(() => { if (Date.now() - activity > idle) stop('idle') }, 60e3).unref()
    },
  }
}
