import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import { CATEGORY_LABELS, type CategoryKey } from './src/categoryLabels'
import type { Locale } from './src/locale'

type StaticLocation = {
  cat: CategoryKey
  name: string
  addr: string
  desc: string
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// Rendert de statische locaties (public/locations.json) als platte, indexeerbare
// HTML in index.html, zodat zoekmachines namen/adressen zien zonder JS uit te
// voeren — main.ts blijft dezelfde data los ophalen voor de interactieve kaart.
function locationIndexPlugin(): Plugin {
  return {
    name: 'location-index-html',
    transformIndexHtml(html, ctx) {
      const locale: Locale = ctx.path.startsWith('/en/') ? 'en' : 'nl'
      const labels = CATEGORY_LABELS[locale]

      const locations = JSON.parse(
        readFileSync(resolve(process.cwd(), 'public/locations.json'), 'utf-8'),
      ) as StaticLocation[]

      const byCategory = new Map<CategoryKey, StaticLocation[]>()
      locations.forEach((loc) => {
        const list = byCategory.get(loc.cat) ?? []
        list.push(loc)
        byCategory.set(loc.cat, list)
      })

      const sections = (Object.keys(labels) as CategoryKey[])
        .filter((cat) => byCategory.has(cat))
        .map((cat) => {
          const items = byCategory
            .get(cat)!
            .map(
              (loc) =>
                `<li><strong>${escapeHtml(loc.name)}</strong> — ${escapeHtml(loc.addr)}${
                  loc.desc ? ` — ${escapeHtml(loc.desc)}` : ''
                }</li>`,
            )
            .join('')

          return `<h3>${escapeHtml(labels[cat])}</h3><ul>${items}</ul>`
        })
        .join('')

      return html.replace('<div id="location-index-content"></div>', `<div id="location-index-content">${sections}</div>`)
    },
  }
}

export default defineConfig({
  base: '/Koeltekaart/',
  plugins: [locationIndexPlugin()],
  build: {
    rollupOptions: {
      input: {
        main: resolve(process.cwd(), 'index.html'),
        en: resolve(process.cwd(), 'en/index.html'),
      },
    },
  },
})
