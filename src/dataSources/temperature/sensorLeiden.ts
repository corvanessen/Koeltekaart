import { findMunicipality, type MunicipalityId } from '../../../shared/municipalities'
import type { TempPoint } from '../types'
import { isPlausibleTemperature } from './plausibility'

type Candidate = Omit<TempPoint, 'municipality'> & { municipality: MunicipalityId | undefined }

// sensorleiden.nl ontsluit het "Sensor Leiden" citizen-science netwerk
// (Sensor.Community-achtige BME280-sensoren) als open JSON, geen API-key nodig.
// KNMI WOW-NL en Weather Underground bleken geen bruikbare gratis/directe
// API voor Leiden te hebben; Meet je Stad! werkt technisch maar heeft momenteel
// geen actieve sensoren in Leiden. Dit netwerk dekt alleen Leiden zelf.
const TEMP_API_URL = 'https://www.sensorleiden.nl/api/data/now'

type SensorLeidenReading = {
  location_id: number
  value_type: string
  value: string
  updated_at?: string
  location?: { lat: string; long: string }
}

export async function loadSensorLeidenTemperatures(): Promise<TempPoint[]> {
  const response = await fetch(TEMP_API_URL)

  if (!response.ok) {
    throw new Error(`Kon temperatuurmetingen niet laden: ${response.status}`)
  }

  const data = (await response.json()) as { sensors: SensorLeidenReading[] }
  const sensors = data.sensors ?? []

  const humidityByLocation = new Map<number, number>()
  sensors.forEach((sensor) => {
    if (sensor.value_type === 'humidity') {
      const humidity = Number.parseFloat(sensor.value)
      if (Number.isFinite(humidity)) {
        humidityByLocation.set(sensor.location_id, humidity)
      }
    }
  })

  const candidates: Candidate[] = sensors
    .filter((sensor) => sensor.value_type === 'temperature')
    .map((sensor) => {
      const lat = Number.parseFloat(sensor.location?.lat ?? '')
      const lon = Number.parseFloat(sensor.location?.long ?? '')

      return {
        lat,
        lon,
        tempC: Number.parseFloat(sensor.value),
        humidity: humidityByLocation.get(sensor.location_id) ?? null,
        updatedAt: sensor.updated_at ?? null,
        source: 'sensorleiden' as const,
        municipality: Number.isFinite(lat) && Number.isFinite(lon) ? findMunicipality({ lat, lon }) : undefined,
      }
    })

  return candidates
    .filter((point) => point.municipality !== undefined && isPlausibleTemperature(point.tempC))
    .map((point) => ({ ...point, municipality: point.municipality as MunicipalityId }))
}
