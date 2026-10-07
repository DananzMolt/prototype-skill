import '../shell/shell.css'
import { createShell } from '../shell/shell'
import { mount } from './mount'
import { protos } from './registry'
import session from '../session.json'

const shell = createShell(document.getElementById('app')!, { mount, protos, session })

if (import.meta.hot) {
  // New or renamed prototype files re-run the registry; the shell takes the new list
  // without a page reload. Edits inside a variant are handled by the framework's own HMR.
  import.meta.hot.accept('./registry', mod => mod && shell.setProtos(mod.protos))
  import.meta.hot.accept('../session.json', mod => mod && shell.setSession(mod.default))
  // Sent by the dev server for any change under src/protos, shown or not (Vite itself only
  // reports modules the page has loaded).
  import.meta.hot.on('proto:edit', (data: { path: string }) => shell.edited([data.path]))
  // A variant whose component got a new name (the placeholder's `Variant` becoming
  // `SplitMedia`) is a different component to React Fast Refresh, so nothing on screen
  // would redraw. Hand the shell the fresh module; it remounts only in that case.
  import.meta.hot.on('vite:afterUpdate', async payload => {
    for (const u of payload.updates) {
      if (u.type !== 'js-update' || !/\/src\/protos\/[^/]+\/[A-Z]{1,2}\.\w+$/.test(u.path) || !shell.shows(u.path)) continue
      const mod = await import(/* @vite-ignore */ `${u.acceptedPath}?t=${u.timestamp}`)
      shell.replaceVariant(u.path, mod.default)
    }
  })
  import.meta.hot.on('vite:ws:disconnect', () => shell.setLive(false))
  import.meta.hot.on('vite:ws:connect', () => shell.setLive(true))
}
