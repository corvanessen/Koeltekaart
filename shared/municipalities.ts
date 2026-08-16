// Gedeeld tussen de app (src/) en de Cloudflare Worker (worker/src/index.ts) via een
// relatief importpad — wrangler/esbuild en Vite bundelen dit allebei zelf mee, er is
// geen aparte build-stap voor nodig.
import boundaries from './data/municipality-boundaries.json'

export type MunicipalityId =
  | 'leiden'
  | 'leiderdorp'
  | 'oegstgeest'
  | 'voorschoten'
  | 'zoeterwoude'
  | 'teylingen'
  | 'leidschendam-voorburg'
  | 'tilburg'

export type Place = {
  name: string
  center: [number, number]
}

export type Municipality = {
  id: MunicipalityId
  name: string
  /** Bekende woonplaatsen binnen deze gemeente, met eigen centrum voor de zoekbalk. */
  places: Place[]
  center: [number, number]
  defaultZoom: number
}

// Plaats-centra zijn de area-weighted centroids van de officiële BAG
// woonplaats-vlakken (PDOK, kadaster), niet een geocoder-resultaat — dat bleek
// bij eerdere Nominatim-coördinaten soms een paar kilometer van het echte
// centrum af te zitten. Stompwijk heeft geen eigen BAG-woonplaats (valt onder
// Leidschendam), daarvoor is de meest precieze beschikbare schatting gebruikt.
export const MUNICIPALITIES: Municipality[] = [
  {
    id: 'leiden',
    name: 'Leiden',
    places: [{ name: 'Leiden', center: [52.15499, 4.48512] }],
    center: [52.1608, 4.497],
    defaultZoom: 12,
  },
  {
    id: 'leiderdorp',
    name: 'Leiderdorp',
    places: [{ name: 'Leiderdorp', center: [52.15665, 4.54201] }],
    center: [52.1605, 4.5231],
    defaultZoom: 13,
  },
  {
    id: 'oegstgeest',
    name: 'Oegstgeest',
    places: [{ name: 'Oegstgeest', center: [52.18555, 4.47121] }],
    center: [52.1836, 4.4728],
    defaultZoom: 13,
  },
  {
    id: 'voorschoten',
    name: 'Voorschoten',
    places: [{ name: 'Voorschoten', center: [52.12482, 4.43863] }],
    center: [52.1364, 4.4433],
    defaultZoom: 13,
  },
  {
    id: 'zoeterwoude',
    name: 'Zoeterwoude',
    places: [{ name: 'Zoeterwoude', center: [52.11794, 4.51212] }],
    center: [52.1275, 4.5089],
    defaultZoom: 13,
  },
  {
    id: 'teylingen',
    name: 'Teylingen',
    places: [
      { name: 'Sassenheim', center: [52.21894, 4.5175] },
      { name: 'Voorhout', center: [52.22809, 4.49383] },
      { name: 'Warmond', center: [52.19951, 4.52519] },
    ],
    center: [52.2333, 4.5083],
    defaultZoom: 12,
  },
  {
    id: 'leidschendam-voorburg',
    name: 'Leidschendam-Voorburg',
    places: [
      { name: 'Leidschendam', center: [52.09353, 4.43532] },
      { name: 'Voorburg', center: [52.07622, 4.36353] },
      { name: 'Stompwijk', center: [52.0947, 4.47114] },
    ],
    center: [52.0836, 4.3908],
    defaultZoom: 12,
  },
  // Experiment: ver van de rest van de regio verwijderd, toegevoegd om te
  // testen wat er nog handmatig moet gebeuren om een nieuwe stad aan te
  // sluiten (zie project plan koeltekaart.md voor de bevindingen).
  // Plaats-centra via PDOK Locatieserver (fq=type:woonplaats), gemeentecentrum
  // via fq=type:gemeente — zelfde bron als de rest van dit bestand.
  {
    id: 'tilburg',
    name: 'Tilburg',
    places: [
      { name: 'Tilburg', center: [51.57275, 5.0453] },
      { name: 'Berkel-Enschot', center: [51.57701, 5.13891] },
      { name: 'Udenhout', center: [51.6184, 5.13658] },
      { name: 'Biezenmortel', center: [51.62223, 5.1809] },
    ],
    center: [51.58342, 5.07737],
    defaultZoom: 11,
  },
]

type Point = { lat: number; lon: number }
type Ring = [number, number][]
type BoundaryFeature = { properties: { id: MunicipalityId; name: string }; geometry: { type: string; coordinates: unknown } }

const BOUNDARIES = (boundaries as { features: BoundaryFeature[] }).features

// Even-odd ray casting; coordinates zijn [lon, lat] (GeoJSON-volgorde).
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

// Eerste ring is de buitenrand, overige ringen zijn gaten (GeoJSON-conventie).
function pointInPolygonWithHoles(lon: number, lat: number, rings: Ring[]): boolean {
  if (!pointInRing(lon, lat, rings[0])) return false
  for (let i = 1; i < rings.length; i++) {
    if (pointInRing(lon, lat, rings[i])) return false
  }
  return true
}

function pointInFeatureGeometry(lon: number, lat: number, geometry: BoundaryFeature['geometry']): boolean {
  if (geometry.type === 'Polygon') {
    return pointInPolygonWithHoles(lon, lat, geometry.coordinates as Ring[])
  }
  if (geometry.type === 'MultiPolygon') {
    return (geometry.coordinates as Ring[][]).some((rings) => pointInPolygonWithHoles(lon, lat, rings))
  }
  return false
}

/** Bepaalt in welke geconfigureerde gemeente een punt ligt, of undefined als het buiten de regio valt. */
export function findMunicipality(point: Point): MunicipalityId | undefined {
  const feature = BOUNDARIES.find((f) => pointInFeatureGeometry(point.lon, point.lat, f.geometry))
  return feature?.properties.id
}

/** Zit dit punt binnen een van de geconfigureerde gemeentes? */
export function isWithinRegion(point: Point): boolean {
  return findMunicipality(point) !== undefined
}

/** Rechthoek die alle geconfigureerde gemeentes omvat, bv. als initieel kaartkader of API-bbox. */
export function regionEnvelope(): { minLat: number; maxLat: number; minLon: number; maxLon: number } {
  let minLat = Infinity
  let maxLat = -Infinity
  let minLon = Infinity
  let maxLon = -Infinity

  const visit = (rings: Ring[]) => {
    rings.forEach((ring) =>
      ring.forEach(([lon, lat]) => {
        if (lat < minLat) minLat = lat
        if (lat > maxLat) maxLat = lat
        if (lon < minLon) minLon = lon
        if (lon > maxLon) maxLon = lon
      }),
    )
  }

  BOUNDARIES.forEach((f) => {
    if (f.geometry.type === 'Polygon') visit(f.geometry.coordinates as Ring[])
    else if (f.geometry.type === 'MultiPolygon') (f.geometry.coordinates as Ring[][]).forEach(visit)
  })

  return { minLat, maxLat, minLon, maxLon }
}
