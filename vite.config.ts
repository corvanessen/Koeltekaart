import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import { CATEGORY_LABELS, type CategoryKey } from './src/categoryLabels'
import type { Locale } from './src/locale'
import { MUNICIPALITIES, type MunicipalityId } from './shared/municipalities'

type StaticLocation = {
  cat: CategoryKey
  name: string
  addr: string
  desc: string
  place?: string
  municipality?: MunicipalityId
}

const MUNICIPALITY_NAME = new Map(MUNICIPALITIES.map((m) => [m.id, m.name]))

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

      const locationLine = (loc: StaticLocation) =>
        `<li><strong>${escapeHtml(loc.name)}</strong> — ${escapeHtml(loc.addr)}${
          loc.desc ? ` — ${escapeHtml(loc.desc)}` : ''
        }</li>`

      const byCategory = new Map<CategoryKey, StaticLocation[]>()
      locations.forEach((loc) => {
        const list = byCategory.get(loc.cat) ?? []
        list.push(loc)
        byCategory.set(loc.cat, list)
      })

      const categorySections = (Object.keys(labels) as CategoryKey[])
        .filter((cat) => byCategory.has(cat))
        .map((cat) => `<h3>${escapeHtml(labels[cat])}</h3><ul>${byCategory.get(cat)!.map(locationLine).join('')}</ul>`)
        .join('')

      // Groepeert dezelfde locaties nogmaals op gemeente > plaats, zodat
      // zoekmachines de kaart ook op regio/plaatsnaam kunnen indexeren.
      const byMunicipality = new Map<MunicipalityId, Map<string, StaticLocation[]>>()
      locations.forEach((loc) => {
        const municipality = loc.municipality ?? 'leiden'
        const place = loc.place ?? MUNICIPALITY_NAME.get(municipality) ?? municipality
        const byPlace = byMunicipality.get(municipality) ?? new Map<string, StaticLocation[]>()
        const list = byPlace.get(place) ?? []
        list.push(loc)
        byPlace.set(place, list)
        byMunicipality.set(municipality, byPlace)
      })

      const municipalitySections = MUNICIPALITIES.filter((m) => byMunicipality.has(m.id))
        .map((m) => {
          const places = [...byMunicipality.get(m.id)!.entries()]
            .map(([place, locs]) => `<h4>${escapeHtml(place)}</h4><ul>${locs.map(locationLine).join('')}</ul>`)
            .join('')
          return `<h3>${escapeHtml(m.name)}</h3>${places}`
        })
        .join('')

      const sections = `<h2>${escapeHtml(locale === 'en' ? 'By category' : 'Per categorie')}</h2>${categorySections}<h2>${escapeHtml(
        locale === 'en' ? 'By municipality' : 'Per gemeente',
      )}</h2>${municipalitySections}`

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
