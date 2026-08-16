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
// requests — te veel voor een bezoekersbrowser, prima voor een cron.
const API_BASE = 'https://api-samenmeten.rivm.nl/v1.0'

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

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Samen Meten-verzoek mislukt (${response.status}): ${url}`)
  return response.json() as Promise<T>
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

    for (const thing of things) {
      const location = thing.Locations?.[0]?.location.coordinates
      if (!location) continue
      const [lon, lat] = location

      let datastreams: DatastreamSummary[]
      try {
        datastreams = await fetchTemperatureDatastreams(thing['@iot.id'])
      } catch (error) {
        console.error(`Samen Meten: kon datastreams voor thing ${thing['@iot.id']} niet ophalen`, error)
        continue
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
    }
  }

  return points
}
