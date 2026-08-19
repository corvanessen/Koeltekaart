import { findMunicipality, type MunicipalityId } from '../../shared/municipalities'

// RIVM's officieel gedocumenteerde Samen Meten-API (SensorThings/OGC) staat geen
// efficiënte server-side filtering toe zodra je een $filter op een gerelateerde
// entiteit (gemeente, ObservedProperty) combineert met $expand in hetzelfde
// verzoek (bevestigd tijdens het bouwen van deze integratie: 400/502-responses,
// of de verbinding wordt zonder response afgebroken). Zonder die combinatie kost
// het per Thing apart ophalen van datastreams + laatste observatie voor de hele
// regio (~370+ stations sinds Tilburg erbij kwam) een paar honderd requests per
// cron-ronde — dat liep tegen Cloudflare's limiet op "too many subrequests by
// single Worker invocation" aan, ruim voordat gemeentes laat in de lijst
// (Tilburg) aan de beurt kwamen.
//
// samenmeten.rivm.nl/dataportaal (hun eigen kaart, die wél in ~1 request voor
// heel Nederland laadt) blijkt de SensorThings-API zelf niet te gebruiken: hun
// frontend haalt één keer per paginabezoek een kant-en-klaar, plat bestand op
// met de actuele waarde per station voor heel NL (bevestigd door hun
// dataportaal.js/index-JS te lezen). Dat endpoint is niet gedocumenteerd als
// publieke API (het staat niet in hun Apiary-docs), maar is wel degelijk
// publiek en auth-vrij — elke bezoeker van hun kaart laadt het al. Eén verzoek
// per cron-ronde hier is een fractie van de load die hun eigen site er al op
// zet. Als dit ooit stopt te werken (endpoint hernoemd/formaat gewijzigd) is de
// per-Thing SensorThings-aanpak hierboven het te herstellen fallback-pad.
const FLATFILE_URL = 'https://samenmeten.rivm.nl/dataportaal/php/getData-fromfile.php?compartiment=lucht'

// Vaste kolomvolgorde van het platte bestand (zelfde volgorde als
// `fields['lucht']` in hun dataportaal-frontend). We gebruiken alleen tijd,
// locatie en temp; de rest (fijnstof, NO2, ...) is hier niet relevant.
const TIME_INDEX = 0
const GEOM_INDEX = 4
const TEMP_INDEX = 9

const TEMP_MIN_PLAUSIBLE = -15
const TEMP_MAX_PLAUSIBLE = 45

export type SamenMetenPoint = {
  lat: number
  lon: number
  tempC: number
  updatedAt: string | null
  municipality: MunicipalityId
}

function isPlausible(tempC: number): boolean {
  return Number.isFinite(tempC) && tempC > TEMP_MIN_PLAUSIBLE && tempC < TEMP_MAX_PLAUSIBLE
}

// Rijen zijn gescheiden door ", ;", velden binnen een rij door ", " — veilig
// omdat het enige veld met komma's erin (geom, als JSON) door hun eigen
// serialisatie zonder spaties na de komma wordt geschreven.
function parseRows(raw: string): string[][] {
  return raw
    .split(', ;')
    .map((row) => row.trim())
    .filter(Boolean)
    .map((row) => row.split(', '))
}

export async function fetchSamenMetenTemperatures(): Promise<SamenMetenPoint[]> {
  const response = await fetch(FLATFILE_URL)
  if (!response.ok) {
    throw new Error(`Samen Meten-verzoek mislukt (${response.status}): ${FLATFILE_URL}`)
  }
  const raw = await response.text()

  const points: SamenMetenPoint[] = []
  for (const fields of parseRows(raw)) {
    if (fields.length <= TEMP_INDEX) continue

    let geom: { coordinates: [number, number] }
    try {
      geom = JSON.parse(fields[GEOM_INDEX])
    } catch {
      continue
    }
    const [lon, lat] = geom.coordinates ?? []
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue

    const municipality = findMunicipality({ lat, lon })
    if (!municipality) continue

    const tempC = parseFloat(fields[TEMP_INDEX])
    if (!isPlausible(tempC)) continue

    const time = fields[TIME_INDEX]
    const updatedAt = time ? `${time.replace(' ', 'T')}Z` : null

    points.push({ lat, lon, tempC, updatedAt, municipality })
  }

  return points
}
