// Finds the prototypes: src/protos/<slug>/meta.ts, plus one file per variant named by its
// letter (A.tsx, B.tsx … or A.vue …). Variant names live in meta.ts so every stack shares them.
import type { Proto, Variant } from '../shell/shell'

type Meta = { title: string; ask?: string; kind?: 'web' | 'phone'; created?: string; archived?: boolean; from?: string; variants?: Record<string, string> }

const metas = import.meta.glob<Meta>('./protos/*/meta.ts', { eager: true, import: 'default' })
// Only files named by a letter are variants; helpers beside them (parts.tsx) have no default
// export, and importing one for it would break the page.
const files = import.meta.glob(['./protos/*/[A-Z].{tsx,jsx,vue,svelte}', './protos/*/[A-Z][A-Z].{tsx,jsx,vue,svelte}'], { eager: true, import: 'default' })

const order = (a: Variant, b: Variant) => a.id.length - b.id.length || a.id.localeCompare(b.id)

export const protos: Proto[] = Object.entries(metas)
  .map(([path, meta]) => {
    const id = path.split('/')[2]
    const variants = Object.entries(files)
      .map(([file, component]) => ({ file, component, parts: file.split('/') }))
      .filter(f => f.parts[2] === id && /^[A-Z]{1,2}\.\w+$/.test(f.parts[3]))
      .map(f => {
        const vid = f.parts[3].replace(/\.\w+$/, '')
        return { id: vid, name: meta.variants?.[vid] ?? vid, component: f.component, file: `/src${f.file.slice(1)}` }
      })
      .sort(order)
    // from: "home/B" (built from variant B of home) or "home" (from the prototype as a whole)
    const [fp, fv = ''] = typeof meta.from === 'string' ? meta.from.split('/') : []
    return { id, title: meta.title ?? id, ask: meta.ask ?? '', kind: meta.kind ?? 'web', created: meta.created ?? '', archived: !!meta.archived, from: fp ? { proto: fp, variant: fv } : undefined, variants }
  })
  .sort((a, b) => a.created.localeCompare(b.created))
