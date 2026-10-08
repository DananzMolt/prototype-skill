import { readFileSync, realpathSync } from 'node:fs'
import { defineConfig } from 'vite'
import tailwind from '@tailwindcss/vite'
import { prototypeServer } from './server.mjs'

const session = JSON.parse(readFileSync(new URL('./session.json', import.meta.url), 'utf8'))
// Only the session's own framework plugin is installed; a non-literal import keeps the
// bundler from looking for the other one.
const plugins = { react: '@vitejs/plugin-react', vue: '@vitejs/plugin-vue' }
const framework = (await import(plugins[session.stack])).default()

export default defineConfig({
  plugins: [framework, tailwind(), prototypeServer(session)],
  // An inline config stops Vite from loading the project's own PostCSS config from above.
  css: { postcss: {} },
  resolve: { alias: { '@project': session.project } },
  server: {
    host: '127.0.0.1',
    port: session.port,
    strictPort: true,
    // Reached through `tailscale serve` as <machine>.<tailnet>.ts.net.
    allowedHosts: ['.ts.net'],
    // Vite checks a file's real path, so a project reached through a link (macOS /tmp is
    // /private/tmp) is allowed by both names.
    fs: { allow: [session.project, realpathSync(session.project)] },
    // The server's own log and pid live in .proto/; changes there are not edits.
    watch: { ignored: ['**/.proto/**'] },
  },
})
