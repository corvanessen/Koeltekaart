// Haalt kandidaat-locaties (bibliotheken, gemeentehuizen, zwembaden) op uit
// OpenStreetMap voor de hele geconfigureerde regio en schrijft ze weg als
// review-bestand in het additions-formaat van KoelteKaartData. Committen of
// PR'en gebeurt hier bewust niet automatisch: OSM-tags bevestigen alleen dát
// een gebouw bestaat, niet dat het tijdens hitte echt vrij toegankelijk is
// als koelplek — dat moet iemand nog met de hand nalopen voordat het de kaart
// op gaat.
//
// Kandidaten die je al eens hebt afgewezen, komen anders bij elke run weer
// terug — zet hun "osm.org/type/id" (staat in het desc-veld) in
// scripts/osm-ignore.json om ze blijvend over te slaan.
//
// Gebruik: npx tsx scripts/import-osm.ts

import { regionEnvelope, findMunicipality, type MunicipalityId } from '../shared/municipalities'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

type EditableCategoryKey = 'binnen' | 'park' | 'zwembad' | 'buitenwater'

type Candidate = {
  id: string
  cat: EditableCategoryKey
  name: string
  addr: string
  desc: string
  lat: number
  lon: number
  municipality: MunicipalityId
  address_confirmed: boolean
  coords_verified: boolean
}

type ExistingLocation = { id: string; lat: number; lon: number }
type IgnoreEntry = { ref: string; name?: string; reason?: string }

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter'
const BASE_LOCATIONS_URL = 'https://raw.githubusercontent.com/corvanessen/Koeltekaart/main/public/locations.json'
const COMMUNITY_DATA_URL = 'https://raw.githubusercontent.com/corvanessen/KoelteKaartData/main/locations.json'
// Binnen deze afstand van een bestaande locatie beschouwen we een OSM-punt als
// (waarschijnlijk) al aanwezig, niet als nieuwe kandidaat.
const DUPLICATE_RADIUS_METERS = 75

function slugify(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

function haversineMeters(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6371000
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLon = toRad(b.lon - a.lon)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

type OsmElement = {
  type: 'node' | 'way' | 'relation'
  id: number
  lat?: number
  lon?: number
  center?: { lat: number; lon: number }
  tags?: Record<string, string>
}

async function fetchOverpassElements(bbox: string): Promise<OsmElement[]> {
  const query = `
    [out:json][timeout:60];
    (
      node["amenity"="library"](${bbox});
      way["amenity"="library"](${bbox});
      node["amenity"="townhall"](${bbox});
      way["amenity"="townhall"](${bbox});
      node["leisure"="swimming_pool"]["access"!="private"](${bbox});
      way["leisure"="swimming_pool"]["access"!="private"](${bbox});
    );
    out center tags;
  `
  const response = await fetch(OVERPASS_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'koeltekaart-import-osm (https://github.com/corvanessen/Koeltekaart)',
    },
    body: `data=${encodeURIComponent(query)}`,
  })
  if (!response.ok) throw new Error(`Overpass-query mislukt (${response.status}): ${await response.text()}`)
  const json = (await response.json()) as { elements: OsmElement[] }
  return json.elements
}

function categoryForTags(tags: Record<string, string>): EditableCategoryKey | undefined {
  if (tags.amenity === 'library' || tags.amenity === 'townhall') return 'binnen'
  if (tags.leisure === 'swimming_pool') return 'zwembad'
  return undefined
}

function coordsOf(element: OsmElement): { lat: number; lon: number } | undefined {
  if (element.type === 'node' && typeof element.lat === 'number' && typeof element.lon === 'number') {
    return { lat: element.lat, lon: element.lon }
  }
  return element.center
}

function addressFor(tags: Record<string, string>): string {
  const street = [tags['addr:street'], tags['addr:housenumber']].filter(Boolean).join(' ')
  const place = [tags['addr:postcode'], tags['addr:city']].filter(Boolean).join(' ')
  return [street, place].filter(Boolean).join(', ')
}

async function fetchExistingLocations(): Promise<ExistingLocation[]> {
  const [base, community] = await Promise.all([
    fetch(BASE_LOCATIONS_URL).then((r) => (r.ok ? r.json() : [])) as Promise<ExistingLocation[]>,
    fetch(COMMUNITY_DATA_URL).then((r) => (r.ok ? r.json() : { additions: [] })) as Promise<{ additions: ExistingLocation[] }>,
  ])
  return [...base, ...community.additions]
}

async function loadIgnoreRefs(scriptDir: string): Promise<Set<string>> {
  const ignorePath = path.resolve(scriptDir, 'osm-ignore.json')
  const raw = await fs.readFile(ignorePath, 'utf-8').catch(() => '[]')
  const entries = JSON.parse(raw) as IgnoreEntry[]
  return new Set(entries.map((entry) => entry.ref))
}

async function main() {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url))
  const envelope = regionEnvelope()
  const bbox = `${envelope.minLat},${envelope.minLon},${envelope.maxLat},${envelope.maxLon}`

  console.log(`Overpass-query voor regio-bbox ${bbox} ...`)
  const elements = await fetchOverpassElements(bbox)
  console.log(`${elements.length} ruwe OSM-resultaten opgehaald.`)

  const [existing, ignoreRefs] = await Promise.all([fetchExistingLocations(), loadIgnoreRefs(scriptDir)])
  const usedIds = new Set(existing.map((loc) => loc.id))

  const candidates: Candidate[] = []
  let skippedOutsideRegion = 0
  let skippedNoName = 0
  let skippedDuplicate = 0
  let skippedNoCoords = 0
  let skippedIgnored = 0

  for (const element of elements) {
    const tags = element.tags ?? {}
    const cat = categoryForTags(tags)
    if (!cat) continue

    if (ignoreRefs.has(`${element.type}/${element.id}`)) {
      skippedIgnored++
      continue
    }

    const coords = coordsOf(element)
    if (!coords) {
      skippedNoCoords++
      continue
    }

    const municipality = findMunicipality(coords)
    if (!municipality) {
      skippedOutsideRegion++
      continue
    }

    const name = tags.name
    if (!name) {
      skippedNoName++
      continue
    }

    const isDuplicate = existing.some((loc) => haversineMeters(coords, loc) < DUPLICATE_RADIUS_METERS)
    if (isDuplicate) {
      skippedDuplicate++
      continue
    }

    const base = slugify(name)
    let id = base
    let suffix = 2
    while (usedIds.has(id)) id = `${base}-${suffix++}`
    usedIds.add(id)

    candidates.push({
      id,
      cat,
      name,
      addr: addressFor(tags),
      desc: `Bron: OpenStreetMap (osm.org/${element.type}/${element.id}). Ongeverifieerd — controleer vrije toegankelijkheid, zitplekken en openingstijden tijdens hitte voordat je dit goedkeurt.`,
      lat: coords.lat,
      lon: coords.lon,
      municipality,
      address_confirmed: false,
      coords_verified: false,
    })
  }

  console.log(
    `${candidates.length} nieuwe kandidaten. Overgeslagen: ${skippedDuplicate} mogelijk al aanwezig, ` +
      `${skippedOutsideRegion} buiten regio, ${skippedNoName} zonder naam, ${skippedNoCoords} zonder coördinaten, ` +
      `${skippedIgnored} eerder afgewezen (osm-ignore.json).`,
  )

  const outPath = path.resolve(scriptDir, '../osm-candidates.json')
  await fs.writeFile(outPath, `${JSON.stringify({ additions: candidates, overrides: {} }, null, 2)}\n`)
  console.log(`Weggeschreven naar ${outPath}.`)
  console.log('Dit is een review-bestand, geen PR — loop de kandidaten na en verplaats wat klopt handmatig naar KoelteKaartData/locations.json.')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
