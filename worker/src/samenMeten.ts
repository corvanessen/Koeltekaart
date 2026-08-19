import { MUNICIPALITIES, type MunicipalityId } from '../../shared/municipalities'

// RIVM Samen Meten (SensorThings/OGC-standaard, publiek, geen auth nodig).
// Deze module draait alleen server-side (Worker cron), nooit in de browser:
// de API geeft foutieve/onvolledige resultaten zodra je een $filter op een
// gerelateerde entiteit (gemeente, ObservedProperty) combineert met $expand
// in hetzelfde verzoek (bevestigd tijdens het bouwen van deze integratie —
// zowel 400- als 502-responses, en in één geval een silently verkeerde
// Thing-koppeling). De enige betrouwbare combinatie is: per Thing apart de
// (kleine) datastream-lijst ophalen, en per temperatuur-datastream apart de
// laatste meting. Voor de hele regio (~255 stations) is dat een paar honderd
// requests — te veel voor een bezoekersbrowser, prima voor een cron, maar
// alleen als ze niet strikt na elkaar lopen: sequentieel duurde een volledige
// ronde zo lang dat de RIVM-API zelf 504's begon te geven, en de Worker zijn
// subrequest-limiet per invocation raakte voordat gemeentes laat in de lijst
// (Tilburg) aan de beurt kwamen. Vandaar CONCURRENCY hieronder.
const API_BASE = 'https://api-samenmeten.rivm.nl/v1.0'

// Hoeveel Things tegelijk verwerkt worden (datastreams + observaties). Genoeg
// om een ronde snel te doorlopen, ruim onder de subrequest-limiet per
// invocation, en laag genoeg om RIVM niet opnieuw in de 504's te jagen.
const CONCURRENCY = 12
const MAX_ATTEMPTS = 3
const RETRY_DELAY_MS = 500

const TEMP_MIN_PLAUSIBLE = -15
const TEMP_MAX_PLAUSIBLE = 45

// CBS-gemeentecode (zonder "GM"-prefix/voorloopnullen), zoals de Samen
// Meten-API die zelf teruggeeft in `Thing.properties.codegemeente`.
const CBS_CODE: Record<MunicipalityId, string> = {
  leiden: '546',
  leiderdorp: '547',
  oegstgeest: '579',
  voorschoten: '626',
  zoeterwoude: '638',
  teylingen: '1525',
  'leidschendam-voorburg': '1916',
  tilburg: '855',
}

export type SamenMetenPoint = {
  lat: number
  lon: number
  tempC: number
  updatedAt: string | null
  municipality: MunicipalityId
}

type ThingWithLocation = {
  '@iot.id': number
  Locations?: { location: { coordinates: [number, number] } }[]
}

type DatastreamSummary = {
  '@iot.id': number
  unitOfMeasurement?: { symbol?: string }
}

type ObservationValue = {
  result: number
  phenomenonTime: string
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// RIVM's SensorThings-API geeft onder belasting soms een 504 op een verder
// prima verzoek; één retry met een korte pauze redt de meeste van die
// gevallen zonder de ronde merkbaar te vertragen.
async function fetchJson<T>(url: string): Promise<T> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const response = await fetch(url)
    if (response.ok) return response.json() as Promise<T>
    if (response.status !== 504 || attempt === MAX_ATTEMPTS) {
      throw new Error(`Samen Meten-verzoek mislukt (${response.status}): ${url}`)
    }
    await sleep(RETRY_DELAY_MS * attempt)
  }
  throw new Error(`Samen Meten-verzoek mislukt: ${url}`)
}

// Verwerkt `items` met maximaal `limit` tegelijk in plaats van strikt na
// elkaar, zonder de volgorde-onafhankelijke resultaten te hoeven combineren
// tot één grote Promise.all (dat zou alle ~255 requests tegelijk vuren).
async function mapWithConcurrency<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let index = 0
  async function worker(): Promise<void> {
    while (index < items.length) {
      const item = items[index++]
      await fn(item)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
}

async function fetchThingsForMunicipality(cbsCode: string): Promise<ThingWithLocation[]> {
  const filter = encodeURIComponent(`properties/codegemeente eq '${cbsCode}'`)
  const data = await fetchJson<{ value: ThingWithLocation[] }>(`${API_BASE}/Things?$filter=${filter}&$expand=Locations&$top=1000`)
  return data.value
}

async function fetchTemperatureDatastreams(thingId: number): Promise<DatastreamSummary[]> {
  const data = await fetchJson<{ value: DatastreamSummary[] }>(`${API_BASE}/Things(${thingId})/Datastreams`)
  return data.value.filter((d) => d.unitOfMeasurement?.symbol === 'C')
}

async function fetchLatestObservation(datastreamId: number): Promise<ObservationValue | null> {
  const data = await fetchJson<{ value: ObservationValue[] }>(
    `${API_BASE}/Datastreams(${datastreamId})/Observations?$orderby=phenomenonTime desc&$top=1`,
  )
  return data.value[0] ?? null
}

function isPlausible(tempC: number): boolean {
  return Number.isFinite(tempC) && tempC > TEMP_MIN_PLAUSIBLE && tempC < TEMP_MAX_PLAUSIBLE
}

export async function fetchSamenMetenTemperatures(): Promise<SamenMetenPoint[]> {
  const points: SamenMetenPoint[] = []

  for (const municipality of MUNICIPALITIES) {
    let things: ThingWithLocation[]
    try {
      things = await fetchThingsForMunicipality(CBS_CODE[municipality.id])
    } catch (error) {
      console.error(`Samen Meten: kon stations voor ${municipality.name} niet ophalen`, error)
      continue
    }

    await mapWithConcurrency(things, CONCURRENCY, async (thing) => {
      const location = thing.Locations?.[0]?.location.coordinates
      if (!location) return
      const [lon, lat] = location

      let datastreams: DatastreamSummary[]
      try {
        datastreams = await fetchTemperatureDatastreams(thing['@iot.id'])
      } catch (error) {
        console.error(`Samen Meten: kon datastreams voor thing ${thing['@iot.id']} niet ophalen`, error)
        return
      }

      for (const datastream of datastreams) {
        try {
          const observation = await fetchLatestObservation(datastream['@iot.id'])
          if (!observation || !isPlausible(observation.result)) continue

          points.push({
            lat,
            lon,
            tempC: observation.result,
            updatedAt: observation.phenomenonTime,
            municipality: municipality.id,
          })
        } catch (error) {
          console.error(`Samen Meten: kon observatie voor datastream ${datastream['@iot.id']} niet ophalen`, error)
        }
      }
    })
  }

  return points
}
