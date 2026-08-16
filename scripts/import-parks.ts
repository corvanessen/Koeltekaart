// Haalt park-omtrekken (leisure=park) op uit OpenStreetMap voor de hele
// geconfigureerde regio en overschrijft public/parks.geojson ermee. Dit
// bestand werd tot nu toe handmatig gedownload (zie git-historie: twee losse
// exports, één per keer dat de regio groeide) — dit script maakt dat
// herhaalbaar, ook voor een nieuw toegevoegde gemeente.
//
// Geen review-/PR-stap zoals bij scripts/import-osm.ts: parken zijn geen
// "koelteplek"-inzending met een toegankelijkheidsvraag, gewoon een
// weergavelaag. Bekijk de git-diff van public/parks.geojson na het draaien
// zoals je dat ook bij een handmatige re-download zou doen.
//
// Gebruik: npx tsx scripts/import-parks.ts

import { regionEnvelope, isWithinRegion } from '../shared/municipalities'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter'

type LatLon = { lat: number; lon: number }
type Ring = [number, number][] // [lon, lat], GeoJSON-volgorde

type OsmMember = {
  type: 'node' | 'way' | 'relation'
  ref: number
  role: string
  geometry?: LatLon[]
}

type OsmElement = {
  type: 'node' | 'way' | 'relation'
  id: number
  geometry?: LatLon[]
  members?: OsmMember[]
  tags?: Record<string, string>
}

async function fetchOverpassElements(bbox: string): Promise<OsmElement[]> {
  const query = `
    [out:json][timeout:180];
    (
      way["leisure"="park"](${bbox});
      relation["leisure"="park"](${bbox});
    );
    out geom;
  `
  const response = await fetch(OVERPASS_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'koeltekaart-import-parks (https://github.com/corvanessen/Koeltekaart)',
    },
    body: `data=${encodeURIComponent(query)}`,
  })
  if (!response.ok) throw new Error(`Overpass-query mislukt (${response.status}): ${await response.text()}`)
  const json = (await response.json()) as { elements: OsmElement[] }
  return json.elements
}

function toRing(points: LatLon[]): Ring {
  return points.map((p) => [p.lon, p.lat])
}

function ringsEqual(a: LatLon, b: LatLon): boolean {
  return a.lat === b.lat && a.lon === b.lon
}

function isClosed(points: LatLon[]): boolean {
  return points.length >= 4 && ringsEqual(points[0], points[points.length - 1])
}

// Multipolygon-relaties splitsen een grens soms op in meerdere ways die pas
// samen een gesloten ring vormen (bevestigd: in de praktijk heeft een deel van
// de park-relaties in deze regio >1 way per rol). Dit stikt aan elkaar
// grenzende segmenten (gedeeld eindpunt = zelfde OSM-node) tot gesloten ringen,
// net zo lang tot alle segmenten gebruikt zijn.
function assembleRings(segments: LatLon[][]): LatLon[][] {
  const remaining = segments.map((s) => [...s])
  const rings: LatLon[][] = []

  while (remaining.length > 0) {
    let current = remaining.shift() as LatLon[]

    while (!isClosed(current) && remaining.length > 0) {
      const end = current[current.length - 1]
      const index = remaining.findIndex(
        (segment) => ringsEqual(segment[0], end) || ringsEqual(segment[segment.length - 1], end),
      )
      if (index === -1) break // onvolledige ring (bv. relatie loopt over de bbox-rand) — laat staan zoals hij is

      const [match] = remaining.splice(index, 1)
      const extension = ringsEqual(match[0], end) ? match.slice(1) : [...match].reverse().slice(1)
      current = [...current, ...extension]
    }

    rings.push(current)
  }

  return rings
}

// Even-odd ray casting, zelfde algoritme als findMunicipality in
// shared/municipalities.ts — hier gebruikt om te bepalen bij welke buitenring
// een hole (inner-ring) hoort.
function pointInRing(lon: number, lat: number, ring: Ring): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    const intersects = yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi
    if (intersects) inside = !inside
  }
  return inside
}

type AssembledPolygon = { outer: Ring; holes: Ring[] }

function assembleRelationPolygons(relation: OsmElement): AssembledPolygon[] {
  const outerSegments = (relation.members ?? [])
    .filter((m) => m.role === 'outer' && m.geometry)
    .map((m) => m.geometry as LatLon[])
  const innerSegments = (relation.members ?? [])
    .filter((m) => m.role === 'inner' && m.geometry)
    .map((m) => m.geometry as LatLon[])

  const outerRings = assembleRings(outerSegments).map(toRing)
  const innerRings = assembleRings(innerSegments).map(toRing)

  const polygons: AssembledPolygon[] = outerRings.map((outer) => ({ outer, holes: [] }))
  innerRings.forEach((hole) => {
    const owner = polygons.find((p) => pointInRing(hole[0][0], hole[0][1], p.outer))
    if (owner) owner.holes.push(hole)
  })

  return polygons
}

type ParkFeature = {
  type: 'Feature'
  properties: { name?: string; osmRef: string }
  geometry: { type: 'Polygon'; coordinates: Ring[] } | { type: 'MultiPolygon'; coordinates: Ring[][] }
}

function buildFeature(osmRef: string, name: string | undefined, polygons: AssembledPolygon[]): ParkFeature | undefined {
  if (polygons.length === 0) return undefined

  const properties = { ...(name ? { name } : {}), osmRef }

  if (polygons.length === 1) {
    return { type: 'Feature', properties, geometry: { type: 'Polygon', coordinates: [polygons[0].outer, ...polygons[0].holes] } }
  }
  return {
    type: 'Feature',
    properties,
    geometry: { type: 'MultiPolygon', coordinates: polygons.map((p) => [p.outer, ...p.holes]) },
  }
}

// Eén vertex testen (bv. alleen de eerste) is niet genoeg: bij een park dat
// over een gemeentegrens heen ligt, is welke node toevallig als eerste in de
// OSM-weg staat willekeurig — dat kostte "Nieuwe Driemanspolder" (deels
// Zoetermeer, deels Leidschendam-Voorburg) bijna toen alleen de eerste vertex
// getest werd. Bij overlap met de regio hoort het park.
function overlapsRegion(feature: ParkFeature): boolean {
  const outerRings = feature.geometry.type === 'Polygon' ? [feature.geometry.coordinates[0]] : feature.geometry.coordinates.map((p) => p[0])
  return outerRings.some((ring) => ring.some(([lon, lat]) => isWithinRegion({ lat, lon })))
}

async function main() {
  const envelope = regionEnvelope()
  const bbox = `${envelope.minLat},${envelope.minLon},${envelope.maxLat},${envelope.maxLon}`

  console.log(`Overpass-query voor regio-bbox ${bbox} ...`)
  const elements = await fetchOverpassElements(bbox)
  console.log(`${elements.length} ruwe OSM-resultaten opgehaald.`)

  const relationMemberWayIds = new Set(
    elements.filter((e) => e.type === 'relation').flatMap((r) => (r.members ?? []).filter((m) => m.type === 'way').map((m) => m.ref)),
  )

  const features: ParkFeature[] = []
  let skippedUnclosed = 0
  let skippedOutsideRegion = 0

  for (const element of elements) {
    if (element.type === 'way') {
      if (relationMemberWayIds.has(element.id)) continue // al verwerkt als onderdeel van een relatie
      const points = element.geometry ?? []
      if (!isClosed(points)) {
        skippedUnclosed++
        continue
      }
      const feature = buildFeature(`way/${element.id}`, element.tags?.name, [{ outer: toRing(points), holes: [] }])
      if (feature) features.push(feature)
      continue
    }

    if (element.type === 'relation') {
      const polygons = assembleRelationPolygons(element)
      const feature = buildFeature(`relation/${element.id}`, element.tags?.name, polygons)
      if (feature) features.push(feature)
    }
  }

  const withinRegion = features.filter((feature) => {
    const inside = overlapsRegion(feature)
    if (!inside) skippedOutsideRegion++
    return inside
  })

  console.log(
    `${withinRegion.length} parken binnen de regio. Overgeslagen: ${skippedOutsideRegion} buiten regio ` +
      `(bbox is een rechthoek, dus dit is normaal), ${skippedUnclosed} niet-gesloten way-geometrie.`,
  )

  const outPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/parks.geojson')
  const collection = { type: 'FeatureCollection' as const, features: withinRegion }
  await fs.writeFile(outPath, `${JSON.stringify(collection)}\n`)
  console.log(`Weggeschreven naar ${outPath}. Bekijk de git-diff voor je committer.`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
