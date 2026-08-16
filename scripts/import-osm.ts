// Haalt kandidaat-locaties (bibliotheken, gemeentehuizen, zwembaden) op uit
// OpenStreetMap voor de hele geconfigureerde regio en schrijft ze direct in
// het lokale KoelteKaartData-repo (ernaast gekloond) — geen los reviewbestand,
// geen GitHub-token nodig. Dit zijn **ongeverifieerde kandidaten** — OSM
// bevestigt alleen dat een gebouw bestaat, niet dat het tijdens hitte echt
// vrij toegankelijk is als koelplek, dus de git-diff in KoelteKaartData is het
// reviewmoment: verwijder daar wat niet klopt vóórdat je commit en pusht.
//
// Kandidaten die je al eens hebt afgewezen, komen anders bij elke run weer
// terug — zet hun "osm.org/type/id" (staat in het desc-veld) in
// scripts/osm-ignore.json om ze blijvend over te slaan.
//
// Verwacht dat KoelteKaartData als sibling-map van deze repo gekloond is
// (../KoelteKaartData). Staat 'm ergens anders, zet dan de env var
// KOELTEKAART_DATA_PATH.
//
// Gebruik: npx tsx scripts/import-osm.ts

import { regionEnvelope, findMunicipality, type MunicipalityId } from '../shared/municipalities'
import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

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

type CommunityData = {
  additions: Candidate[]
  overrides: Record<string, unknown>
}

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter'
const DEFAULT_DATA_REPO_PATH = '../../KoelteKaartData' // relatief aan scripts/ — sibling-map van deze repo
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

async function loadIgnoreRefs(scriptDir: string): Promise<Set<string>> {
  const ignorePath = path.resolve(scriptDir, 'osm-ignore.json')
  const raw = await fs.readFile(ignorePath, 'utf-8').catch(() => '[]')
  const entries = JSON.parse(raw) as IgnoreEntry[]
  return new Set(entries.map((entry) => entry.ref))
}

// Werkt alleen verder op een schone checkout, zodat we nooit per ongeluk
// niet-gecommitte wijzigingen overschrijven of samenvoegen met een half-af
// bewerking van locations.json.
async function ensureCleanAndCurrent(dataRepoPath: string): Promise<void> {
  const { stdout } = await execFileAsync('git', ['status', '--porcelain'], { cwd: dataRepoPath })
  if (stdout.trim() !== '') {
    throw new Error(`${dataRepoPath} heeft niet-gecommitte wijzigingen — commit of stash die eerst.`)
  }
  await execFileAsync('git', ['pull', '--ff-only'], { cwd: dataRepoPath })
}

async function main() {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url))
  const koeltekaartRoot = path.resolve(scriptDir, '..')
  const dataRepoPath = path.resolve(scriptDir, process.env.KOELTEKAART_DATA_PATH ?? DEFAULT_DATA_REPO_PATH)
  const locationsPath = path.join(dataRepoPath, 'locations.json')

  await fs.access(locationsPath).catch(() => {
    throw new Error(
      `Kan ${locationsPath} niet vinden. Staat KoelteKaartData ergens anders gekloond, zet dan de env var KOELTEKAART_DATA_PATH.`,
    )
  })
  await ensureCleanAndCurrent(dataRepoPath)

  const envelope = regionEnvelope()
  const bbox = `${envelope.minLat},${envelope.minLon},${envelope.maxLat},${envelope.maxLon}`

  console.log(`Overpass-query voor regio-bbox ${bbox} ...`)
  const [elements, baseLocationsRaw, communityRaw, ignoreRefs] = await Promise.all([
    fetchOverpassElements(bbox),
    fs.readFile(path.join(koeltekaartRoot, 'public/locations.json'), 'utf-8'),
    fs.readFile(locationsPath, 'utf-8'),
    loadIgnoreRefs(scriptDir),
  ])
  console.log(`${elements.length} ruwe OSM-resultaten opgehaald.`)

  const baseLocations = JSON.parse(baseLocationsRaw) as ExistingLocation[]
  const community = JSON.parse(communityRaw) as CommunityData

  const existing: ExistingLocation[] = [...baseLocations, ...community.additions]
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

  if (candidates.length === 0) {
    console.log('Niets toe te voegen.')
    return
  }

  community.additions.push(...candidates)
  await fs.writeFile(locationsPath, `${JSON.stringify(community, null, 2)}\n`)

  console.log(`${candidates.length} kandidaten weggeschreven naar ${locationsPath}.`)
  console.log(
    'Bekijk de git-diff in KoelteKaartData en verwijder wat je niet wilt overnemen (zet de osm.org-ref uit het ' +
      'desc-veld dan in scripts/osm-ignore.json, anders komt die locatie bij de volgende run terug). ' +
      'Commit en push daarna zelf wanneer je tevreden bent.',
  )
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
