// Finds a Chromium browser for the headless screenshots: Chrome first, then Chromium, then
// Edge (on every Windows machine). Set CHROME to a browser's executable to choose one.
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

export function findChrome() {
  if (process.env.CHROME) return process.env.CHROME
  const env = process.env
  const roots = [env.PROGRAMFILES, env['PROGRAMFILES(X86)'], env.LOCALAPPDATA].filter(Boolean)
  const paths = {
    darwin: ['Google Chrome', 'Chromium', 'Microsoft Edge'].map(app => `/Applications/${app}.app/Contents/MacOS/${app}`),
    win32: ['Google/Chrome/Application/chrome.exe', 'Chromium/Application/chrome.exe', 'Microsoft/Edge/Application/msedge.exe'].flatMap(p => roots.map(r => join(r, p))),
  }[process.platform] ?? []
  const found = paths.find(p => existsSync(p))
  if (found) return found
  for (const bin of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge']) {
    const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', [bin], { encoding: 'utf8' })
    if (r.status === 0) return r.stdout.split(/\r?\n/)[0].trim()
  }
  console.error('No Chrome, Chromium or Edge found. Install Chrome, or set CHROME to a Chromium browser\'s executable.')
  process.exit(1)
}
