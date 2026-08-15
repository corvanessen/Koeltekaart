import type { MunicipalityId } from '../../../shared/municipalities'
import type { TempPoint } from '../types'

// De RIVM Samen Meten-API (SensorThings) staat geen efficiënte server-side
// filtering toe zodra je gemeente-/temperatuurfilters combineert met $expand
// (bevestigd tijdens het bouwen van deze integratie: dat geeft foutieve of
// 400/502-responses). Alle ~255 stations in de regio stuk voor stuk bevragen
// zou honderden requests per paginabezoek kosten, dus laat de Worker dit op
// een cron elke ~15 min server-side ophalen en cachen; wij lezen hier alleen
// het kleine, kant-en-klare resultaat.
const SAMEN_METEN_ENDPOINT = import.meta.env.VITE_TEMPERATURE_ENDPOINT as string | undefined

type SamenMetenResponse = {
  points: {
    lat: number
    lon: number
    tempC: number
    updatedAt: string | null
    municipality: MunicipalityId
  }[]
}

export async function loadSamenMetenTemperatures(): Promise<TempPoint[]> {
  if (!SAMEN_METEN_ENDPOINT) return []

  const response = await fetch(SAMEN_METEN_ENDPOINT)
  if (!response.ok) {
    throw new Error(`Kon Samen Meten-temperaturen niet laden: ${response.status}`)
  }

  const data = (await response.json()) as SamenMetenResponse

  return data.points.map((point) => ({
    ...point,
    humidity: null,
    source: 'samenmeten' as const,
  }))
}
